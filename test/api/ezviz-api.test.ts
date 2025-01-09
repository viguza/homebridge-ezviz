import axios from 'axios';
import { Logging } from 'homebridge';
import { EZVIZAPI } from '../../src/api/ezviz-api';
import { EZVIZConfig } from '../../src/types/config';
// import { Logging } from 'homebridge';
import { Credentials } from '../../src/types/connection';
import { sendRequest } from '../../src/api/ezviz-requests';

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
      expect(mockLog.error).toHaveBeenCalledWith('Unable to login', expect.any(Error));
    });
  });

  describe('getDomain', () => {
    test('getDomain should return domain string', async () => {
      const mockResponse = { data: { domain: 'api.ezviz.com' } };
      (axios as jest.MockedFunction<typeof axios>).mockResolvedValue(mockResponse);
      const domain = await ezvizApi.getDomain(1);
      expect(domain).toBe('https://api.ezviz.com');
    });

    test('should log error if get domain fails', async () => {
      (axios as jest.MockedFunction<typeof axios>).mockRejectedValueOnce(new Error('Get domain failed'));
      await expect(ezvizApi.getDomain(1)).rejects.toThrow('Get domain failed');
      expect(mockLog.error).toHaveBeenCalledWith('Error fetching domain', expect.any(Error));
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
      expect(mockLog.error).toHaveBeenCalledWith('Error fetching devices', expect.any(Error));
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
      expect(mockLog.error).toHaveBeenCalledWith('Error setting switch state', expect.any(Error));
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
  });
});
