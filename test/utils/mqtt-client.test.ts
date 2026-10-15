jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('mqtt', () => ({ connect: jest.fn() }));

import { EventEmitter } from 'events';
import axios from 'axios';
import mqtt from 'mqtt';
import type { Logging } from 'homebridge';
import { decodeMqttPayload, EzvizMqttClient } from '../../src/utils/mqtt-client';

/**
 * EZVIZ's `ext` field is a comma-separated string whose fields are positional
 * (see EXT_FIELD_NAMES in mqtt-client.ts) — this is where alert_type_code (person/
 * vehicle/pet classification) lives, so a transcription slip here would silently
 * corrupt every field after it with nothing to catch it.
 */
describe('decodeMqttPayload', () => {
  test('expands a comma-separated ext string into named fields', () => {
    const ext = [
      '1', '163000', 'DS123', '0', // channel_type, time, device_serial, channel_no
      '3', 'http://pic', '', '', // alert_type_code, default_pic_url, media_url_alt1, media_url_alt2
      '2', '1', 'file1', '0', // resource_type, status_flag, file_id, is_encrypted
      'checksum', '0', 'meta', 'msg1', // picChecksum, is_dev_video, metadata, msgId
      'img', 'DeviceName', 'res', '42', // image, device_name, reserved, sequence_number
    ].join(',');
    const payload = Buffer.from(JSON.stringify({ ext, msgSeq: 7 }));

    const decoded = decodeMqttPayload(payload);

    expect(decoded.msgSeq).toBe(7);
    expect(decoded.ext).toEqual({
      channel_type: 1,
      time: '163000', // an EZVIZ internal code, not a Unix timestamp — left as a string
      device_serial: 'DS123',
      channel_no: 0,
      alert_type_code: 3,
      default_pic_url: 'http://pic',
      media_url_alt1: '',
      media_url_alt2: '',
      resource_type: 2,
      status_flag: 1,
      file_id: 'file1',
      is_encrypted: 0,
      picChecksum: 'checksum',
      is_dev_video: 0,
      metadata: 'meta',
      msgId: 'msg1',
      image: 'img',
      device_name: 'DeviceName',
      reserved: 'res',
      sequence_number: 42,
    });
  });

  test('leaves ext untouched when it is already an object', () => {
    const payload = Buffer.from(JSON.stringify({ ext: { device_serial: 'ABC' } }));

    const decoded = decodeMqttPayload(payload);

    expect(decoded.ext).toEqual({ device_serial: 'ABC' });
  });

  test('fields past the end of a truncated ext string decode as undefined', () => {
    const payload = Buffer.from(JSON.stringify({ ext: '1,163000,DS123' }));

    const decoded = decodeMqttPayload(payload);

    expect((decoded.ext as Record<string, unknown>).device_serial).toBe('DS123');
    expect((decoded.ext as Record<string, unknown>).sequence_number).toBeUndefined();
  });

  test('a non-numeric value in an int field is left as the original string', () => {
    const payload = Buffer.from(JSON.stringify({ ext: 'not-a-number' }));

    const decoded = decodeMqttPayload(payload);

    expect((decoded.ext as Record<string, unknown>).channel_type).toBe('not-a-number');
  });

  test('throws on invalid JSON', () => {
    const payload = Buffer.from('not json');

    expect(() => decodeMqttPayload(payload)).toThrow();
  });
});

describe('EzvizMqttClient connection logging', () => {
  test('logs a lost connection and each reconnect at info level (#53)', async () => {
    (axios.post as jest.Mock)
      .mockResolvedValueOnce({ data: { status: 200, data: { clientId: 'client-1' } } })
      .mockResolvedValueOnce({ data: { status: 200, ticket: 'ticket-1' } });
    const socket = Object.assign(new EventEmitter(), { subscribe: jest.fn(), end: jest.fn() });
    (mqtt.connect as jest.Mock).mockReturnValue(socket);
    const log = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logging;

    const client = new EzvizMqttClient('push.example', 'session', 'user', jest.fn(), log);
    await client.connect();

    socket.emit('connect', { sessionPresent: false });
    expect(log.info).not.toHaveBeenCalled();

    socket.emit('offline');
    socket.emit('connect', { sessionPresent: true });
    expect(log.info).toHaveBeenCalledWith('MQTT connection lost, reconnecting');
    expect(log.info).toHaveBeenCalledWith('MQTT reconnected (broker kept session: yes)');

    client.stop();
  });
});
