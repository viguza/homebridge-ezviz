export const EZVIZ_CLIENT_TYPE = '1';
export const EZVIZ_USER_AGENT = 'EZVIZ/4.9.2 (iPhone; iOS 14.3; Scale/3.00)';
export const EZVIZ_BASE_API_URL = 'https://api.ezvizlife.com';
export const EZVIZ_DOMAINS_ENDPOINT = '/api/area/domain';
export const EZVIZ_AUTH_ENDPOINT = '/v3/users/login/v5';
export const EZVIZ_DEVICES_ENDPOINT = '/v3/userdevices/v1/resources/pagelist';
export const EZVIZ_SWITCH_STATUS_ENDPOINT = '/api/device/switchStatus';
export const EZVIZ_DEFENCE_MODE_ENDPOINT = '/v3/userdevices/v1/group/switchDefenceMode';
export const EZVIZ_DEFENCE_MODE_GET_ENDPOINT = '/v3/userdevices/v1/group/defenceMode';
export const API_ENDPOINT_REFRESH = '/v3/apigateway/login';
export const EZVIZ_UNIFIEDMSG_ENDPOINT = '/v3/unifiedmsg/list';
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
// How long a fetched device list stays reusable, so simultaneous reads across
// accessories collapse into a single upstream request.
export const DEVICE_LIST_CACHE_TTL_MS = 30_000;
