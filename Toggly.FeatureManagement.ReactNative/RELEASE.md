# React Native release order

Publish and verify `@ops-ai/toggly-client-telemetry` 1.0.0 before generating consumer dependency locks. Publish Core 1.8.0 before adapter 1.4.0; the existing `sdk-react-native-all-release.yml` workflow orders Core before its companions. Storage adapter public ranges already accept Core 1.8 and their runtime packages do not change in this release.

After publication, regenerate the Core and adapter locks from the public registry while preserving the established linked development graph. Repeat clean install/build/typecheck/coverage, packed CJS/ESM/type and native host checks, including all existing storage host versions. Public registry installations are a separate release check from local tarball consumers. Do not substitute file dependencies, forced peer resolution, or invented integrity values.
