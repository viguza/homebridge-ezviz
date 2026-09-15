import axios, { AxiosRequestConfig, Method, AxiosError } from 'axios';
import querystring from 'querystring';
import { Credentials, RefreshSession, RequestHeaders } from '../types/login.js';
import { EZVIZConfig } from '../types/config.js';
import { EZVIZ_CLIENT_TYPE, EZVIZ_USER_AGENT, API_ENDPOINT_REFRESH, EZVIZ_REQUEST_TIMEOUT_MS } from './ezviz-constants.js';

/**
 * True for errors worth retrying: no response was received (timeout, DNS, connection
 * reset, etc.) or the server reported a transient 5xx. A response with a 4xx status is
 * never retried here since retrying won't change the outcome.
 */
export function isRetryableError(error: unknown): boolean {
  const axiosError = error as AxiosError;
  if (axiosError.response) {
    return axiosError.response.status >= 500;
  }
  return Boolean(axiosError.isAxiosError);
}

/**
 * Runs `fn`, retrying up to `retries` times with jittered exponential backoff when the
 * failure looks transient (see isRetryableError). Used for background polls that can
 * afford to wait a bit longer, never for HomeKit-blocking reads.
 */
export async function withNetworkRetry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries || !isRetryableError(error)) {
        throw error;
      }
      const delayMs = 500 * 2 ** attempt + Math.random() * 250;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      attempt++;
    }
  }
}

/**
 * Send a generic api request
 * @param {EZVIZConfig} config  The config used to authenticate request
 * @param {string} hostname     The base uri to send the request
 * @param {string} endpoint     The endpoint to send the request
 * @param {Method} method       Usually 'GET' or 'POST'
 * @param {ResponseType} type   The type of return object (Usually 'json')
 * @param {object} data         The body of the request or null if a 'GET'
 * @param {object} options      timeoutMs overrides the default request timeout;
 *                              networkRetries (default 0) retries transient network
 *                              errors with backoff before giving up. Leave both unset
 *                              for requests on a HomeKit-blocking read path.
 */
export async function sendRequest<T>(
  config: EZVIZConfig,
  hostname: string,
  endpoint: string,
  method: Method,
  data?: string,
  retries = 3,
  options: { timeoutMs?: number; networkRetries?: number } = {},
): Promise<T> {
  const { timeoutMs = EZVIZ_REQUEST_TIMEOUT_MS, networkRetries = 0 } = options;
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
    timeout: timeoutMs,
  };

  try {
    const response = await withNetworkRetry(() => axios(req), networkRetries);
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
      return await sendRequest(config, hostname, endpoint, method, data, retries - 1, options);
    } else {
      throw error;
    }
  }
}