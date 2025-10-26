# EZVIZ API Documentation

This document provides instructions for connecting to the EZVIZ API using curl commands. These commands can be easily imported into Postman or similar API testing tools.

> **Note**: There is no official documentation for the EZVIZ API. These endpoints are based on reverse engineering the EZVIZ mobile app and may change without notice.

## Prerequisites

- Your EZVIZ account email
- Your EZVIZ account password
- A way to generate MD5 hashes (you can use online tools or terminal commands)

### Generate MD5 Hashes

On macOS/Linux:
```bash
echo -n "your-email@example.com" | md5sum
echo -n "your-password" | md5sum
```

## Step 1: Get Your API Domain

First, you need to determine which API domain to use based on your geographic location. This endpoint will return the appropriate API domain for your region.

The EZVIZ API uses numeric region codes (also called `areaId`) to determine which regional API endpoint to use. For a complete list of all supported region codes, see [config.schema.json](config.schema.json) in the plugin repository. The schema includes all available regions and their corresponding codes.

### Request

Replace `<areaId>` with your region code (e.g., `314` for USA, `142` for UK, `501` for Australia).

```bash
curl --request POST \
  --url 'https://api.ezvizlife.com/api/area/domain' \
  --header 'clienttype: 1' \
  --header 'content-type: application/x-www-form-urlencoded' \
  --header 'user-agent: EZVIZ/4.9.2 (iPhone; iOS 14.3; Scale/3.00)' \
  --data 'areaId=<areaId>'
```

### Response

```json
{
  "domain": "apiius.ezvizlife.com",
  "areaId": "314",
  ...
}
```

**Save the `domain` value** from the response (e.g., `apiius.ezvizlife.com`) as you'll need it for the next step.

## Step 2: Authenticate

Use the domain from Step 1 and your EZVIZ credentials to authenticate. The email and password must be converted to MD5 hash format.

### Request

**Important**: Replace the following placeholders:
- `<DOMAIN>`: The domain from Step 1 (e.g., `apiius.ezvizlife.com`)
- `<EMAIL>`: Your EZVIZ account email (plain text)
- `<EMAIL_MD5>`: MD5 hash of your email
- `<PASSWORD_MD5>`: MD5 hash of your password

```bash
curl --request POST \
  --url 'https://<DOMAIN>/v3/users/login/v5' \
  --header 'clienttype: 1' \
  --header 'content-type: application/x-www-form-urlencoded' \
  --header 'user-agent: EZVIZ/4.9.2 (iPhone; iOS 14.3; Scale/3.00)' \
  --data 'account=<EMAIL>' \
  --data 'featureCode=<EMAIL_MD5>' \
  --data 'password=<PASSWORD_MD5>'
```

### Response

```json
{
  "loginSession": {
    "sessionId": "YOUR_SESSION_ID",
    "rfSessionId": "YOUR_REFRESH_SESSION_ID",
    ...
  },
  "areaId": 314,
  ...
}
```

**Save the `sessionId`** from the response as you'll need it for subsequent API calls.

## Step 3: List Your Devices

Now you can retrieve a list of all devices associated with your account.

### Request

Replace the following placeholders:
- `<DOMAIN>`: The domain from Step 1
- `<SESSION_ID>`: The sessionId from Step 2

```bash
curl --request GET \
  --url 'https://<DOMAIN>/v3/userdevices/v1/resources/pagelist?filter=CONNECTION%2CSWITCH%2CSTATUS%2CNODISTURB%2CP2P%2CFEATURE%2CDETECTOR&groupId=-1&limit=30&offset=0' \
  --header 'clienttype: 1' \
  --header 'sessionid: <SESSION_ID>' \
  --header 'user-agent: EZVIZ/4.9.2 (iPhone; iOS 14.3; Scale/3.00)'
```

### Response

```json
{
  "deviceInfos": [
    {
      "deviceSerial": "C1A1234567890",
      "deviceName": "My Camera",
      "deviceCategory": "CAMERA",
      ...
    },
    ...
  ],
  ...
}
```

## Important Headers

All EZVIZ API requests require specific headers:

- `clienttype: 1` - Client type identifier
- `user-agent: EZVIZ/4.9.2 (iPhone; iOS 14.3; Scale/3.00)` - User agent string
- `content-type: application/x-www-form-urlencoded` - For POST requests
- `sessionid: <SESSION_ID>` - For authenticated requests (obtained in Step 2)

**Do not modify these headers** - changing them may cause requests to fail.

## Common Error Codes

- **401**: Session expired or invalid credentials
- **6002**: Two-factor authentication is not supported
- **200**: Success

## Security Notes

⚠️ **Warning**: 
- This API does not use standard OAuth or secure authentication methods
- Credentials are sent with MD5 hashing, which is not considered secure by modern standards
- Use this API at your own risk
- Never share your session IDs or credentials
- Consider using this API only in private, secure networks
