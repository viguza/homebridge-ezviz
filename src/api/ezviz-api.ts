import axios, { AxiosRequestConfig } from 'axios';
import querystring from 'querystring';
import crypto, { randomBytes } from 'crypto';
import { Logging } from 'homebridge';
import { Domain, Credentials, Login } from '../types/connection.js';
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
} from './ezviz-constants.js';
import { sendRequest } from './ezviz-requests.js';

export class EZVIZAPI {
  private config: EZVIZConfig;
  private sessionId: string | null;
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
      const response = (await axios(config)).data;

      if (response.retcode) {
        this.log?.error(`Login error: ${response.retcode}`);
        return;
      }
  
      if (response.meta?.code === 6002) {
        this.log?.error('2 Factor Authentication accounts are not supported at this time.');
        return;
      }
  
      if (response.loginSession?.sessionId) {
        const login = response as Login;
        const credentials: Credentials = {
          sessionId: login.loginSession.sessionId,
          rfSessionId: login.loginSession.rfSessionId,
          featureCode: emailHash,
          cuName: this.randomStr(24),
        };
        this.sessionId = login.loginSession.sessionId;
        this.config.credentials = credentials;
        return credentials;
      }
    } catch (error) {
      this.log?.info('Unable to login');
    }
  }

  async getDomain(id: number): Promise<string> {
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
  
    const domain = (await axios(domainReq)).data as Domain;
    return `https://${domain.domain}`;
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
      console.error('Error fetching devices:', error);
    }
  }

  async setSwitchState(serialNumber: string, type: number, value: boolean): Promise<void> {
    if (!this.sessionId) {
      await this.authenticate();
    }

    try {
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

      return (await axios(config)).data;
    } catch (error) {
      console.error('Error setting plug state:', error);
    }
  }

  async getSwitchState(serialNumber: string, type: number): Promise<boolean | undefined> {
    if (!this.sessionId) {
      await this.authenticate();
    }

    try {
      const deviceList = await this.listDevices();
      const deviceInfo = deviceList?.deviceInfos?.find((device) => {
        return device.deviceSerial === serialNumber;
      });
      if (deviceInfo?.status !== 1) {
        return;
      }
      const deviceSwitch = deviceList?.SWITCH[serialNumber]?.find((device) => {
        return device.type === type;
      });
      return deviceSwitch?.enable;
    } catch (error) {
      console.error('Error getting plug state:', error);
    }
  }
}
