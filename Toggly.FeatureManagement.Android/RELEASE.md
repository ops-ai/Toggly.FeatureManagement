# Android SDK release

The version in root `build.gradle.kts` applies to all five Maven modules. Keep `SdkIdentity.SDK_VERSION`, installation examples, and the customer changelog aligned. Publishing is a separate delivery step via **Android SDK - Release** on `develop`.

Each module calls `publishToMavenCentral(CENTRAL_PORTAL, automaticRelease = true)` so Central Portal deployments are released in the same CI job (parity with Java `autoPublish`). If a run only uploaded without releasing, finish it under [Central Portal → Deployments](https://central.sonatype.com/publishing/deployments) → **Publish**, or drop it and re-run after a version bump.

Use JDK 17 or the hosted JDK 21 matrix with the configured Android SDK:

```sh
./gradlew build -x test
./gradlew test
./gradlew testDebugUnitTest koverXmlReport
./gradlew lint
./gradlew assembleRelease
```

The Core reporter reads the repository's `tests/frontend-telemetry/contract.json` directly. Core, Compose, and Views telemetry integration tests use local MockWebServer endpoints; ordinary fake-key and live definitions smoke tests opt out of telemetry. Do not send release-verification events to a production application.

Before publishing, require independent Oracle review and hosted analysis checks on the exact candidate. Registry availability and designated live native ingest verification are separate evidence from local tests. Follow the repository `.github/RELEASE.md` Maven Central workflow; this guide does not authorize publication.
