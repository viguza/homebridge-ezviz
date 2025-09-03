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

- **v1.2.12**: Latest stable release with live streaming fixes
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
