import axios from 'axios';
import { Logging } from 'homebridge';
import { EZVIZAPI } from '../../src/api/ezviz-api';
import { EZVIZConfig } from '../../src/types/config';
// import { Logging } from 'homebridge';
import { Credentials } from '../../src/types/login';
import { sendRequest } from '../../src/api/ezviz-requests';
import { RUSSIA_AREA_ID, RUSSIA_DOMAIN } from '../../src/api/ezviz-constants';

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

  describe('getLastAlarmTime', () => {
    beforeEach(() => {
      ezvizApi.sessionId = 'mockSessionId';
    });

    test('returns ms timestamp when API returns ms epoch', async () => {
      const nowMs = Date.now();
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({
        message: [{ deviceSerial: '12345', time: nowMs }],
      });
      const result = await ezvizApi.getLastAlarmTime('12345');
      expect(result).toBe(nowMs);
    });

    test('converts seconds epoch to ms', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({
        message: [{ deviceSerial: '12345', time: nowSec }],
      });
      const result = await ezvizApi.getLastAlarmTime('12345');
      expect(result).toBe(nowSec * 1000);
    });

    test('parses string timestamps', async () => {
      const nowMs = Date.now();
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({
        message: [{ deviceSerial: '12345', time: String(nowMs) }],
      });
      const result = await ezvizApi.getLastAlarmTime('12345');
      expect(result).toBe(nowMs);
    });

    test('returns null when message list is empty', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({
        message: [],
      });
      const result = await ezvizApi.getLastAlarmTime('12345');
      expect(result).toBeNull();
    });

    test('returns null when time field is missing', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockResolvedValueOnce({
        message: [{ deviceSerial: '12345' }],
      });
      const result = await ezvizApi.getLastAlarmTime('12345');
      expect(result).toBeNull();
    });

    test('throws and logs on API error', async () => {
      (sendRequest as jest.MockedFunction<typeof sendRequest>).mockRejectedValueOnce(new Error('Network error'));
      await expect(ezvizApi.getLastAlarmTime('12345')).rejects.toThrow('Network error');
      expect(mockLog.error).toHaveBeenCalledWith('Error fetching last alarm time:', expect.any(Error));
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
      (axios as jest.MockedFunction<typeof axios>).mockResolvedValue({ data: {} });
      await ezvizApi.setSwitchState('12345', 14, true);
      expect(axios).toHaveBeenCalled();
    });

    test('should log error if set switch fails', async () => {
      (axios as jest.MockedFunction<typeof axios>).mockRejectedValueOnce(new Error('Set switch state failed'));
      await expect(ezvizApi.setSwitchState('12345', 14, true)).rejects.toThrow('Set switch state failed');
      expect(mockLog.error).toHaveBeenCalledWith('Error setting switch state:', expect.any(Error));
    });

    test('should throw error if serialNumber is missing', async () => {
      await expect(ezvizApi.setSwitchState(undefined as unknown as string, 14, true)).rejects.toThrow('Serial number is required');
    });

    test('should log error and throw if authentication fails', async () => {
      ezvizApi.sessionId = null;
      jest.spyOn(ezvizApi, 'authenticate').mockRejectedValueOnce(new Error('Auth failed'));
      await expect(ezvizApi.setSwitchState('12345', 14, true)).rejects.toThrow('Auth failed');
      expect(mockLog.error).toHaveBeenCalledWith('Failed to authenticate before setting switch state:', expect.any(Error));
    });

    test('should throw error if switch state update fails with retcode', async () => {
      (axios as jest.MockedFunction<typeof axios>).mockResolvedValueOnce({ data: { retcode: 999 } });
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
});
