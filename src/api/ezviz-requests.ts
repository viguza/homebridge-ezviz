import axios, { AxiosRequestConfig, Method, AxiosError } from 'axios';
import querystring from 'querystring';
import { Credentials, RefreshSession, RequestHeaders } from '../types/login.js';
import { EZVIZConfig } from '../types/config.js';
import { EZVIZ_CLIENT_TYPE, EZVIZ_USER_AGENT, API_ENDPOINT_REFRESH } from './ezviz-constants.js';

/**
 * Send a generic api request
 * @param {EZVIZConfig} config  The config used to authenticate request
 * @param {string} hostname     The base uri to send the request
 * @param {string} endpoint     The endpoint to send the request
 * @param {Method} method       Usually 'GET' or 'POST'
 * @param {ResponseType} type   The type of return object (Usually 'json')
 * @param {object} data         The body of the request or null if a 'GET'
 */
export async function sendRequest<T>(
  config: EZVIZConfig,
  hostname: string,
  endpoint: string,
  method: Method,
  data?: string,
  retries = 3,
): Promise<T> {
  const credentials = config.credentials;
   
  const headers: RequestHeaders = {
    'User-Agent': EZVIZ_USER_AGENT,
    'clientType': EZVIZ_CLIENT_TYPE,
    'Content-Type': method === 'POST' || method === 'PUT' ? 'application/x-www-form-urlencoded' : undefined,
    'sessionId': credentials.sessionId,
  };

  const url = hostname + endpoint;
  const req: AxiosRequestConfig = {
    method,
    url,
    data,
    headers,
    responseType: 'json',
  };

  try {
    const response = await axios(req);
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError;
    if (retries > 0 && axiosError.response?.status === 401) {
      const query = querystring.stringify({
        cuName: credentials.cuName,
        featureCode: credentials.featureCode,
        refreshSessionId: credentials.rfSessionId,
      });

      const refreshSession = (await sendRequest(
        config,
        config.domain,
        API_ENDPOINT_REFRESH,
        'PUT',
        query,
      )) as RefreshSession;
      
      const creds: Credentials = {
        sessionId: refreshSession.sessionInfo.sessionId,
        rfSessionId: refreshSession.sessionInfo.refreshSessionId,
        featureCode: credentials.featureCode,
        cuName: credentials.cuName,
      };

      config.credentials = creds;
      return await sendRequest(config, hostname, endpoint, method, data, retries - 1);
    } else {
      throw error;
    }
  }
}