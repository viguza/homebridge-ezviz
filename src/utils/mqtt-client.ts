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

export type MqttMessageCallback = (deviceSerial: string, alarmTime: number) => void;

export class EzvizMqttClient {
  private mqttClient: MqttClient | null = null;
  private clientId: string | null = null;
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
    if (response.data?.status !== 200) {
      throw new Error(`MQTT registration failed: ${JSON.stringify(response.data)}`);
    }
    return response.data.data.clientId as string;
  }

  private async startPush(): Promise<void> {
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
    if (response.data?.status !== 200) {
      throw new Error(`MQTT push start failed: ${JSON.stringify(response.data)}`);
    }
    this.log.debug(`MQTT push started (clientId: ${this.clientId})`);
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

    client.on('connect', () => {
      this.log.debug('MQTT connected');
      client.subscribe(this.topic, { qos: 2 });
    });

    client.on('message', (_topic, payload) => {
      try {
        const decoded = this.decodePayload(payload);
        const ext = decoded.ext as Record<string, unknown>;
        const serial = ext?.device_serial as string;
        const time = ext?.time;
        if (!serial || !time) {
          return;
        }
        const ts = typeof time === 'string' ? parseFloat(time) : Number(time);
        if (!isNaN(ts)) {
          this.onMessage(serial, ts > 1e10 ? ts : ts * 1000);
        }
      } catch (err) {
        this.log.debug('MQTT message decode error:', err);
      }
    });

    client.on('error', (err) => {
      this.log.error('MQTT error:', err.message);
    });

    client.on('disconnect', () => {
      this.log.debug('MQTT disconnected');
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
