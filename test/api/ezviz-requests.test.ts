import axios from 'axios';
import { sendRequest } from '../../src/api/ezviz-requests';
import { EZVIZConfig } from '../../src/types/config';
import { Credentials } from '../../src/types/login';
import { API_ENDPOINT_REFRESH, EZVIZ_REQUEST_TIMEOUT_MS } from '../../src/api/ezviz-constants';

jest.mock('axios');

describe('sendRequest', () => {
  let mockConfig: EZVIZConfig;
  let mockCredentials: Credentials;

  beforeEach(() => {
    (axios as jest.MockedFunction<typeof axios>).mockReset();
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
      'timeout': EZVIZ_REQUEST_TIMEOUT_MS,
    }));
  });

  test('on 401, rotates the session via onUnauthorized and retries with the new sessionId', async () => {
    const mockSuccessResponse = { data: { success: true } };
    (axios as jest.MockedFunction<typeof axios>)
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce(mockSuccessResponse);
    const onUnauthorized = jest.fn(async () => {
      mockConfig.credentials = { ...mockCredentials, sessionId: 'newSessionId' };
      return true;
    });

    const result = await sendRequest(mockConfig, 'https://test.ezviz.com', '/test', 'GET', undefined, 3, { onUnauthorized });

    expect(result).toEqual(mockSuccessResponse.data);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(axios).toHaveBeenCalledTimes(2);
    expect((axios as jest.MockedFunction<typeof axios>).mock.calls[1][0]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ sessionId: 'newSessionId' }),
    }));
  });

  test('on 401, gives up without retrying when the session could not be rotated', async () => {
    const error401 = { response: { status: 401 } };
    (axios as jest.MockedFunction<typeof axios>).mockRejectedValueOnce(error401);
    const onUnauthorized = jest.fn(async () => false);

    await expect(sendRequest(mockConfig, 'https://test.ezviz.com', '/test', 'GET', undefined, 3, { onUnauthorized }))
      .rejects.toBe(error401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(axios).toHaveBeenCalledTimes(1);
  });

  test('on persistent 401, stops after the retry budget instead of looping', async () => {
    (axios as jest.MockedFunction<typeof axios>).mockRejectedValue({ response: { status: 401 } });
    const onUnauthorized = jest.fn(async () => true);

    await expect(sendRequest(mockConfig, 'https://test.ezviz.com', '/test', 'GET', undefined, 2, { onUnauthorized }))
      .rejects.toEqual({ response: { status: 401 } });
    expect(onUnauthorized).toHaveBeenCalledTimes(2);
    expect(axios).toHaveBeenCalledTimes(3);
  });

  test('should throw error if request fails without retries', async () => {
    (axios as jest.MockedFunction<typeof axios>).mockRejectedValueOnce(new Error('Request failed'));
    await expect(sendRequest(mockConfig, 'https://test.ezviz.com', '/test', 'GET', undefined, 0)).rejects.toThrow('Request failed');
  });
});