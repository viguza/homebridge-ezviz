# Homebridge EZVIZ Plugin

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins) ![NPM Version](https://img.shields.io/npm/v/%40viguza%2Fhomebridge-ezviz) ![NPM Downloads](https://img.shields.io/npm/d18m/%40viguza%2Fhomebridge-ezviz) ![License](https://img.shields.io/npm/l/%40viguza%2Fhomebridge-ezviz) ![Node.js Version](https://img.shields.io/node/v/%40viguza%2Fhomebridge-ezviz)

A Homebridge plugin for integrating EZVIZ devices into Apple HomeKit. This plugin provides seamless integration with your EZVIZ devices, allowing you to control them through the Home app and Siri.

## Features

- 🏠 **HomeKit Integration**: Integration with Apple HomeKit ecosystem
- 📹 **Camera Support**: Live streaming for EZVIZ cameras (WiFi and wired)
- 🚨 **Motion Sensor**: Optional per-camera motion sensor accessory for HomeKit automations
- 🔌 **Smart Plug Control**: Remote control of EZVIZ smart plugs
- 🌍 **Multi-Region Support**: Support for all EZVIZ regions worldwide
- 🔒 **Secure Authentication**: Secure login with your EZVIZ credentials
- 🎯 **Easy Configuration**: Simple setup through Homebridge UI
- 🔄 **Auto-Discovery**: Automatic device discovery and configuration

## Supported Devices

### Cameras
- EZVIZ IP Cameras with RTSP support
- Indoor and outdoor security cameras
- PTZ (Pan-Tilt-Zoom) cameras
- Doorbell cameras

### Smart Plugs
- EZVIZ Smart Plugs
- Smart switches and outlets

## Prerequisites

- [Homebridge](https://homebridge.io/) v1.8.0 or higher
- Node.js v18, v20, v22, or v24
- EZVIZ account with registered devices
- Network access to your EZVIZ devices

## Installation

### Method 1: Homebridge UI (Recommended)
1. Open Homebridge UI
2. Go to the "Plugins" tab
3. Search for "EZVIZ"
4. Click "Install" on the `@viguza/homebridge-ezviz` plugin

### Method 2: Command Line
```bash
npm install -g @viguza/homebridge-ezviz
```

## Device Setup

Before using the plugin, you need to configure your EZVIZ devices:

### 1. Enable Video & Picture Encryption
1. Open the EZVIZ app
2. Go to your device settings
3. Navigate to Privacy settings
4. Enable "Video & Picture Encryption"

### 2. Enable RTSP (For Cameras)
RTSP (Real Time Streaming Protocol) is required for camera live streaming:

1. Open the EZVIZ app
2. Go to Settings
3. Select "LAN Live View"
4. Start scanning and select your device from the list
5. Once connected, tap the settings icon in the top right corner
6. Select "Local Service settings"
7. Enable RTSP

> **Note**: These settings are required for the plugin to access your device's livestream. Without them, you won't be able to view the camera feed in HomeKit.

## Configuration

### Basic Configuration

Add the following to your Homebridge `config.json` file:

```json
{
  "platforms": [
    {
      "platform": "EZVIZ",
      "name": "EZVIZ",
      "region": 314,
      "email": "your-email@example.com",
      "password": "your-password",
      "cameras": [
        {
          "serial": "C1A1234567890",
          "username": "admin",
          "code": "ABCD1234"
        }
      ],
      "plugs": [
        {
          "serial": "P1A1234567890",
          "code": "ABCD1234"
        }
      ]
    }
  ]
}
```

### Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `platform` | string | Yes | Must be "EZVIZ" |
| `name` | string | No | Platform name (default: "EZVIZ") |
| `region` | number | Yes | Your EZVIZ region code (see region list below) |
| `email` | string | Yes | Your EZVIZ account email |
| `password` | string | Yes | Your EZVIZ account password |
| `cameras` | array | No | Array of camera configurations |
| `plugs` | array | No | Array of smart plug configurations |

### Camera Configuration

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `serial` | string | Yes | Camera serial number |
| `username` | string | Yes | Camera username (usually "admin") |
| `code` | string | Yes | Camera verification code |
| `motionSensor` | boolean | No | Creates a motion sensor accessory (polls alarm history every 30 s) |
| `dualCamera` | boolean | No | Enable for devices with two physical lenses (e.g. H9c) |

### Smart Plug Configuration

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `serial` | string | Yes | Smart plug serial number |
| `code` | string | Yes | Smart plug verification code |

### Region Codes

The EZVIZ API uses numeric region codes (also called `areaId`) to determine which regional API endpoint to use.

For a complete list of all supported region codes, see [config.schema.json](config.schema.json) in the plugin repository. The schema includes all available regions and their corresponding codes.

> **Note**: You can also check the plugin configuration in Homebridge UI, which will show the available region codes.

## Usage

### In HomeKit
1. Open the Home app on your iOS device
2. Your EZVIZ devices will appear as accessories
3. Tap on cameras to view live streams
4. Use smart plugs to control connected devices
5. Set up automations and scenes as needed

### Voice Control
- "Hey Siri, turn on the living room camera"
- "Hey Siri, turn off the bedroom plug"
- "Hey Siri, show me the front door camera"

## Troubleshooting

### Common Issues

#### Camera Not Showing Video
- Ensure RTSP is enabled on your camera
- Check that Video & Picture Encryption is enabled
- Verify camera credentials are correct
- Check network connectivity

#### Smart Plug Not Responding
- Verify the verification code is correct
- Check that the plug is online in the EZVIZ app
- Ensure the plug is connected to your network

#### Authentication Errors
- Double-check your email and password
- Verify your region code is correct
- Try logging into the EZVIZ app to confirm credentials

### Debug Mode

Enable debug mode for detailed logging:

1. Open Homebridge UI
2. Go to the plugin settings
3. Enable "Debug" mode
4. Check the logs for detailed information

### Getting Help

1. Check the [Issues](https://github.com/viguza/homebridge-ezviz/issues) page
2. Search for existing solutions
3. Create a new issue with:
   - Device information
   - Configuration (without credentials)
   - Error logs
   - Steps to reproduce

## API Documentation

For developers who want to understand or work with the EZVIZ API directly, we provide detailed API documentation using curl commands that can be easily imported into Postman or similar tools.

📖 **[View API Documentation](EZVIZ_API.md)**

The documentation includes:
- Step-by-step authentication process
- How to retrieve device information
- Regional API domains and endpoints
- Common error codes and troubleshooting
- Complete curl examples

## Development

### Building from Source

```bash
git clone https://github.com/viguza/homebridge-ezviz.git
cd homebridge-ezviz
npm install
npm run build
```

### Running Tests

```bash
npm test
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and updates.

## Disclaimer

⚠️ **Important Warnings**:

- There is no official documentation for the EZVIZ API, so the endpoints used are based on other similar projects. If EZVIZ changes something, this plugin might break.
- This plugin is tested with a limited number of devices. It may not cover every single EZVIZ device.
- Use this plugin at your own risk.
- This plugin is not officially affiliated with EZVIZ.

## Credits

This project is based on the original work by [Brandawg93](https://github.com/Brandawg93/homebridge-ezviz). The idea for this project is to improve and expand upon the original plugin, especially now that it is archived.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## Support

If you find this plugin helpful, please consider:

- ⭐ Starring the repository
- 🐛 Reporting bugs and issues
- 💡 Suggesting new features
- 💰 [Supporting the project](https://paypal.me/viguza)

---

**Made with ❤️ for the Homebridge community**