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

## [1.9.3] - 2026-09-16

### Fixed
- Background polls for the device list (smart-plug reachability, camera active-state refresh) and defence mode were still using the 5s HomeKit-read timeout instead of the 10s background timeout, causing spurious "seems to be unreachable" errors under normal API latency. `getDefenceMode` also now goes through the shared request helper, gaining automatic session-refresh-on-401 retry it previously lacked

## [1.9.2] - 2026-09-16

### Changed
- No user-facing changes. Test coverage expanded significantly (54% → 76% statements, 42% → 73% branches, 54 → 118 tests): the defence mode API (`setDefenceMode`/`getDefenceMode`), the HomeKit↔EZVIZ mode mapping, MQTT payload parsing, `extractDevicesData`/`getServiceUrls`, and the `SmartPlug`/`SecuritySystemAccessory`/`MotionSensor` accessory classes themselves are now directly tested (#46, #47, #48)

## [1.9.1] - 2026-09-16

### Fixed
- Security System "Off" (disarm) was sending EZVIZ's `UNSET_MODE`, which does not actually disarm the device — it shows as "Armado" in the EZVIZ app just like Away/Night. Only `HOME_MODE` behaves as "Desarmado" on real hardware, so Off (and Stay) now both map to it, since EZVIZ has no working fully-off mode of its own (#45)

## [1.9.0] - 2026-09-16

### Added
- Camera privacy toggle: cameras that report a privacy switch now expose a native HomeKit `CameraOperatingMode` "Camera Off" control on the existing camera accessory, mapped to EZVIZ's privacy switch. Devices without a privacy switch are unaffected (#44)

### Changed
- Alarm mode accessory now exposes a native HomeKit Security System (Stay/Away/Night/Off) instead of a plain on/off switch, enabling Home/Away automations and Apple Watch arm/disarm controls (#43)
  - **Note:** any existing Siri Shortcut, Home app automation, or scene referencing "Alarm Mode" as a switch will stop working after upgrading and needs to be recreated against the new Security System accessory

## [1.8.5] - 2026-09-16

### Fixed
- Resolved 18 npm audit vulnerabilities in the dependency tree (2 critical, 9 high, 3 moderate, 4 low), including unsafe boundary generation in `form-data` and arbitrary file write/symlink traversal in `tar`; transitive resolutions now within existing `package.json` semver ranges (`axios` resolves to 1.20.0)
- Published package tarball no longer bundles local `.claude/settings.local.json`
- CodeQL: `GITHUB_TOKEN` in the build workflow is now scoped to `contents: read`, since the job never writes anything

### Changed
- `typescript-eslint` bumped to `^8.70.0` to support the newer `eslint` pulled in by the audit fix

## [1.8.3] - 2026-09-15

### Fixed
- Motion sensors never triggering for dual-lens cameras and battery cameras/doorbells (#30): both MQTT push and REST polling matched on the wrong device serial for dual-lens accessories, and sensor creation was gated on device types that excluded `BatteryCamera`/`BDoorBell`
- Alarm mode and last-alarm-time background polls failing outright with `ECONNABORTED` timeouts against the EZVIZ cloud API, spamming logs with no recovery until the next poll tick

### Changed
- Alarm mode (`getDefenceMode`) and motion (`getLastAlarmTime`) background polls now use a longer 10 s timeout and retry up to twice with backoff on transient network/5xx errors, since they refresh cached state rather than answer a live HomeKit read

## [1.8.2] - 2026-08-31

### Fixed
- Homebridge "read handler for the characteristic 'On' was slow to respond / didn't respond at all" warnings (#32): reads of the smart plug and alarm mode switches went straight to the EZVIZ cloud and waited for a reply, exceeding the 9 s HomeKit read budget
- All HTTP requests now use a 5 s timeout; previously they were unbounded, so a stalled connection hung until the OS TCP timeout
- The alarm mode switch no longer reports the alarm as disarmed when a state read fails; an unreachable device now shows "No Response" instead of a stale or wrong value

### Changed
- Smart plug and alarm mode switches answer HomeKit reads from cached state and refresh in the background every 60 s, pushing updates with `updateCharacteristic` (the pattern the motion sensor already used)
- The device list is cached for 30 s and concurrent callers share a single request, so reading state no longer triggers one full account listing per accessory; the cache is invalidated after a write

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
