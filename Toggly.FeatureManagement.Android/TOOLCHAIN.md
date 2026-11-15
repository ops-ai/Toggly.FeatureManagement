# Android SDK toolchain lines

Programme: [OPS-1563](https://linear.app/opsai/issue/OPS-1563) / [OPS-1566](https://linear.app/opsai/issue/OPS-1566).

## Current line (AGP 9 / Kotlin 2.4)

| Pin | Value |
| --- | --- |
| AGP | 9.5.0 |
| Gradle | 9.6.0 |
| Kotlin | 2.4.21 (AGP built-in Kotlin; Compose/Serialization plugin pins) |
| KSP | 2.3.13 |
| compileSdk / targetSdk | 37 |
| minSdk | 24 (floor; do not raise) |
| Compose BOM | 2026.09.00 |
| mockk | 1.14.11 |

CI: `.github/workflows/analysis-android.yml` (Java 17 + 21 + 25).

Built-in Kotlin is enabled (default for AGP 9). The legacy `org.jetbrains.kotlin.android` plugin is not applied. OkHttp stays on 4.x and Retrofit on 2.x by owner decision.

## Packaging

Single `io.toggly` Android artifact set (`toggly-android-core`, `-compose`, `-views`, `-room`, `-datastore`).
