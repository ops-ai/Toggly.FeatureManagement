# SDK host support matrix

Living inventory for [OPS-1563](https://linear.app/opsai/issue/OPS-1563/dual-major-host-support-programme).
Design: `Toggly.wiki/Home/Engineering/Plans/2026-09-28-Dual-Major-Host-Support-Design.md`.

**Rule:** a host major is supported only when a packed fixture or TFM matrix job proves it. Peers alone are not enough. Keep every declared major; add newest when proven. Prefer peer widen; split packages only when unspannable.

| SDK | Declared | Proven CI majors | Newest stable | Gap / action |
| --- | --- | --- | --- | --- |
| Next (`@ops-ai/nextjs-toggly-*`) | `next >=14` | 14.2.35, 15.5.25, 16.3.6 (webpack+turbopack) | 16.3.6 | Wave 1 done |
| Nuxt | `^3 \|\| ^4` | 3.21.11 + 4.6.3 (Node 22/24/26) | 4.6.3 | Maintain |
| Astro | `^5 \|\| ^6 \|\| ^7` | 5 / 6 / 7 (OPS-1179) | 7.3.x | Maintain |
| NestJS | `^10 \|\| ^11 \|\| ^12` | release matrix 10, 11, 12 | 12.1.x | Wave 2 (separate SDK) |
| Express (Node server) | `>=4` | 4.22.3 + 5.3.0 (Node 22/24/26) | 5.3.0 | Maintain |
| Koa (Node server) | `^2 \|\| ^3` | 2.16.4 + 3.2.1 | 3.2.1 | Maintain |
| React Router | `^7 \|\| ^8` | 7.18.5 + 8.5.1 hosts (Node 24) | 8.5.1 | Maintain |
| Fastify | `^4 \|\| ^5` | 4.29.1 + 5.12.7 (Node 22/24/26) | 5.12.7 | Maintain; Fastify 4 still published (`four` dist-tag) |
| Hono | `^4` | 4.0.0 + 4.13.16 (Node 22/24/26) | 4.13.16 | No major gap; 4.0.0 runtime proved (TS 5.9 needs skipLibCheck on 4.0.0 types) |
| Gatsby | `^5` | 5.x | 5.16.x | No Gatsby 6 |
| Docusaurus | `^3` + React `^18 \|\| ^19` | Docusaurus 3.10.2 × React 18.3.1 + 19.3.1; Node 22/24/26; Worker workerd + Pages Function | 3.10.2 / React 19.3.1 | No Docusaurus 4; Worker `compatibility_date` 2026-11-02 |
| Angular | `>=15` | workspace hosts | 22.x | Prove latest under floor |
| Electron | `>=28` | 28.3.3 + 45.2.1 packed hosts (Node 22/24/26 unit) | 45.2.1 | Maintain |
| Svelte | `^4 \|\| ^5` | 4 + 5 | 5.x | Maintain |
| SvelteKit | kit `^2 \|\| ^3` | 2.x, 3.1.0 packed host | 3.1.x | Maintain |
| .NET core family | netstandard2.1…net9 + **net10** | multi-TFM build | net10 | Wave 2 |
| Blazor (`Toggly.FeatureManagement.Blazor` / `.Server`) | **net8–net11** | CI matrix net8/9/10 + net11 RC allow-failure | net10 stable; net11 RC | Maintain; net6/7 skipped (Client is net8-only) |
| .NET Mongo/Dapper/EF | includes net10 | net8/net10 consumers | net10 | Maintain |
| Java Spring | Boot 3.5 + Boot 4.1 / Spring 6.2+7 / Java 17 | Boot 3.5.16 + Boot 4.1.2 starters; Spring 6.2.19 + 7.0.10 (Security 6.5.11 / 7.1.2) MVC/WebFlux CI + `webflux` / `webflux-spring7` hosts; JDK 17/21/25 | Boot 4.1 / Spring 7.0 | Dual Boot starters; single MVC/WebFlux artifacts (provided Spring) |
| Java Redis | Jedis 5 + Jedis 8 | dual artifacts | Jedis 8 | No Lettuce 7 |
| Android | AGP 9.5 / Kotlin 2.4 / compileSdk 37 / minSdk 24 | Java 17+21+25; unit tests + API 36 emulator | AGP 9.5.0 / Kotlin 2.4.21 | Wave 3; AVD 37 blocked on GHA macos-intel |
| Flutter | Dart `>=3.4.0 <4` / Flutter `>=3.22.0` | Flutter **3.22.0** (Dart 3.4) + stable | Flutter 3.47.x / Dart 3.13 | Dart 2 dropped; floor set by `crypto` ^3.0.6 (Dart ≥3.4) + `equatable` ^3 |
| iOS | iOS 14 / macOS 11 | Xcode 16.x matrix | Xcode 16.4 | Keep floor |
| Rust axum | axum 0.7 + axum08 | dual crates | 0.8 | `toggly-axum08` 0.1.1+ accepts workspace `toggly` range |
| Go | Go 1.26; grpc 1.85 | CI 1.26 + 1.27 | — | Floor Go 1.26; CI also runs latest stable |

Update this file in the same PR that changes peers, fixtures, or TFMs.
