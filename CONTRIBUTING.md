# Contributing

Thanks for helping improve homebridge-ezviz. Bug reports, fixes and new device support are all welcome.

## Reporting bugs and requesting features

Open an issue using one of the [issue templates](https://github.com/viguza/homebridge-ezviz/issues/new/choose). For bugs, include:

- Plugin, Homebridge and Node.js versions
- The device model(s) involved
- Your config with the `password`, `code` and email removed
- The relevant log lines, ideally with Homebridge debug mode on

The plugin masks camera credentials in RTSP URLs, but review logs before posting them anyway.

**Security issues:** don't open a public issue. Follow [SECURITY.md](SECURITY.md) instead.

## Development setup

Requirements: Node.js 18, 20, 22 or 24, and an EZVIZ account with at least one device if you want to test against real hardware.

```bash
git clone https://github.com/viguza/homebridge-ezviz.git
cd homebridge-ezviz
npm install
npm run build
```

Useful scripts:

| Command | What it does |
|---------|--------------|
| `npm run build` | Compiles TypeScript from `src/` to `dist/` |
| `npm run lint` | Runs ESLint; warnings fail the check |
| `npm test` | Runs the Jest test suite |
| `npm run watch` | Builds, links the plugin, and restarts a local Homebridge on every change in `src/` |

`npm run watch` runs Homebridge with the config in `test/hbConfig/`, which is gitignored. Create `test/hbConfig/config.json` with your own platform config to use it. Never commit it.

## Making changes

1. Fork the repository and create a branch from `main`.
2. Keep each change focused on one thing. Separate unrelated fixes into separate commits or pull requests.
3. Add or update tests for behavior you change. Bug fixes should come with a test that fails without the fix.
4. Make sure `npm run lint`, `npm run build` and `npm test` all pass.
5. Add a line under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md) describing the change from a user's point of view.
6. Open a pull request and fill in the template.

### Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) prefixes, for example:

```
fix: keep username and pushAddr when refreshing the EZVIZ session
feat: add support for <device>
refactor: define the HKSV prebuffer length once
```

Explain *why* in the body when it isn't obvious from the subject.

### Code guidelines

- TypeScript, formatted to pass the project's ESLint config.
- Never log secrets. Anything that can contain an RTSP URL (ffmpeg commands, ffmpeg output, error objects) must go through `redactCredentials()` from `src/utils/sanitize.ts`.
- Session state (`sessionId`, credentials) is owned by `EZVIZAPI`. Make API calls through its request helpers so 401s renew the session and restart MQTT, rather than calling `axios` directly.
- Keep HomeKit-blocking reads fast: don't add network retries to requests that HomeKit is waiting on.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.
