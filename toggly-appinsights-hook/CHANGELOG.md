# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-02-13

### Added
- Initial release of `@ops-ai/toggly-appinsights-hook`
- Feature flag evaluation tracking via `afterEvaluation` hook using `trackEvent()`
- Real-time feature flag change tracking via `afterRefresh` hook
- User identity tracking via `afterIdentify` hook using `setAuthenticatedUserContext()`
- Custom properties on all telemetry via `addTelemetryInitializer()`
- Consent management integration with `checkConsent` callback
- Debug mode for development
- Custom event names and properties
- Support for custom measurements
- Property name sanitization (special character handling, length truncation)
