# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Nothing yet

### Changed
- Nothing yet

### Fixed
- Nothing yet

### Removed
- Nothing yet

## [1.8.1] - 2026-05-31

### Fixed
- MQTT events not received: the EZVIZ broker does not reliably deliver QoS 2 messages via MQTT.js; switched to QoS 1, which resolves the issue
- MQTT keepalive set to 30 s to avoid the broker's 60 s server-side timeout dropping the connection every minute
- Subscription is now skipped on reconnects where the broker restores a stored session (`sessionPresent=true`), matching pyEzvizApi behaviour

### Changed
- MQTT and polling now run in parallel: MQTT fires motion events immediately, polling continues as a 30 s fallback (previously polling was stopped when MQTT connected)
- Motion window reduced from 90 s to 60 s
- `triggerMotion` is now idempotent — only emits the HomeKit update once per motion event and resets the auto-clear timer on repeated calls
- Debug logging added for MQTT register/startPush responses, raw message topic, subscribe grant, `sessionPresent`, and connection lifecycle events

## [1.8.0] - 2026-05-31

### Added
- MQTT push for real-time motion detection — when MQTT connects successfully, polling stops and motion events arrive instantly instead of within 30 seconds (#29)
  - Connects to the EZVIZ push broker using the same credentials as pyEzvizApi and the Home Assistant integration
  - Automatically falls back to polling if MQTT fails to connect
  - Auto-reconnects every 5 seconds on disconnect; polling stays off during reconnection

## [1.7.0] - 2026-05-31

### Added
- Motion sensor accessory per camera (opt-in via `motionSensor: true` in camera config) — polls the EZVIZ alarm history every 30 seconds and triggers a HomeKit motion event when a new alarm is detected; motion stays active for 90 seconds (#23)
- Node.js 24 added to supported engines (#28)

## [1.6.0] - 2026-05-31

### Added
- Session refresh using refresh token — scheduled re-authentication now uses `PUT /v3/apigateway/login` with the existing refresh token instead of a full re-login, falling back to full re-authentication if the token is rejected (#21)
- Support for BatteryCamera and BDoorBell device categories — these devices are no longer silently skipped during discovery and are exposed as cameras in HomeKit (#24)

### Fixed
- WiFi cameras failing to stream or take snapshots (#26)
  - Plugin now requests WIFI IP data from the pagelist API and prefers `WIFI.address` over `CONNECTION.localIp`, which returns `0.0.0.0` for many WiFi cameras
  - Switched RTSP transport from UDP to TCP (`-rtsp_transport tcp`) for reliable WiFi streaming
  - RTSP URL now includes the correct port from `CONNECTION.localRtspPort`
  - Added `-use_wallclock_as_timestamps 1` to fix non-monotonic timestamp warnings from cameras
  - Added `-af aresample=async=1` to fix audio distortion caused by backward audio timestamps

## [1.5.0] - 2025-11-04

### Added
- Alarm Mode Switch: Added HomeKit switch accessory to control EZVIZ defence/alarm modes (#11)
  - Switch ON = AWAY_MODE (fully armed)
  - Switch OFF = HOME_MODE (disarmed)
  - Switch state automatically reflects current defence mode status
  - Supports control via Apple Shortcuts, Siri, and Home app
  - Added API methods for getting and setting defence mode

## [1.3.0] - 2025-11-03

### Added
- Added config option for dual cameras (#13)

## [1.2.12] - 2025-09-02

### Fixed
- Fixed live view stopping after 9 seconds issue (#6)
- Improved streaming stability and reliability

## [1.2.11] - 2025-08-30

### Added
- Added funding support via PayPal
- Added Homebridge verified badge to README
- Enhanced project documentation

### Changed
- Updated funding configuration in package.json
- Improved README with better badges and information

## [1.2.10] - 2025-07-13

### Added
- Initial release of the improved EZVIZ plugin
- Support for EZVIZ cameras with RTSP streaming
- Support for EZVIZ smart plugs
- Multi-region support for EZVIZ accounts
- Comprehensive configuration schema
- TypeScript implementation with full type safety

### Features
- **Camera Support**: Live streaming for EZVIZ IP cameras
- **Smart Plug Control**: Remote control of EZVIZ smart plugs
- **Multi-Region Support**: Support for all EZVIZ regions worldwide
- **Secure Authentication**: Secure login with EZVIZ credentials
- **Easy Configuration**: Simple setup through Homebridge UI
- **Auto-Discovery**: Automatic device discovery and configuration

### Technical Details
- Built with TypeScript for better maintainability
- Uses modern ES modules
- Comprehensive error handling and logging
- Full HomeKit integration
- Support for Node.js 18.20.4, 20.18.0, and 22.10.0
- Compatible with Homebridge 1.8.0+

## [1.2.9] - 2025-06-08

### Fixed
- Improved error handling and logging
- Enhanced stability for device connections

### Changed
- Updated dependencies for better security and performance

## [1.2.8] - 2025-05-29

### Fixed
- Various bug fixes and stability improvements
- Enhanced device discovery reliability

## [1.2.7] - 2025-05-27

### Fixed
- Minor bug fixes and improvements
- Enhanced error handling

## [1.2.4] - 2025-03-06

### Fixed
- Critical bug fixes for device connectivity
- Improved authentication handling

## [1.2.3] - 2025-01-31

### Fixed
- Bug fixes for smart plug control
- Improved camera streaming stability

## [1.2.2] - 2025-01-12

### Added
- Initial support for smart plugs
- Enhanced configuration options

### Fixed
- Various stability improvements

---

## Legacy Versions

This project is based on the original work by [Brandawg93](https://github.com/Brandawg93/homebridge-ezviz). The following versions represent the continuation and improvement of that work:

### Version History Notes

- **v1.3.0**: Added config option for dual cameras
- **v1.2.12**: Live streaming fixes
- **v1.2.11**: Added funding support and documentation improvements
- **v1.2.10**: Major rewrite with TypeScript and enhanced features
- **v1.2.9 and earlier**: Legacy versions with incremental improvements

### Breaking Changes

- **v1.2.10**: Complete rewrite from JavaScript to TypeScript (backward compatible)

---

## Contributing

When contributing to this project, please update this changelog by adding a new section under `[Unreleased]` with the following structure:

```markdown
## [Unreleased]

### Added
- New features

### Changed
- Changes to existing functionality

### Fixed
- Bug fixes

### Removed
- Removed features
```

When releasing a new version, move the `[Unreleased]` section to a new version number and update the date.

---

## Links

- [GitHub Repository](https://github.com/viguza/homebridge-ezviz)
- [NPM Package](https://www.npmjs.com/package/@viguza/homebridge-ezviz)
- [Homebridge Plugin Page](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
- [Original Plugin](https://github.com/Brandawg93/homebridge-ezviz) (Archived)
