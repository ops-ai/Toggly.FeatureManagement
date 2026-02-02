# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.3] - 2024-02-02

### Fixed

- Removed `.d.mts` TypeScript declaration files to eliminate Gatsby GraphQL parsing warnings
- Added `./package.json` export to package.json for Gatsby plugin validation

### Changed

- Updated build process to automatically remove `.d.mts` files after compilation
- Only `.d.ts` files are now included in the published package

## [1.0.2] - 2024-02-02

### Fixed

- Fixed package.json exports field to correctly map CJS (.js) and ESM (.mjs) module extensions
- Added explicit exports for Gatsby plugin entry files (gatsby-node, gatsby-ssr, gatsby-browser)

## [1.0.1] - 2024-02-02

### Fixed

- Fixed Gatsby plugin entry files to use correct CommonJS module extension (.js instead of .cjs)
- Fixed TypeScript type errors in client store and server client for optional `identity` property

## [1.0.0] - 2024-02-01

### Added

- Initial release of Gatsby SDK for Toggly feature flags
- Gatsby plugin integration with automatic setup
- Modern React hooks: `useFeatureFlag`, `useFeatureGate`, `useToggly`
- React components: `Feature`, `FeatureGate`, `TogglyProvider`
- Build-time page gating with frontmatter extraction
- Hybrid approach: build with all features enabled, filter at edge
- Reactive state management powered by nanostores
- TypeScript support with full type definitions
- User targeting with identity support
- Edge worker manifest generation
- Comprehensive documentation and examples
- Example Gatsby application demonstrating all features

### Features

- Server-side client with caching and build-time override
- Client-side store with automatic refresh intervals
- Page-to-feature mapping via `x-feature` frontmatter
- Manifest generation for edge worker filtering
- Debug logging support
- Configurable refresh intervals and timeouts
- Fallback values for offline/error scenarios

[1.0.0]: https://github.com/ops-ai/Toggly.FeatureManagement/releases/tag/gatsby-v1.0.0
