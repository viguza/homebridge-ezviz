# Homebridge EZVIZ Plugin

## Introduction

This is a Homebridge plugin for integrating EZVIZ devices into HomeKit.

This project is based on the original work by [Brandawg93](https://github.com/Brandawg93/homebridge-ezviz). The idea for this project is to improve and expand upon the original plugin, especially now that it is archived.

## Warnings :warning:

- There is no official documentation for the EZVIZ API, so the endpoints used are based on other similar projects. If EZVIZ changes something, this plugin might break.
- I only have a few devices to test, so this won't cover every single EZVIZ device.
- Use it at your own risk.

## Required Device Settings

Before using the plugin, you need to configure your EZVIZ devices with the following settings:

### 1. Enable Video & Picture Encryption
- Open the EZVIZ app
- Go to your device settings
- Navigate to Privacy settings
- Enable "Video & Picture Encryption"

### 2. Enable RTSP
RTSP (Real Time Streaming Protocol) is the protocol used by this plugin to connect to your device's livestream. You need to enable this setting for each device you want to use with the plugin.

- Open the EZVIZ app
- Go to Settings
- Select "LAN Live View"
- Start scanning and select your device from the list
- Once connected, tap the settings icon in the top right corner
- Select "Local Service settings"
- Enable RTSP

These settings are required for the plugin to access your device's livestream. Without them, you won't be able to view the camera feed in HomeKit.

## Installation

   Install the Homebridge EZVIZ plugin using npm:
   ```sh
   npm install -g @viguza/homebridge-ezviz
   ```

## Configuration

To configure the plugin, you need to add the following to your Homebridge `config.json` file:

```json
{
  "platform": "EZVIZ",
  "region": 123,
  "email": "your-email@example.com",
  "password": "your-password",
  "cameras": [
    {
      "name": "Camera 1",
      "serial": "camera-serial-number",
      "username": "admin",
      "code": "verification-code"
    }
  ],
  "plugs": [
    {
      "serial": "plug-serial-number",
      "code": "verification-code"
    }
  ]
}
```