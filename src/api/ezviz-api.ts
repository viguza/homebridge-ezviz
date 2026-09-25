import axios, { AxiosRequestConfig, Method } from 'axios';
import querystring from 'querystring';
import crypto, { randomBytes } from 'crypto';
import { Logging } from 'homebridge';
import { Domain, Credentials, Login, RefreshSession } from '../types/login.js';
import { ListDevicesResponse } from '../types/devices.js';
import { EZVIZConfig } from '../types/config.js';
import {
  EZVIZ_CLIENT_TYPE,
  EZVIZ_USER_AGENT,
  EZVIZ_BASE_API_URL,
  EZVIZ_DOMAINS_ENDPOINT,
  EZVIZ_AUTH_ENDPOINT,
  EZVIZ_DEVICES_ENDPOINT,
  EZVIZ_SWITCH_STATUS_ENDPOINT,
  EZVIZ_ALARMINFO_ENDPOINT,
  EZVIZ_SERVER_INFO_ENDPOINT,
  EZVIZ_DEFENCE_MODE_ENDPOINT,
  EZVIZ_DEFENCE_MODE_GET_ENDPOINT,
  API_ENDPOINT_REFRESH,
  RUSSIA_DOMAIN,
  RUSSIA_AREA_ID,
  DEFAULT_GROUP_ID,
  EZVIZ_REQUEST_TIMEOUT_MS,
  EZVIZ_BACKGROUND_REQUEST_TIMEOUT_MS,
  DEVICE_LIST_CACHE_TTL_MS,
} from './ezviz-constants.js';
import { DefenceMode } from '../utils/enums.js';
import { sendRequest } from './ezviz-requests.js';

/**
 * EZVIZ API client for interacting with EZVIZ services
 */
export class EZVIZAPI {
  private config: EZVIZConfig;
  public sessionId: string | null;
  private log: Logging | undefined;
  private deviceListCache: { data: ListDevicesResponse; expiresAt: number } | null = null;
  private deviceListInFlight: Promise<ListDevicesResponse> | null = null;
  // Bumped by every write, so a list fetch that was already in flight can tell its
  // result may predate the write.
  private deviceListGeneration = 0;
  private refreshInFlight: Promise<Credentials | undefined> | null = null;
  // Invoked after every successful session rotation, including ones triggered by a 401
  // mid-request, so anything bound to the old sessionId (the MQTT push subscription)
  // can re-establish itself.
  public onSessionRefreshed?: () => void;

  constructor(config: EZVIZConfig, log?: Logging) {
    this.config = config;
    this.sessionId = null;
    this.log = log;
  }

  /**
   * Generates a random string of specified length
   * @param length - The length of the string to generate
   * @returns Random string
   */
  randomStr(length: number): string {
    return randomBytes(length)
      .toString('base64')
      .slice(0, length)
      .replace(/\+/g, '0')
      .replace(/\//g, '0');
  }

  /**
   * Authenticates with the EZVIZ API
   * @returns Promise resolving to credentials or undefined if authentication fails
   */
  async authenticate(): Promise<Credentials | undefined> {
    if (!this.config.email || !this.config.password) {
      this.log?.error('Email and password are required for authentication');
      return;
    }

    const emailHash = crypto.createHash('md5').update(this.config.email).digest('hex');
    const passHash = crypto.createHash('md5').update(this.config.password).digest('hex');
    const data = querystring.stringify({
      account: this.config.email,
      featureCode: emailHash,
      password: passHash,
    });
    const config: AxiosRequestConfig = {
      method: 'post',
      timeout: EZVIZ_REQUEST_TIMEOUT_MS,
      url: `${this.config.domain}${EZVIZ_AUTH_ENDPOINT}`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'clienttype': EZVIZ_CLIENT_TYPE,
        'user-agent': EZVIZ_USER_AGENT,
      },
      data,
    };
  
    try {
      const response = await axios(config);
      const auth = response.data;
      
      if (auth.retcode) {
        this.log?.error(`Login error: ${auth.retcode}`);
        return;
      }
  
      if (auth.meta?.code === 6002) {
        this.log?.error('2 Factor Authentication accounts are not supported at this time.');
        return;
      }

      if (auth.meta?.code !== 200) {
        this.log?.error('Login error code:', auth.meta?.code);
        return;
      }
  
      if (auth.loginSession?.sessionId) {
        const login = auth as Login;
        const credentials: Credentials = {
          sessionId: login.loginSession.sessionId,
          rfSessionId: login.loginSession.rfSessionId,
          featureCode: emailHash,
          cuName: this.randomStr(24),
          username: login.loginUser?.username,
        };
        this.sessionId = login.loginSession.sessionId;
        this.config.credentials = credentials;
        return credentials;
      } else {
        this.log?.error('No sessionId found in login response');
        return;
      }
    } catch (error) {
      this.log?.error('Unable to login:', error);
      throw error;
    }
  }

  /**
   * Refreshes the session using the refresh token, falling back to full re-authentication
   * if the refresh token is missing or rejected. Concurrent callers (e.g. several requests
   * hitting 401 at once) share a single refresh.
   * @returns Promise resolving to updated credentials or undefined on failure
   */
  refreshSession(): Promise<Credentials | undefined> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.doRefreshSession()
        .then((credentials) => {
          if (credentials) {
            this.onSessionRefreshed?.();
          }
          return credentials;
        })
        .finally(() => {
          this.refreshInFlight = null;
        });
    }
    return this.refreshInFlight;
  }

  private async doRefreshSession(): Promise<Credentials | undefined> {
    const creds = this.config.credentials;

    if (!creds?.rfSessionId) {
      this.log?.debug('No refresh token available, falling back to full re-authentication');
      return this.authenticate();
    }

    const data = querystring.stringify({
      cuName: creds.cuName,
      featureCode: creds.featureCode,
      refreshSessionId: creds.rfSessionId,
    });

    const config: AxiosRequestConfig = {
      method: 'put',
      timeout: EZVIZ_REQUEST_TIMEOUT_MS,
      url: `${this.config.domain}${API_ENDPOINT_REFRESH}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'clientType': EZVIZ_CLIENT_TYPE,
        'User-Agent': EZVIZ_USER_AGENT,
        'sessionId': this.sessionId ?? '',
      },
      data,
    };

    try {
      const response = await axios(config);
      const result = response.data as RefreshSession;

      if (result.meta?.code !== 200) {
        this.log?.debug(`Session refresh rejected (code ${result.meta?.code}), falling back to full re-authentication`);
        return this.authenticate();
      }

      // Spread to keep username/pushAddr, which the MQTT reconnect after a refresh needs.
      const updated: Credentials = {
        ...creds,
        sessionId: result.sessionInfo.sessionId,
        rfSessionId: result.sessionInfo.refreshSessionId,
      };

      this.sessionId = updated.sessionId;
      this.config.credentials = updated;
      this.log?.debug('Session refreshed successfully');
      return updated;
    } catch (error) {
      this.log?.debug('Session refresh failed, falling back to full re-authentication:', error);
      return this.authenticate();
    }
  }

  /**
   * Gets the domain URL for the specified region
   * @param id - The region ID
   * @returns Promise resolving to the domain URL
   */
  async getDomain(id: number): Promise<string> {
    if (id === RUSSIA_AREA_ID) {
      return `https://${RUSSIA_DOMAIN}`;
    }

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'clientType': EZVIZ_CLIENT_TYPE,
      'User-Agent': EZVIZ_USER_AGENT,
    };
  
    const domainReq: AxiosRequestConfig = {
      headers: headers,
      method: 'POST',
      timeout: EZVIZ_REQUEST_TIMEOUT_MS,
      url: `${EZVIZ_BASE_API_URL}${EZVIZ_DOMAINS_ENDPOINT}`,
      data: querystring.stringify({
        areaId: id,
      }),
    };
  
    try {
      const response = await axios(domainReq);
      const domain = response.data as Domain;
      
      if (!domain.domain) {
        throw new Error('Invalid domain response from API');
      }
      
      return `https://${domain.domain}`;
    } catch (error) {
      this.log?.error('Error fetching domain:', error);
      throw error;
    }
  }

  private request<T>(
    endpoint: string,
    method: Method,
    data?: string,
    options: { timeoutMs?: number; networkRetries?: number } = {},
  ): Promise<T> {
    return sendRequest<T>(this.config, this.config.domain, endpoint, method, data, 3, {
      ...options,
      onUnauthorized: async () => Boolean(await this.refreshSession()),
    });
  }

  /**
   * Returns the MQTT push address from the server info endpoint.
   * Used to connect the MQTT client for real-time push notifications.
   */
  async getServiceUrls(): Promise<string | null> {
    try {
      const response = await this.request<Record<string, unknown>>(
        EZVIZ_SERVER_INFO_ENDPOINT,
        'GET',
        undefined,
        { timeoutMs: EZVIZ_BACKGROUND_REQUEST_TIMEOUT_MS, networkRetries: 2 },
      );
      const sysConfig = response?.systemConfigInfo as Record<string, unknown> | undefined;
      const pushAddr = (sysConfig?.pushAddr as string) ?? null;
      if (pushAddr && this.config.credentials) {
        this.config.credentials.pushAddr = pushAddr;
      }
      return pushAddr;
    } catch (error) {
      this.log?.debug('Could not fetch service URLs:', error);
      return null;
    }
  }

  /**
   * Lists all devices for the authenticated user.
   * Results are cached for DEVICE_LIST_CACHE_TTL_MS and concurrent callers share a
   * single upstream request, so N accessories reading state do not each trigger a
   * full account listing.
   * @param forceRefresh - Bypass the cache and fetch a fresh list
   * @returns Promise resolving to device list or undefined if failed
   */
  async listDevices(forceRefresh = false): Promise<ListDevicesResponse | undefined> {
    if (!this.sessionId) {
      try {
        await this.authenticate();
      } catch (error) {
        this.log?.error('Failed to authenticate before listing devices:', error);
        return;
      }
    }

    if (!forceRefresh && this.deviceListCache && this.deviceListCache.expiresAt > Date.now()) {
      this.log?.debug('Using cached device list');
      return this.deviceListCache.data;
    }

    const generation = this.deviceListGeneration;
    let request = forceRefresh ? null : this.deviceListInFlight;
    if (request) {
      this.log?.debug('Joining in-flight device list request');
    } else {
      request = this.startDeviceListFetch();
    }

    const result = await request;
    if (this.deviceListGeneration !== generation) {
      // A write landed while this was in flight, so the result may predate it; returning
      // it would revert the state the write just set.
      return this.listDevices();
    }
    return result;
  }

  private startDeviceListFetch(): Promise<ListDevicesResponse> {
    const generation = this.deviceListGeneration;
    const request = this.fetchDeviceList().then((info) => {
      if (this.deviceListGeneration === generation) {
        this.deviceListCache = { data: info, expiresAt: Date.now() + DEVICE_LIST_CACHE_TTL_MS };
      }
      return info;
    });
    this.deviceListInFlight = request;
    request
      .finally(() => {
        if (this.deviceListInFlight === request) {
          this.deviceListInFlight = null;
        }
      })
      .catch(() => {
        // Rejection is surfaced to the awaiting callers; this chain only clears state.
      });
    return request;
  }

  private async fetchDeviceList(): Promise<ListDevicesResponse> {
    try {
      const query = querystring.stringify({
        filter: 'CONNECTION,WIFI,SWITCH,STATUS,NODISTURB,P2P,FEATURE,DETECTOR',
        groupId: DEFAULT_GROUP_ID,
        limit: 30,
        offset: 0,
      });

      const info = await this.request<ListDevicesResponse>(
        `${EZVIZ_DEVICES_ENDPOINT}?${query}`,
        'GET',
        undefined,
        { timeoutMs: EZVIZ_BACKGROUND_REQUEST_TIMEOUT_MS, networkRetries: 2 },
      );
      return info;
    } catch (error) {
      this.log?.error('Error fetching devices:', error);
      throw error;
    }
  }

  /**
   * Drops the cached device list so the next read fetches fresh state.
   * Called after a write so a stale entry cannot revert the new value.
   */
  invalidateDeviceListCache(): void {
    this.deviceListCache = null;
    this.deviceListInFlight = null;
    this.deviceListGeneration++;
  }

  /**
   * Returns the most recent alarm's timestamp (ms) and snapshot URL for a device, or null
   * if it has no alarm history. Uses /v3/alarms/v2/advanced, which filters server-side by
   * deviceSerials — unlike /v3/unifiedmsg/list, which silently ignores that param and
   * always returns global results.
   */
  async getLatestAlarm(serialNumber: string): Promise<{ time: number; picUrl: string } | null> {
    if (!this.sessionId) {
      try {
        await this.authenticate();
      } catch (error) {
        this.log?.error('Failed to authenticate before fetching latest alarm:', error);
        throw error;
      }
    }

    try {
      const query = querystring.stringify({
        deviceSerials: serialNumber,
        queryType: -1,
        limit: 1,
        stype: -1,
      });

      const response = await this.request<{ alarms?: Array<{ alarmStartTime?: number; picUrl?: string }> }>(
        `${EZVIZ_ALARMINFO_ENDPOINT}?${query}`,
        'GET',
        undefined,
        { timeoutMs: EZVIZ_BACKGROUND_REQUEST_TIMEOUT_MS, networkRetries: 2 },
      );

      const latest = response?.alarms?.[0];
      if (!latest?.alarmStartTime) {
        return null;
      }

      return { time: latest.alarmStartTime, picUrl: latest.picUrl ?? '' };
    } catch (error) {
      this.log?.error('Error fetching latest alarm:', error);
      throw error;
    }
  }

  /**
   * Sets the state of a switch/plug
   * @param serialNumber - The device serial number
   * @param type - The switch type
   * @param value - The value to set (true/false)
   */
  async setSwitchState(serialNumber: string, type: number, value: boolean): Promise<void> {
    if (!serialNumber) {
      throw new Error('Serial number is required');
    }

    if (!this.sessionId) {
      try {
        await this.authenticate();
      } catch (error) {
        this.log?.error('Failed to authenticate before setting switch state:', error);
        throw error;
      }
    }

    const data = querystring.stringify({
      channel: 0,
      clientType: 1,
      enable: value ? 1 : 0,
      serial: serialNumber,
      type: type,
    });

    try {
      const response = await this.request<{ retcode?: number | string }>(EZVIZ_SWITCH_STATUS_ENDPOINT, 'POST', data);

      if (response?.retcode) {
        throw new Error(`Switch state update failed: ${response.retcode}`);
      }

      this.invalidateDeviceListCache();
    } catch (error) {
      this.log?.error('Error setting switch state:', error);
      throw error;
    }
  }

  /**
   * Gets the current state of a switch/plug
   * @param serialNumber - The device serial number
   * @param type - The switch type
   * @returns Promise resolving to the switch state
   */
  async getSwitchState(serialNumber: string, type: number): Promise<boolean> {
    if (!serialNumber) {
      throw new Error('Serial number is required');
    }

    if (!this.sessionId) {
      try {
        await this.authenticate();
      } catch (error) {
        this.log?.error('Failed to authenticate before getting switch state:', error);
        throw error;
      }
    }

    const deviceList = await this.listDevices();
    if (!deviceList) {
      const message = 'No devices found';
      this.log?.debug(message);
      throw new Error(message);
    }

    const deviceInfo = deviceList.deviceInfos?.find((device) => device.deviceSerial === serialNumber);
    if (!deviceInfo) {
      const message = `Device with serial ${serialNumber} was not found`;
      this.log?.debug(message);
      throw new Error(message);
    }

    if (deviceInfo?.status !== 1) {
      const message = `Device with serial ${serialNumber} is offline`;
      this.log?.debug(message);
      throw new Error(message);
    }

    const deviceSwitch = deviceList.SWITCH?.[serialNumber]?.find((device) => device.type === type);
    if (!deviceSwitch) {
      const message = `Switch for device serial ${serialNumber} was not found`;
      this.log?.debug(message);
      throw new Error(message);
    }

    return deviceSwitch?.enable;
  }

  /**
   * Sets the defence mode (alarm mode) for a group
   * @param groupId - The group ID (default: 1)
   * @param mode - The defence mode (DefenceMode enum value)
   * @returns Promise resolving when defence mode is set
   */
  async setDefenceMode(groupId: number = DEFAULT_GROUP_ID, mode: DefenceMode): Promise<void> {
    if (!Object.values(DefenceMode).includes(mode)) {
      throw new Error(`Invalid defence mode. Must be one of: ${Object.values(DefenceMode).join(', ')}`);
    }

    if (!this.sessionId) {
      try {
        await this.authenticate();
      } catch (error) {
        this.log?.error('Failed to authenticate before setting defence mode:', error);
        throw error;
      }
    }

    const query = querystring.stringify({
      groupId: groupId,
      mode: mode,
    });

    try {
      const response = await this.request<{ retcode?: string; meta?: { code?: number; message?: string } }>(
        `${EZVIZ_DEFENCE_MODE_ENDPOINT}?${query}`,
        'POST',
      );

      if (response?.retcode && response.retcode !== '200') {
        throw new Error(`Defence mode update failed: ${response.retcode}`);
      }

      if (response?.meta?.code && response.meta.code !== 200) {
        throw new Error(`Defence mode update failed: ${response.meta.code} - ${response.meta.message}`);
      }
    } catch (error) {
      this.log?.error('Error setting defence mode:', error);
      throw error;
    }
  }

  /**
   * Gets the current defence mode (alarm mode) for a group
   * @param groupId - The group ID (default: 1)
   * @returns Promise resolving to the current defence mode (DefenceMode enum value)
   */
  async getDefenceMode(groupId: number = DEFAULT_GROUP_ID): Promise<DefenceMode> {
    if (!this.sessionId) {
      try {
        await this.authenticate();
      } catch (error) {
        this.log?.error('Failed to authenticate before getting defence mode:', error);
        throw error;
      }
    }

    const query = querystring.stringify({
      groupId: groupId,
    });

    type DefenceModeResponse = {
      retcode?: string;
      meta?: { code?: number; message?: string };
      mode?: number | string;
      defenceMode?: number | string;
      data?: { mode?: number | string };
    };

    try {
      const response = await this.request<DefenceModeResponse>(
        `${EZVIZ_DEFENCE_MODE_GET_ENDPOINT}?${query}`,
        'GET',
        undefined,
        { timeoutMs: EZVIZ_BACKGROUND_REQUEST_TIMEOUT_MS, networkRetries: 2 },
      );

      if (response?.retcode && response.retcode !== '200') {
        throw new Error(`Failed to get defence mode: ${response.retcode}`);
      }

      if (response?.meta?.code && response.meta.code !== 200) {
        throw new Error(`Failed to get defence mode: ${response.meta.code} - ${response.meta.message}`);
      }

      // Extract the mode from the response
      // The response structure may vary, but typically it's in response.mode or response.defenceMode
      const mode = response?.mode || response?.defenceMode || response?.data?.mode;

      if (mode === undefined || mode === null) {
        this.log?.debug('No mode found in response, defaulting to UNSET_MODE');
        return DefenceMode.UNSET_MODE;
      }

      const modeValue = typeof mode === 'string' ? parseInt(mode, 10) : mode;

      if (!Object.values(DefenceMode).includes(modeValue as DefenceMode)) {
        this.log?.debug(`Unknown defence mode value: ${modeValue}, defaulting to UNSET_MODE`);
        return DefenceMode.UNSET_MODE;
      }

      return modeValue as DefenceMode;
    } catch (error) {
      this.log?.error('Error getting defence mode:', error);
      throw error;
    }
  }
}
