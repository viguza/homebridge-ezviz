import axios, { AxiosRequestConfig } from 'axios';
import querystring from 'querystring';
import crypto, { randomBytes } from 'crypto';
import { Logging } from 'homebridge';
import { Domain, Credentials, Login } from '../types/login.js';
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
  RUSSIA_DOMAIN,
  RUSSIA_AREA_ID,
} from './ezviz-constants.js';
import { sendRequest } from './ezviz-requests.js';

export class EZVIZAPI {
  private config: EZVIZConfig;
  public sessionId: string | null;
  private log: Logging | undefined;

  constructor(config: EZVIZConfig, log?: Logging) {
    this.config = config;
    this.sessionId = null;
    this.log = log;
  }

  randomStr(length: number): string {
    return randomBytes(length)
      .toString('base64')
      .slice(0, length)
      .replace(/\+/g, '0')
      .replace(/\//g, '0');
  }

  async authenticate(): Promise<Credentials | undefined> {
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
      this.log?.error('Unable to login', error);
      throw error;
    }
  }

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
      return `https://${domain.domain}`;
    } catch (error) {
      this.log?.error('Error fetching domain', error);
      throw error;
    }
  }

  async listDevices(): Promise<ListDevicesResponse | undefined> {
    if (!this.sessionId) {
      await this.authenticate();
    }

    try {
      const query = querystring.stringify({
        filter: 'CONNECTION,SWITCH,STATUS,NODISTURB,P2P,FEATURE,DETECTOR',
        groupId: -1,
        limit: 30,
        offset: 0,
      });

      const info = await sendRequest(this.config, this.config.domain, `${EZVIZ_DEVICES_ENDPOINT}?${query}`, 'GET');
      return info as ListDevicesResponse;
    } catch (error) {
      this.log?.error('Error fetching devices', error);
      throw error;
    }
  }

  async setSwitchState(serialNumber: string, type: number, value: boolean): Promise<void> {
    if (!this.sessionId) {
      await this.authenticate();
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
      return response.data;
    } catch (error) {
      this.log?.error('Error setting switch state', error);
      throw error;
    }
  }

  async getSwitchState(serialNumber: string, type: number): Promise<boolean> {
    if (!this.sessionId) {
      await this.authenticate();
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
}
