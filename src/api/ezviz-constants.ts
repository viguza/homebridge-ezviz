export const EZVIZ_CLIENT_TYPE = '1';
export const EZVIZ_USER_AGENT = 'EZVIZ/4.9.2 (iPhone; iOS 14.3; Scale/3.00)';
export const EZVIZ_BASE_API_URL = 'https://api.ezvizlife.com';
export const EZVIZ_DOMAINS_ENDPOINT = '/api/area/domain';
export const EZVIZ_AUTH_ENDPOINT = '/v3/users/login/v5';
export const EZVIZ_DEVICES_ENDPOINT = '/v3/userdevices/v1/resources/pagelist';
// Legacy switch-write endpoint. Works for most switch types (On/Sound/etc.) but EZVIZ's
// backend rejects Privacy/Sleep writes made under the iOS client identity above with a
// 403 "no permission", regardless of endpoint — see EZVIZ_ANDROID_* below.
export const EZVIZ_SWITCH_STATUS_ENDPOINT = '/api/device/switchStatus';
// pyEzviz / Home Assistant's EZVIZ integration write Privacy/Sleep successfully by
// impersonating EZVIZ's Android/web client instead of the iOS app identity above — EZVIZ's
// backend appears to gate some switch writes by client identity, not just endpoint. Values
// mirror what pyEzviz sends (verbatim, down to the fixed featureCode); scoped to switch
// writes only since the iOS identity already works fine for every other request this
// plugin makes.
export const EZVIZ_ANDROID_CLIENT_TYPE = '3';
export const EZVIZ_ANDROID_USER_AGENT = 'okhttp/3.12.1';
export const EZVIZ_ANDROID_FEATURE_CODE = '1fc28fa018178a1cd1c091b13b2f9f02';
export const EZVIZ_ANDROID_STATIC_HEADERS = {
  featureCode: EZVIZ_ANDROID_FEATURE_CODE,
  osVersion: '',
  clientVersion: '',
  netType: 'WIFI',
  customno: '1000001',
  ssid: '',
  clientNo: 'web_site',
  appId: 'ys7',
  language: 'en_GB',
  lang: 'en',
} as const;
export const EZVIZ_DEVICES_V3_ENDPOINT = '/v3/devices/';
export const EZVIZ_SWITCH_STATUS_PATH = '/switchStatus';
export const EZVIZ_DEFENCE_MODE_ENDPOINT = '/v3/userdevices/v1/group/switchDefenceMode';
export const EZVIZ_DEFENCE_MODE_GET_ENDPOINT = '/v3/userdevices/v1/group/defenceMode';
export const API_ENDPOINT_REFRESH = '/v3/apigateway/login';
export const EZVIZ_ALARMINFO_ENDPOINT = '/v3/alarms/v2/advanced';
export const EZVIZ_SERVER_INFO_ENDPOINT = '/v3/configurations/system/info';
export const MQTT_APP_KEY = '4c6b3cc2-b5eb-4813-a592-612c1374c1fe';
export const MQTT_APP_SECRET = '17454517-cc1c-42b3-a845-99b4a15dd3e6';
export const MQTT_PORT = 1882;
export const RUSSIA_AREA_ID = 114;
export const RUSSIA_DOMAIN = 'apiirus.ezvizru.com';
export const DEFAULT_GROUP_ID = -1;

// Requests made on a HomeKit read path must fail fast: hap-nodejs warns after 3s
// and abandons the read 6s later, so an unbounded request shows as "No Response".
export const EZVIZ_REQUEST_TIMEOUT_MS = 5000;
// Used by background polls (alarm mode / last-alarm-time refresh) that update cached
// state rather than answer a live HomeKit read, so they can afford to wait longer and
// retry once or twice when the EZVIZ cloud API is briefly slow.
export const EZVIZ_BACKGROUND_REQUEST_TIMEOUT_MS = 10_000;
// How long a fetched device list stays reusable, so simultaneous reads across
// accessories collapse into a single upstream request.
export const DEVICE_LIST_CACHE_TTL_MS = 30_000;
