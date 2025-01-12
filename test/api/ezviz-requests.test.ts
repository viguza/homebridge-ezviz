import axios from 'axios';
import { sendRequest } from '../../src/api/ezviz-requests';
import { EZVIZConfig } from '../../src/types/config';
import { Credentials } from '../../src/types/login';
import { API_ENDPOINT_REFRESH } from '../../src/api/ezviz-constants';

jest.mock('axios');

describe('sendRequest', () => {
  let mockConfig: EZVIZConfig;
  let mockCredentials: Credentials;

  beforeEach(() => {
    mockCredentials = {
      sessionId: 'mockSessionId',
      rfSessionId: 'mockRfSessionId',
      cuName: 'mockCuName',
      featureCode: 'mockFeatureCode',
    };
    mockConfig = {
      region: 1,
      platform: 'test',
      email: 'test@example.com',
      password: 'password123',
      domain: 'https://test.ezviz.com',
      credentials: mockCredentials,
    };
  });

  test('should send a successful request', async () => {
    const mockResponse = { data: { success: true } };
    (axios as jest.MockedFunction<typeof axios>).mockResolvedValueOnce(mockResponse);

    const result = await sendRequest(mockConfig, 'https://test.ezviz.com', API_ENDPOINT_REFRESH, 'GET');
    expect(result).toEqual(mockResponse.data);
    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      'data': undefined,
      'headers': {
        'Content-Type': undefined,
        'User-Agent': 'EZVIZ/4.9.2 (iPhone; iOS 14.3; Scale/3.00)',
        'clientType': '1',
        'sessionId': 'mockSessionId',
      },
      'method': 'GET',
      'responseType': 'json',
      'url': 'https://test.ezviz.com/v3/apigateway/login',
    }));
  });

  test('should retry request on 401 error and refresh session', async () => {
    const mock401Error = {
      response: {
        status: 401,
      },
    };
    const mockRefreshResponse = {
      data: {
        sessionInfo: {
          sessionId: 'newSessionId',
          refreshSessionId: 'newRfSessionId',
        },
      },
    };
    const mockSuccessResponse = { data: { success: true } };

    (axios as jest.MockedFunction<typeof axios>)
      .mockRejectedValueOnce(mock401Error)
      .mockResolvedValueOnce(mockRefreshResponse)
      .mockResolvedValueOnce(mockSuccessResponse);

    const result = await sendRequest(mockConfig, 'https://test.ezviz.com', API_ENDPOINT_REFRESH, 'GET');
    expect(result).toEqual(mockSuccessResponse.data);
    expect(axios).toHaveBeenCalledTimes(4);
    expect(mockConfig.credentials.sessionId).toBe('newSessionId');
  });

  test('should throw error if request fails without retries', async () => {
    (axios as jest.MockedFunction<typeof axios>).mockRejectedValueOnce(new Error('Request failed'));
    await expect(sendRequest(mockConfig, 'https://test.ezviz.com', '/test', 'GET', undefined, 0)).rejects.toThrow('Request failed');
  });
});