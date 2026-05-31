import axios, { AxiosRequestConfig } from 'axios';
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
  EZVIZ_UNIFIEDMSG_ENDPOINT,
  EZVIZ_DEFENCE_MODE_ENDPOINT,
  EZVIZ_DEFENCE_MODE_GET_ENDPOINT,
  API_ENDPOINT_REFRESH,
  RUSSIA_DOMAIN,
  RUSSIA_AREA_ID,
  DEFAULT_GROUP_ID,
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
   * if the refresh token is missing or rejected.
   * @returns Promise resolving to updated credentials or undefined on failure
   */
  async refreshSession(): Promise<Credentials | undefined> {
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

      const updated: Credentials = {
        sessionId: result.sessionInfo.sessionId,
        rfSessionId: result.sessionInfo.refreshSessionId,
        featureCode: creds.featureCode,
        cuName: creds.cuName,
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

  /**
   * Lists all devices for the authenticated user
   * @returns Promise resolving to device list or undefined if failed
   */
  async listDevices(): Promise<ListDevicesResponse | undefined> {
    if (!this.sessionId) {
      try {
        await this.authenticate();
      } catch (error) {
        this.log?.error('Failed to authenticate before listing devices:', error);
        return;
      }
    }

    try {
      const query = querystring.stringify({
        filter: 'CONNECTION,SWITCH,STATUS,NODISTURB,P2P,FEATURE,DETECTOR',
        groupId: DEFAULT_GROUP_ID,
        limit: 30,
        offset: 0,
      });

      const info = await sendRequest(this.config, this.config.domain, `${EZVIZ_DEVICES_ENDPOINT}?${query}`, 'GET');
      return info as ListDevicesResponse;
    } catch (error) {
      this.log?.error('Error fetching devices:', error);
      throw error;
    }
  }

  /**
   * Returns the timestamp (ms) of the most recent alarm for a device, or null if none.
   * Fetches up to 10 recent messages and filters client-side — the API ignores the
   * deviceSerials query param and always returns global results.
   * The EZVIZ API may return the epoch in seconds or milliseconds; values > 1e10 are ms.
   */
  async getLastAlarmTime(serialNumber: string): Promise<number | null> {
    if (!this.sessionId) {
      try {
        await this.authenticate();
      } catch (error) {
        this.log?.error('Failed to authenticate before fetching alarm time:', error);
        throw error;
      }
    }

    try {
      const query = querystring.stringify({
        deviceSerials: serialNumber,
        limit: 10,
        stype: '92',
      });

      const response = await sendRequest(
        this.config,
        this.config.domain,
        `${EZVIZ_UNIFIEDMSG_ENDPOINT}?${query}`,
        'GET',
      ) as { message?: Array<{ time?: number | string; deviceSerial?: string }>; messages?: Array<{ time?: number | string; deviceSerial?: string }> };

      const messages = response?.message ?? response?.messages ?? [];
      this.log?.debug(`getLastAlarmTime(${serialNumber}): ${messages.length} message(s), first deviceSerial=${messages[0]?.deviceSerial ?? 'none'}`);

      const latest = messages.find(m => m.deviceSerial === serialNumber);
      if (!latest?.time) {
        return null;
      }

      const ts = typeof latest.time === 'string' ? parseFloat(latest.time) : latest.time;
      return isNaN(ts) ? null : (ts > 1e10 ? ts : ts * 1000);
    } catch (error) {
      this.log?.error('Error fetching last alarm time:', error);
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

    const config: AxiosRequestConfig = {
      method: 'post',
      url: `${this.config.domain}${EZVIZ_SWITCH_STATUS_ENDPOINT}`,
      headers: {
        'sessionid': this.sessionId,
        'clienttype': EZVIZ_CLIENT_TYPE,
        'user-agent': EZVIZ_USER_AGENT,
      },
      data: querystring.stringify({
        channel: 0,
        clientType: 1,
        enable: value ? 1 : 0,
        serial: serialNumber,
        type: type,
      }),
    };

    try {
      const response = await axios(config);
      
      if (response.data?.retcode) {
        throw new Error(`Switch state update failed: ${response.data.retcode}`);
      }
      
      return response.data;
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

    const config: AxiosRequestConfig = {
      method: 'post',
      url: `${this.config.domain}${EZVIZ_DEFENCE_MODE_ENDPOINT}?${query}`,
      headers: {
        'sessionid': this.sessionId,
        'clienttype': EZVIZ_CLIENT_TYPE,
        'user-agent': EZVIZ_USER_AGENT,
      },
    };

    try {
      const response = await axios(config);

      if (response.data?.retcode && response.data.retcode !== '200') {
        throw new Error(`Defence mode update failed: ${response.data.retcode}`);
      }

      if (response.data?.meta?.code && response.data.meta.code !== 200) {
        throw new Error(`Defence mode update failed: ${response.data.meta.code} - ${response.data.meta.message}`);
      }

      return response.data;
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

    const config: AxiosRequestConfig = {
      method: 'get',
      url: `${this.config.domain}${EZVIZ_DEFENCE_MODE_GET_ENDPOINT}?${query}`,
      headers: {
        'sessionid': this.sessionId,
        'clienttype': EZVIZ_CLIENT_TYPE,
        'user-agent': EZVIZ_USER_AGENT,
      },
    };

    try {
      const response = await axios(config);

      if (response.data?.retcode && response.data.retcode !== '200') {
        throw new Error(`Failed to get defence mode: ${response.data.retcode}`);
      }

      if (response.data?.meta?.code && response.data.meta.code !== 200) {
        throw new Error(`Failed to get defence mode: ${response.data.meta.code} - ${response.data.meta.message}`);
      }

      // Extract the mode from the response
      // The response structure may vary, but typically it's in response.data.mode or response.data.defenceMode
      const mode = response.data?.mode || response.data?.defenceMode || response.data?.data?.mode;

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
