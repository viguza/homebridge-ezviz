# Security Policy

## Supported versions

Security fixes are released for the latest published version only. Please update to the [latest release](https://github.com/viguza/homebridge-ezviz/releases/latest) before reporting.

| Version | Supported |
|---------|-----------|
| 2.x (latest) | Yes |
| < 2.0 | No |

## Reporting a vulnerability

**Please don't report security issues in public issues, discussions or pull requests.**

Report them privately through GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/viguza/homebridge-ezviz/security) of this repository.
2. Click **Report a vulnerability**.
3. Describe the issue, the affected version, and steps to reproduce it.

You should get an initial response within 7 days. Once the issue is confirmed, a fix is released as soon as practical and credited to you in the release notes, unless you'd rather stay anonymous.

## Scope

In scope: issues in this plugin's code, for example leaking EZVIZ account or camera credentials (in logs, errors or network traffic), or letting another party control your devices through the plugin.

Out of scope: vulnerabilities in EZVIZ's cloud service, apps or device firmware (report those to EZVIZ), and in Homebridge or HAP-NodeJS themselves (report those to the [Homebridge project](https://github.com/homebridge/homebridge)).

## Keeping your setup safe

- Treat your Homebridge logs as sensitive. The plugin masks camera credentials, but review logs before sharing them.
- Don't share your `config.json`: it contains your EZVIZ password and camera verification codes.
