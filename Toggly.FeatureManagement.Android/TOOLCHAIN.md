# Android SDK toolchain lines

Programme: [OPS-1563](https://linear.app/opsai/issue/OPS-1563) / [OPS-1566](https://linear.app/opsai/issue/OPS-1566).

## Current line (retained)

| Pin | Value |
| --- | --- |
| AGP | 8.7.3 |
| Kotlin | 2.0.21 |
| compileSdk | 35 |
| minSdk | 24 |
| mockk | 1.13.x (1.14+ ships Kotlin 2.2 metadata) |

CI: `.github/workflows/analysis-android.yml` (Java 17 + 21).

Dependabot ignores AGP/Kotlin minor+major and mockk `>=1.14` so this floor stays intentional.

## Newest line (Wave 3 follow-up)

Add a second CI matrix (or workflow) that builds against:

- AGP 9.x / compileSdk matching AGP 9 requirements
- Kotlin 2.2+ (or newest stable that AGP 9 requires)
- mockk 1.14+ allowed **only** on this line

Do **not** raise the published library’s compile/Kotlin floor until the newest line is green and a deliberate SemVer decision is recorded. Prefer dual matrices over dropping AGP 8.7 consumers.

## Packaging

Keep a single `io.toggly` Android artifact while both lines compile the same sources. Split only if AGP 9 forces an unspannable API (same rule as Jedis 5/8).
