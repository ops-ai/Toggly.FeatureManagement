# Changelog

All notable changes to this project will be documented in this file.

## [1.0.1] - 2026-06-28

### Changed
- Dual ESM (`dist/esm`) and CommonJS (`dist/cjs`) builds with conditional `exports` so Rollup/Vite consumers can import named exports.

## [1.0.0] - 2026-06-28

### Added
- `LocalGate` interface for device-local post-filter gates
- `buildFlagGateIndex`, `applyLocalGate`, `isLocalPrerequisiteMet`, and `applyLocalGatesToMap` pure helpers
- Unit tests for gate index, AND logic, and duplicate-key validation
