import axios from 'axios';
import mqtt, { MqttClient } from 'mqtt';
import { Logging } from 'homebridge';
import { MQTT_APP_KEY, MQTT_APP_SECRET, MQTT_PORT } from '../api/ezviz-constants.js';

// Field order of the comma-separated "ext" payload from EZVIZ MQTT messages
const EXT_FIELD_NAMES = [
  'channel_type', 'time', 'device_serial', 'channel_no',
  'alert_type_code', 'default_pic_url', 'media_url_alt1',
  'media_url_alt2', 'resource_type', 'status_flag', 'file_id',
  'is_encrypted', 'picChecksum', 'is_dev_video', 'metadata',
  'msgId', 'image', 'device_name', 'reserved', 'sequence_number',
] as const;

const EXT_INT_FIELDS = new Set([
  'channel_type', 'channel_no', 'alert_type_code',
  'resource_type', 'status_flag', 'is_encrypted',
  'is_dev_video', 'sequence_number',
]);

export type MqttMessageCallback = (deviceSerial: string) => void;

export class EzvizMqttClient {
  private mqttClient: MqttClient | null = null;
  private clientId: string | null = null;
  private ticket: string | null = null;
  private readonly topic = `${MQTT_APP_KEY}/#`;
  private onMessage: MqttMessageCallback;

  constructor(
    private readonly pushAddr: string,
    private readonly sessionId: string,
    private readonly username: string,
    onMessage: MqttMessageCallback,
    private readonly log: Logging,
  ) {
    this.onMessage = onMessage;
  }

  async connect(): Promise<void> {
    this.clientId = await this.register();
    await this.startPush();
    this.connectMqtt();
  }

  stop(): void {
    this.stopPush().catch(() => undefined);
    if (this.mqttClient) {
      this.mqttClient.end(true);
      this.mqttClient = null;
    }
  }

  private async register(): Promise<string> {
    const auth = Buffer.from(`${MQTT_APP_KEY}:${MQTT_APP_SECRET}`).toString('base64');
    const response = await axios.post(
      `https://${this.pushAddr}/v1/getClientId`,
      new URLSearchParams({
        appKey: MQTT_APP_KEY,
        clientType: '5',
        mac: 'homebridge',
        token: '123456',
        version: 'v1.3.0',
      }).toString(),
      { headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    this.log.debug('MQTT register response:', JSON.stringify(response.data));
    if (response.data?.status !== 200) {
      throw new Error(`MQTT registration failed: ${JSON.stringify(response.data)}`);
    }
    return response.data.data.clientId as string;
  }

  private async startPush(): Promise<void> {
    this.log.debug(`MQTT startPush: clientId=${this.clientId} username=${this.username} sessionId=${this.sessionId?.slice(0, 8)}...`);
    const response = await axios.post(
      `https://${this.pushAddr}/api/push/start`,
      new URLSearchParams({
        appKey: MQTT_APP_KEY,
        clientId: this.clientId!,
        clientType: '5',
        sessionId: this.sessionId,
        username: this.username,
        token: '123456',
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    this.log.debug('MQTT startPush response:', JSON.stringify(response.data));
    if (response.data?.status !== 200) {
      throw new Error(`MQTT push start failed: ${JSON.stringify(response.data)}`);
    }
    this.ticket = response.data.ticket as string ?? null;
    this.log.debug(`MQTT push started (clientId: ${this.clientId} ticket: ${this.ticket})`);
  }

  private async stopPush(): Promise<void> {
    if (!this.clientId) {
      return;
    }
    await axios.post(
      `https://${this.pushAddr}/api/push/stop`,
      new URLSearchParams({
        appKey: MQTT_APP_KEY,
        clientId: this.clientId,
        clientType: '5',
        sessionId: this.sessionId,
        username: this.username,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    ).catch(() => undefined);
  }

  private connectMqtt(): void {
    const client = mqtt.connect(`mqtt://${this.pushAddr}:${MQTT_PORT}`, {
      clientId: this.clientId!,
      username: MQTT_APP_KEY,
      password: MQTT_APP_SECRET,
      protocolVersion: 4,
      clean: false,
      keepalive: 30,
      reconnectPeriod: 5000,
    });

    client.on('connect', (connack) => {
      this.log.debug(`MQTT connected (sessionPresent=${connack.sessionPresent})`);
      // With clean:false the broker may restore a stored session that already has our
      // subscription; re-subscribing is only needed for fresh sessions.
      if (!connack.sessionPresent) {
        client.subscribe(this.topic, { qos: 1 }, (err, granted) => {
          if (err) {
            this.log.error('MQTT subscribe error:', err.message);
          } else {
            this.log.debug('MQTT subscribed:', JSON.stringify(granted));
          }
        });
      }
    });

    client.on('message', (topic, payload) => {
      this.log.debug(`MQTT raw message: topic=${topic} bytes=${payload.length}`);
      try {
        const decoded = this.decodePayload(payload);
        const ext = decoded.ext as Record<string, unknown>;
        const serial = ext?.device_serial as string;
        if (!serial) {
          this.log.debug('MQTT message: no device_serial, raw ext:', JSON.stringify(decoded.ext));
          return;
        }
        // ext.time (field index 1) is an EZVIZ internal code, not a Unix timestamp.
        // MQTT is real-time push so Date.now() is the correct alarm time.
        const rawMsgId = ext?.msgId;
        const msgId = (typeof rawMsgId === 'string' && rawMsgId.trim() !== '')
          ? rawMsgId
          : serial;
        this.log.debug(`MQTT message: serial=${serial} alert_type_code=${ext?.alert_type_code} msgId=${msgId}`);
        this.onMessage(serial);
      } catch (err) {
        this.log.debug('MQTT message decode error:', err, 'raw:', payload.toString('utf-8').slice(0, 200));
      }
    });

    client.on('error', (err) => {
      this.log.error('MQTT error:', err.message);
    });

    client.on('close', () => {
      this.log.debug('MQTT connection closed');
    });

    client.on('offline', () => {
      this.log.debug('MQTT client offline, will reconnect');
    });

    this.mqttClient = client;
  }

  private decodePayload(payload: Buffer): Record<string, unknown> {
    const data = JSON.parse(payload.toString('utf-8')) as Record<string, unknown>;
    if (typeof data.ext === 'string') {
      const parts = data.ext.split(',');
      const ext: Record<string, unknown> = {};
      for (let i = 0; i < EXT_FIELD_NAMES.length; i++) {
        const name = EXT_FIELD_NAMES[i];
        let value: string | number | undefined = parts[i];
        if (value !== undefined && EXT_INT_FIELDS.has(name)) {
          const n = parseInt(value, 10);
          if (!isNaN(n)) {
            value = n;
          }
        }
        ext[name] = value;
      }
      data.ext = ext;
    }
    return data;
  }
}
