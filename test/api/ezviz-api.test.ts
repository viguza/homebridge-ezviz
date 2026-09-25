import axios from 'axios';
import { Logging } from 'homebridge';
import { EZVIZAPI } from '../../src/api/ezviz-api';
import { EZVIZConfig } from '../../src/types/config';
// import { Logging } from 'homebridge';
import { Credentials } from '../../src/types/login';
import { sendRequest } from '../../src/api/ezviz-requests';
import { DefenceMode } from '../../src/utils/enums';
import {
  RUSSIA_AREA_ID,
  RUSSIA_DOMAIN,
  DEVICE_LIST_CACHE_TTL_MS,
  EZVIZ_REQUEST_TIMEOUT_MS,
} from '../../src/api/ezviz-constants';

jest.mock('axios');
jest.mock('../../src/api/ezviz-requests', () => ({
  sendRequest: jest.fn(),
}));

describe('EZVIZAPI', () => {
  let ezvizApi: EZVIZAPI;
  let mockConfig: EZVIZConfig;
  let mockCredentials: Credentials;
  let mockLog: Logging;

  beforeEach(() => {
    mockCredentials = {
      sessionId: 'mockSessionId',
      rfSessionId: 'mockRfSessionId',
    } as Credentials;
    mockConfig = {
      email: 'test@example.com',
      password: 'password123',
      domain: 'https://test.ezviz.com',
      credentials: mockCredentials,
    } as EZVIZConfig;
    mockLog = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logging;
    ezvizApi = new EZVIZAPI(mockConfig, mockLog);
  });

  describe('randomStr', () => {
    test('randomStr should generate a string of given length', () => {
      const str = ezvizApi.randomStr(10);
      expect(str).toHaveLength(10);
    });
  });

  describe('authenticate', () => {
    test('should log an error and return if auth.retcode is present', async () => {
      const mockResponse = {
        data: {
          retcode: 1001,
        },
      };
      (axios as jest.MockedFunction<typeof axios>).mockResolvedValueOnce(mockResponse);
      const credentials = await ezvizApi.authenticate();
      expect(credentials).toBeUndefined();
      expect(mockLog.error).toHaveBeenCalledWith('Login error: 1001');
    });

    test('should log an error and return if meta.code is 6002', async () => {
      const mockResponse = {
        data: {
          meta: {
            code: 6002,
          },
        },
      };
      (axios as jest.MockedFunction<typeof axios>).mockResolvedValueOnce(mockResponse);
      const credentials = await ezvizApi.authenticate();
      expect(credentials).toBeUndefined();
      expect(mockLog.error).toHaveBeenCalledWith('2 Factor Authentication accounts are not supported at this time.');
    });

    test('should return undefined if sessionId is not present', async () => {
      const mockResponse = {
        data: {},
      };
      (axios as jest.MockedFunction<typeof axios>).mockResolvedValueOnce(mockResponse);
      const credentials = await ezvizApi.authenticate();
      expect(credentials).toBeUndefined();
    });

    test('should return credentials on success', async () => {
      const mockResponse = {
        data: {
          meta: {
            code: 200,
          },
          loginSession: {
            sessionId: 'mockSessionId',
            rfSessionId: 'mockRfSessionId',
          },
        },
      };
      (axios as jest.MockedFunction<typeof axios>).mockResolvedValueOnce(mockResponse);
      const credentials = await ezvizApi.authenticate();
      expect(credentials).toBeDefined();
      expect(credentials?.sessionId).toBe('mockSessionId');
    });

    test('should log error if login fails', async () => {
      (axios as jest.MockedFunction<typeof axios>).mockRejectedValueOnce(new Error('Login failed'));
      await expect(ezvizApi.authenticate()).rejects.toThrow('Login failed');
      expect(mockLog.error).toHaveBeenCalledWith('Unable to login:', expect.any(Error));
    });

    test('should log error and return if email is missing', async () => {
      ezvizApi = new EZVIZAPI({ ...mockConfig, email: undefined as unknown as string } as EZVIZConfig, mockLog);
      const credentials = await ezvizApi.authenticate();
      expect(credentials).toBeUndefined();
      expect(mockLog.error).toHaveBeenCalledWith('Email and password are required for authentication');
    });

    test('should log error and return if password is missing', async () => {
      ezvizApi = new EZVIZAPI({ ...mockConfig, password: undefined as unknown as string } as EZVIZConfig, mockLog);
      const credentials = await ezvizApi.authenticate();
      expect(credentials).toBeUndefined();
      expect(mockLog.error).toHaveBeenCalledWith('Email and password are required for authentication');
    });
  });

  describe('getDomain', () => {
    test('getDomain should return Russia domain string', async () => {
      const domain = await ezvizApi.getDomain(RUSSIA_AREA_ID);
      expect(domain).toBe(`https://${RUSSIA_DOMAIN}`);
    });

    test('getDomain should return domain string', async () => {
      const mockResponse = { data: { domain: 'api.ezviz.com' } };
      (axios as jest.MockedFunction<typeof axios>).mockResolvedValue(mockResponse);
      const domain = await ezvizApi.getDomain(1);
      expect(domain).toBe('https://api.ezviz.com');
    });

    test('should log error if get domain fails', async () => {
      (axios as jest.MockedFunction<typeof axios>).mockRejectedValueOnce(new Error('Get domain failed'));
      await expect(ezvizApi.getDomain(1)).rejects.toThrow('Get domain failed');
      expect(mockLog.error).toHaveBeenCalledWith('Error fetching domain:', expect.any(Error));
    });

    test('should throw error if domain response is invalid', async () => {
      const mockResponse = { data: {} };
      (axios as jest.MockedFunction<typeof axios>).mockResolvedValueOnce(mockResponse);
      await expect(ezvizApi.getDomain(1)).rejects.toThrow('Invalid domain response from API');
    });
  });

  describe('getServiceUrls', () => {
    test('should return the push address and store it on credentials', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({
        systemConfigInfo: { pushAddr: 'push.ezvizlife.com' },
      });
      const pushAddr = await ezvizApi.getServiceUrls();
      expect(pushAddr).toBe('push.ezvizlife.com');
      expect(mockConfig.credentials.pushAddr).toBe('push.ezvizlife.com');
    });

    test('should return null when pushAddr is absent from systemConfigInfo', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({ systemConfigInfo: {} });
      const pushAddr = await ezvizApi.getServiceUrls();
      expect(pushAddr).toBeNull();
      expect(mockConfig.credentials.pushAddr).toBeUndefined();
    });

    test('should return null when systemConfigInfo is absent', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({});
      const pushAddr = await ezvizApi.getServiceUrls();
      expect(pushAddr).toBeNull();
    });

    test('should return null and log a debug message instead of throwing on request failure', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockRejectedValueOnce(new Error('Network fail'));
      const pushAddr = await ezvizApi.getServiceUrls();
      expect(pushAddr).toBeNull();
      expect(mockLog.debug).toHaveBeenCalledWith('Could not fetch service URLs:', expect.any(Error));
    });
  });

  describe('refreshSession', () => {
    beforeEach(() => {
      ezvizApi.sessionId = 'mockSessionId';
    });

    test('should refresh credentials and update sessionId on success', async () => {
      const mockResponse = {
        data: {
          meta: { code: 200 },
          sessionInfo: {
            sessionId: 'newSessionId',
            refreshSessionId: 'newRfSessionId',
          },
        },
      };
      (axios as jest.MockedFunction<typeof axios>).mockResolvedValueOnce(mockResponse);

      const credentials = await ezvizApi.refreshSession();

      expect(credentials?.sessionId).toBe('newSessionId');
      expect(credentials?.rfSessionId).toBe('newRfSessionId');
      expect(ezvizApi.sessionId).toBe('newSessionId');
      expect(mockConfig.credentials.sessionId).toBe('newSessionId');
    });

    test('should preserve featureCode and cuName from existing credentials', async () => {
      const mockResponse = {
        data: {
          meta: { code: 200 },
          sessionInfo: {
            sessionId: 'newSessionId',
            refreshSessionId: 'newRfSessionId',
          },
        },
      };
      (axios as jest.MockedFunction<typeof axios>).mockResolvedValueOnce(mockResponse);

      const credentials = await ezvizApi.refreshSession();

      expect(credentials?.featureCode).toBe(mockCredentials.featureCode);
      expect(credentials?.cuName).toBe(mockCredentials.cuName);
    });

    test('should fall back to authenticate() when rfSessionId is missing', async () => {
      mockConfig.credentials = { ...mockCredentials, rfSessionId: undefined as unknown as string };
      const authenticateSpy = jest.spyOn(ezvizApi, 'authenticate').mockResolvedValueOnce(mockCredentials);
      const axiosCallsBefore = (axios as jest.MockedFunction<typeof axios>).mock.calls.length;

      await ezvizApi.refreshSession();

      expect(authenticateSpy).toHaveBeenCalledTimes(1);
      expect((axios as jest.MockedFunction<typeof axios>).mock.calls.length).toBe(axiosCallsBefore);
    });

    test('should fall back to authenticate() when API returns non-200', async () => {
      const mockResponse = {
        data: { meta: { code: 401 } },
      };
      (axios as jest.MockedFunction<typeof axios>).mockResolvedValueOnce(mockResponse);
      const authenticateSpy = jest.spyOn(ezvizApi, 'authenticate').mockResolvedValueOnce(mockCredentials);

      await ezvizApi.refreshSession();

      expect(authenticateSpy).toHaveBeenCalledTimes(1);
    });

    test('should fall back to authenticate() on network error', async () => {
      (axios as jest.MockedFunction<typeof axios>).mockRejectedValueOnce(new Error('Network error'));
      const authenticateSpy = jest.spyOn(ezvizApi, 'authenticate').mockResolvedValueOnce(mockCredentials);

      await ezvizApi.refreshSession();

      expect(authenticateSpy).toHaveBeenCalledTimes(1);
    });

    test('should preserve username and pushAddr, which the MQTT reconnect needs', async () => {
      mockConfig.credentials = { ...mockCredentials, username: 'ezvizUser', pushAddr: 'push.example.com' };
      (axios as jest.MockedFunction<typeof axios>).mockResolvedValueOnce({
        data: { meta: { code: 200 }, sessionInfo: { sessionId: 'newSessionId', refreshSessionId: 'newRfSessionId' } },
      });

      await ezvizApi.refreshSession();

      expect(mockConfig.credentials.username).toBe('ezvizUser');
      expect(mockConfig.credentials.pushAddr).toBe('push.example.com');
      expect(mockConfig.credentials.sessionId).toBe('newSessionId');
    });

    test('concurrent callers share a single refresh request', async () => {
      (axios as jest.MockedFunction<typeof axios>).mockReset();
      (axios as jest.MockedFunction<typeof axios>).mockResolvedValueOnce({
        data: { meta: { code: 200 }, sessionInfo: { sessionId: 'newSessionId', refreshSessionId: 'newRfSessionId' } },
      });

      const [a, b] = await Promise.all([ezvizApi.refreshSession(), ezvizApi.refreshSession()]);

      expect(axios).toHaveBeenCalledTimes(1);
      expect(a).toBe(b);
    });

    test('notifies onSessionRefreshed after a successful refresh', async () => {
      (axios as jest.MockedFunction<typeof axios>).mockResolvedValueOnce({
        data: { meta: { code: 200 }, sessionInfo: { sessionId: 'newSessionId', refreshSessionId: 'newRfSessionId' } },
      });
      const onSessionRefreshed = jest.fn();
      ezvizApi.onSessionRefreshed = onSessionRefreshed;

      await ezvizApi.refreshSession();

      expect(onSessionRefreshed).toHaveBeenCalledTimes(1);
    });

    test('does not notify onSessionRefreshed when refresh and re-auth both fail', async () => {
      (axios as jest.MockedFunction<typeof axios>).mockRejectedValueOnce(new Error('Network error'));
      jest.spyOn(ezvizApi, 'authenticate').mockResolvedValueOnce(undefined);
      const onSessionRefreshed = jest.fn();
      ezvizApi.onSessionRefreshed = onSessionRefreshed;

      await ezvizApi.refreshSession();

      expect(onSessionRefreshed).not.toHaveBeenCalled();
    });

    test('API requests rotate the session through refreshSession on 401', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({ alarms: [] });
      const refreshSpy = jest.spyOn(ezvizApi, 'refreshSession').mockResolvedValueOnce(mockCredentials);

      await ezvizApi.getLatestAlarm('12345');
      const options = (sendRequest as jest.MockedFunction<typeof sendRequest>).mock.calls.at(-1)?.[6];
      await expect(options?.onUnauthorized?.()).resolves.toBe(true);

      expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    test('should send PUT to the refresh endpoint with correct payload', async () => {
      const mockResponse = {
        data: {
          meta: { code: 200 },
          sessionInfo: { sessionId: 'newSessionId', refreshSessionId: 'newRfSessionId' },
        },
      };
      (axios as jest.MockedFunction<typeof axios>).mockResolvedValueOnce(mockResponse);

      await ezvizApi.refreshSession();

      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        method: 'put',
        url: expect.stringContaining('/v3/apigateway/login'),
        data: expect.stringContaining('refreshSessionId=mockRfSessionId'),
      }));
    });
  });

  describe('getLatestAlarm', () => {
    beforeEach(() => {
      ezvizApi.sessionId = 'mockSessionId';
    });

    test('returns the timestamp and picUrl of the most recent alarm', async () => {
      const nowMs = Date.now();
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({
        alarms: [{ alarmStartTime: nowMs, picUrl: 'https://example.com/pic.jpg' }],
      });
      const result = await ezvizApi.getLatestAlarm('12345');
      expect(result).toEqual({ time: nowMs, picUrl: 'https://example.com/pic.jpg' });
    });

    test('defaults picUrl to an empty string when absent', async () => {
      const nowMs = Date.now();
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({
        alarms: [{ alarmStartTime: nowMs }],
      });
      const result = await ezvizApi.getLatestAlarm('12345');
      expect(result).toEqual({ time: nowMs, picUrl: '' });
    });

    test('returns null when the alarms list is empty', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({
        alarms: [],
      });
      const result = await ezvizApi.getLatestAlarm('12345');
      expect(result).toBeNull();
    });

    test('returns null when alarmStartTime is missing', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({
        alarms: [{ picUrl: 'https://example.com/pic.jpg' }],
      });
      const result = await ezvizApi.getLatestAlarm('12345');
      expect(result).toBeNull();
    });

    test('concurrent calls for the same serial share one request', async () => {
      const sendRequestMock = sendRequest as jest.MockedFunction<typeof sendRequest>;
      sendRequestMock.mockReset();
      sendRequestMock.mockResolvedValue({ alarms: [{ alarmStartTime: 1000, picUrl: 'u' }] });

      const [a, b] = await Promise.all([ezvizApi.getLatestAlarm('12345'), ezvizApi.getLatestAlarm('12345')]);
      await ezvizApi.getLatestAlarm('67890');

      expect(a).toEqual(b);
      expect(sendRequestMock).toHaveBeenCalledTimes(2);
    });

    test('sends deviceSerials so the API filters server-side', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({ alarms: [] });
      await ezvizApi.getLatestAlarm('12345');
      expect(sendRequest).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.stringContaining('deviceSerials=12345'),
        'GET',
        undefined,
        expect.any(Number),
        expect.any(Object),
      );
    });

    test('throws and logs on API error', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockRejectedValueOnce(new Error('Network error'));
      await expect(ezvizApi.getLatestAlarm('12345')).rejects.toThrow('Network error');
      expect(mockLog.error).toHaveBeenCalledWith('Error fetching latest alarm:', expect.any(Error));
    });
  });

  describe('getDeviceList', () => {
    beforeEach(() => {
      ezvizApi.sessionId = 'mockSessionId';
    });

    test('listDevices should return device list', async () => {
      const mockDevices = { deviceInfos: [{ deviceSerial: '12345' }] };
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValue(mockDevices);
      const devices = await ezvizApi.listDevices();
      expect(devices).toEqual(mockDevices);
    });

    test('should log error if get devices fails', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockRejectedValueOnce(new Error('Get devices failed'));
      await expect(ezvizApi.listDevices()).rejects.toThrow('Get devices failed');
      expect(mockLog.error).toHaveBeenCalledWith('Error fetching devices:', expect.any(Error));
    });

    test('should log error and return if authentication fails', async () => {
      ezvizApi = new EZVIZAPI({ ...mockConfig, credentials: undefined as unknown as Credentials } as EZVIZConfig, mockLog);
      jest.spyOn(ezvizApi, 'authenticate').mockRejectedValueOnce(new Error('Auth failed'));
      const result = await ezvizApi.listDevices();
      expect(result).toBeUndefined();
      expect(mockLog.error).toHaveBeenCalledWith('Failed to authenticate before listing devices:', expect.any(Error));
    });
  });


  describe('setSwitchState', () => {
    beforeEach(() => {
      ezvizApi.sessionId = 'mockSessionId';
    });

    test('setSwitchState should send request', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValue({});
      await ezvizApi.setSwitchState('12345', 14, true);
      expect(sendRequest).toHaveBeenCalled();
    });

    test('should log error if set switch fails', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockRejectedValueOnce(new Error('Set switch state failed'));
      await expect(ezvizApi.setSwitchState('12345', 14, true)).rejects.toThrow('Set switch state failed');
      expect(mockLog.error).toHaveBeenCalledWith('Error setting switch state:', expect.any(Error));
    });

    test('should throw error if serialNumber is missing', async () => {
      await expect(ezvizApi.setSwitchState(undefined as unknown as string, 14, true)).rejects.toThrow('Serial number is required');
    });

    test('uses the current session and retries through refreshSession on 401', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({});
      const refreshSpy = jest.spyOn(ezvizApi, 'refreshSession').mockResolvedValueOnce(mockCredentials);

      await ezvizApi.setSwitchState('12345', 14, true);
      const call = (sendRequest as jest.MockedFunction<typeof sendRequest>).mock.calls.at(-1);
      expect(call?.[0]).toBe(mockConfig);
      expect(call?.[3]).toBe('POST');
      await call?.[6]?.onUnauthorized?.();

      expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    test('should log error and throw if authentication fails', async () => {
      ezvizApi.sessionId = null;
      jest.spyOn(ezvizApi, 'authenticate').mockRejectedValueOnce(new Error('Auth failed'));
      await expect(ezvizApi.setSwitchState('12345', 14, true)).rejects.toThrow('Auth failed');
      expect(mockLog.error).toHaveBeenCalledWith('Failed to authenticate before setting switch state:', expect.any(Error));
    });

    test('should throw error if switch state update fails with retcode', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({ retcode: 999 });
      await expect(ezvizApi.setSwitchState('12345', 14, true)).rejects.toThrow('Switch state update failed: 999');
    });
  });

  describe('getSwitchState', () => {
    beforeEach(() => {
      ezvizApi.sessionId = 'mockSessionId';
    });

    test('getSwitchState should return correct state', async () => {
      const mockDevices = {
        deviceInfos: [{ deviceSerial: '12345', status: 1 }],
        SWITCH: {
          '12345': [{ type: 14, enable: true }],
        },
      };
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValue(mockDevices);
      const state = await ezvizApi.getSwitchState('12345', 14);
      expect(state).toBe(true);
    });

    test('should throw error if serialNumber is missing', async () => {
      await expect(ezvizApi.getSwitchState(undefined as unknown as string, 14)).rejects.toThrow('Serial number is required');
    });

    test('should log error and throw if authentication fails', async () => {
      ezvizApi.sessionId = null;
      jest.spyOn(ezvizApi, 'authenticate').mockRejectedValueOnce(new Error('Auth failed'));
      await expect(ezvizApi.getSwitchState('12345', 14)).rejects.toThrow('Auth failed');
      expect(mockLog.error).toHaveBeenCalledWith('Failed to authenticate before getting switch state:', expect.any(Error));
    });

    test('should throw error if device is not found', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({ deviceInfos: [] });
      await expect(ezvizApi.getSwitchState('notfound', 14)).rejects.toThrow('Device with serial notfound was not found');
    });

    test('should throw error if device is offline', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({
        deviceInfos: [{ deviceSerial: '12345', status: 0 }],
        SWITCH: { '12345': [{ type: 14, enable: true }] },
      });
      await expect(ezvizApi.getSwitchState('12345', 14)).rejects.toThrow('Device with serial 12345 is offline');
    });

    test('should throw error if switch is not found', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({
        deviceInfos: [{ deviceSerial: '12345', status: 1 }],
        SWITCH: { '12345': [] },
      });
      await expect(ezvizApi.getSwitchState('12345', 14)).rejects.toThrow('Switch for device serial 12345 was not found');
    });
  });

  describe('setDefenceMode', () => {
    beforeEach(() => {
      ezvizApi.sessionId = 'mockSessionId';
    });

    test('should send request on success', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValue({});
      await ezvizApi.setDefenceMode(1, DefenceMode.AWAY_MODE);
      expect(sendRequest).toHaveBeenCalled();
    });

    test('uses the current session and retries through refreshSession on 401', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({});
      const refreshSpy = jest.spyOn(ezvizApi, 'refreshSession').mockResolvedValueOnce(mockCredentials);

      await ezvizApi.setDefenceMode(1, DefenceMode.AWAY_MODE);
      const call = (sendRequest as jest.MockedFunction<typeof sendRequest>).mock.calls.at(-1);
      expect(call?.[0]).toBe(mockConfig);
      expect(call?.[3]).toBe('POST');
      await call?.[6]?.onUnauthorized?.();

      expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    test('should throw error for an invalid defence mode value', async () => {
      await expect(ezvizApi.setDefenceMode(1, 99 as DefenceMode)).rejects.toThrow('Invalid defence mode');
    });

    test('should log error and throw if authentication fails', async () => {
      ezvizApi.sessionId = null;
      jest.spyOn(ezvizApi, 'authenticate').mockRejectedValueOnce(new Error('Auth failed'));
      await expect(ezvizApi.setDefenceMode(1, DefenceMode.AWAY_MODE)).rejects.toThrow('Auth failed');
      expect(mockLog.error).toHaveBeenCalledWith('Failed to authenticate before setting defence mode:', expect.any(Error));
    });

    test('should throw error if update fails with retcode', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({ retcode: '999' });
      await expect(ezvizApi.setDefenceMode(1, DefenceMode.AWAY_MODE)).rejects.toThrow('Defence mode update failed: 999');
    });

    test('should throw error if update fails with meta.code', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({
        meta: { code: 500, message: 'Server error' },
      });
      await expect(ezvizApi.setDefenceMode(1, DefenceMode.AWAY_MODE)).rejects.toThrow('Defence mode update failed: 500 - Server error');
    });

    test('should log error if request fails', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockRejectedValueOnce(new Error('Network fail'));
      await expect(ezvizApi.setDefenceMode(1, DefenceMode.AWAY_MODE)).rejects.toThrow('Network fail');
      expect(mockLog.error).toHaveBeenCalledWith('Error setting defence mode:', expect.any(Error));
    });
  });

  describe('getDefenceMode', () => {
    beforeEach(() => {
      ezvizApi.sessionId = 'mockSessionId';
    });

    test('should return the mode from response.mode', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({ mode: 2 });
      await expect(ezvizApi.getDefenceMode(1)).resolves.toBe(DefenceMode.AWAY_MODE);
    });

    test('should parse string mode values', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({ mode: '1' });
      await expect(ezvizApi.getDefenceMode(1)).resolves.toBe(DefenceMode.HOME_MODE);
    });

    test('should fall back to response.defenceMode when mode is absent', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({ defenceMode: 3 });
      await expect(ezvizApi.getDefenceMode(1)).resolves.toBe(DefenceMode.SLEEP_MODE);
    });

    test('should fall back to response.data.mode when top-level fields are absent', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({ data: { mode: 0 } });
      await expect(ezvizApi.getDefenceMode(1)).resolves.toBe(DefenceMode.UNSET_MODE);
    });

    test('treats a top-level mode of 0 as a real value rather than falling through', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({ mode: 0, defenceMode: DefenceMode.AWAY_MODE });
      await expect(ezvizApi.getDefenceMode(1)).resolves.toBe(DefenceMode.UNSET_MODE);
    });

    test('should default to UNSET_MODE when no mode is found in the response', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({});
      await expect(ezvizApi.getDefenceMode(1)).resolves.toBe(DefenceMode.UNSET_MODE);
    });

    test('should default to UNSET_MODE for an unrecognized mode value', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({ mode: 99 });
      await expect(ezvizApi.getDefenceMode(1)).resolves.toBe(DefenceMode.UNSET_MODE);
    });

    test('should throw error if response has retcode failure', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({ retcode: '999' });
      await expect(ezvizApi.getDefenceMode(1)).rejects.toThrow('Failed to get defence mode: 999');
    });

    test('should throw error if response has meta.code failure', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({
        meta: { code: 500, message: 'Server error' },
      });
      await expect(ezvizApi.getDefenceMode(1)).rejects.toThrow('Failed to get defence mode: 500 - Server error');
    });

    test('should log error and throw if authentication fails', async () => {
      ezvizApi.sessionId = null;
      jest.spyOn(ezvizApi, 'authenticate').mockRejectedValueOnce(new Error('Auth failed'));
      await expect(ezvizApi.getDefenceMode(1)).rejects.toThrow('Auth failed');
      expect(mockLog.error).toHaveBeenCalledWith('Failed to authenticate before getting defence mode:', expect.any(Error));
    });

    test('should log error and throw on request failure', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockRejectedValueOnce(new Error('Network fail'));
      await expect(ezvizApi.getDefenceMode(1)).rejects.toThrow('Network fail');
      expect(mockLog.error).toHaveBeenCalledWith('Error getting defence mode:', expect.any(Error));
    });
  });

  describe('device list caching', () => {
    const mockDevices = {
      deviceInfos: [{ deviceSerial: '12345', status: 1 }],
      SWITCH: { '12345': [{ type: 14, enable: true }] },
    };

    beforeEach(() => {
      ezvizApi.sessionId = 'mockSessionId';
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockReset();
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValue(mockDevices);
    });

    test('should reuse the cached device list within the TTL', async () => {
      await ezvizApi.listDevices();
      await ezvizApi.listDevices();

      expect(sendRequest).toHaveBeenCalledTimes(1);
    });

    test('should bypass the cache when forceRefresh is set', async () => {
      await ezvizApi.listDevices();
      await ezvizApi.listDevices(true);

      expect(sendRequest).toHaveBeenCalledTimes(2);
    });

    test('should refetch once the cached entry has expired', async () => {
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(0);
      await ezvizApi.listDevices();

      nowSpy.mockReturnValue(DEVICE_LIST_CACHE_TTL_MS + 1);
      await ezvizApi.listDevices();

      expect(sendRequest).toHaveBeenCalledTimes(2);
      nowSpy.mockRestore();
    });

    test('should collapse concurrent reads into a single upstream request', async () => {
      const [first, second, third] = await Promise.all([
        ezvizApi.listDevices(),
        ezvizApi.listDevices(),
        ezvizApi.getSwitchState('12345', 14),
      ]);

      expect(sendRequest).toHaveBeenCalledTimes(1);
      expect(first).toEqual(mockDevices);
      expect(second).toEqual(mockDevices);
      expect(third).toBe(true);
    });

    test('should not cache a failed request', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockRejectedValueOnce(new Error('Get devices failed'));
      await expect(ezvizApi.listDevices()).rejects.toThrow('Get devices failed');

      const devices = await ezvizApi.listDevices();
      expect(devices).toEqual(mockDevices);
      expect(sendRequest).toHaveBeenCalledTimes(2);
    });

    test('fetches and merges every page of the device list', async () => {
      const sendRequestMock = sendRequest as jest.MockedFunction<typeof sendRequest>;
      sendRequestMock.mockReset();
      sendRequestMock
        .mockResolvedValueOnce({
          deviceInfos: [{ deviceSerial: 'A' }, { deviceSerial: 'B' }],
          SWITCH: { A: [], B: [] },
          Page: { Offset: 0, Limit: 2, TotalResults: 3, HasNext: true },
        })
        .mockResolvedValueOnce({
          deviceInfos: [{ deviceSerial: 'C' }],
          SWITCH: { C: [] },
          Page: { Offset: 2, Limit: 2, TotalResults: 3, HasNext: false },
        });

      const result = await ezvizApi.listDevices(true);

      expect(result?.deviceInfos.map((d) => d.deviceSerial)).toEqual(['A', 'B', 'C']);
      expect(Object.keys(result?.SWITCH ?? {})).toEqual(['A', 'B', 'C']);
      expect(sendRequestMock).toHaveBeenCalledTimes(2);
      expect(sendRequestMock.mock.calls[1][2]).toContain('offset=2');
    });

    test('a list fetch that was in flight during a write neither returns nor caches its stale result', async () => {
      const stale = { deviceInfos: [], SWITCH: { '12345': [{ type: 14, enable: false }] } };
      const fresh = { deviceInfos: [], SWITCH: { '12345': [{ type: 14, enable: true }] } };
      let resolveStale: (value: unknown) => void = () => {};
      const sendRequestMock = sendRequest as jest.MockedFunction<typeof sendRequest>;
      sendRequestMock.mockReset();
      sendRequestMock
        .mockImplementationOnce(() => new Promise((resolve) => {
          resolveStale = resolve;
        }))
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce(fresh);

      const inFlight = ezvizApi.listDevices();
      await ezvizApi.setSwitchState('12345', 14, true);
      resolveStale(stale);

      expect(await inFlight).toBe(fresh);
      expect(await ezvizApi.listDevices()).toBe(fresh);
      expect(sendRequestMock).toHaveBeenCalledTimes(3);
    });

    test('should invalidate the cache after a switch write', async () => {
      await ezvizApi.listDevices();
      await ezvizApi.setSwitchState('12345', 14, true);
      await ezvizApi.listDevices();

      const deviceListCalls = (sendRequest as jest.MockedFunction<typeof sendRequest>).mock.calls
        .filter(([, , endpoint]) => endpoint.startsWith('/v3/userdevices/v1/resources/pagelist'));
      expect(deviceListCalls).toHaveLength(2);
    });
  });

  describe('request timeouts', () => {
    test('should bound the authentication request', async () => {
      (axios as jest.MockedFunction<typeof axios>).mockResolvedValueOnce({ data: { meta: { code: 200 } } });
      await ezvizApi.authenticate();

      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        timeout: EZVIZ_REQUEST_TIMEOUT_MS,
      }));
    });
  });
});
