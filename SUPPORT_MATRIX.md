# SDK host support matrix

Living inventory for [OPS-1563](https://linear.app/opsai/issue/OPS-1563/dual-major-host-support-programme).
Design: `Toggly.wiki/Home/Engineering/Plans/2026-09-28-Dual-Major-Host-Support-Design.md`.

**Rule:** a host major is supported only when a packed fixture or TFM matrix job proves it. Peers alone are not enough. Keep every declared major; add newest when proven. Prefer peer widen; split packages only when unspannable.

| SDK | Declared | Proven CI majors | Newest stable | Gap / action |
| --- | --- | --- | --- | --- |
| Next (`@ops-ai/nextjs-toggly-*`) | `next >=14` | 14.2.35, 15.5.25, 16.3.6 (webpack+turbopack) | 16.3.6 | Wave 1 done |
| Nuxt | `^3 \|\| ^4` | 3 + 4 fixtures | 4.5.x | Maintain |
| Astro | `^5 \|\| ^6 \|\| ^7` | 5 / 6 / 7 (OPS-1179) | 7.3.x | Maintain |
| NestJS | `^10 \|\| ^11 \|\| ^12` | release matrix 10, 11, 12 | 12.1.x | Wave 2 |
| React Router | `^7 \|\| ^8` | 7 + 8 hosts | 8.4.x | Maintain / prove 8 |
| Fastify | `^4 \|\| ^5` | 4 + 5 | 5.12.x | Maintain |
| Hono | `^4` | 4.x | 4.13.x | No major gap |
| Gatsby | `^5` | 5.x | 5.16.x | No Gatsby 6 |
| Docusaurus | `^3` | 3.x | 3.10.x | No Docusaurus 4 |
| Angular | `>=15` | workspace hosts | 22.x | Prove latest under floor |
| Electron | `>=28` | hosts | 44.x | Prove latest under floor |
| Svelte | `^4 \|\| ^5` | 4 + 5 | 5.x | Maintain |
| SvelteKit | kit `^2` | 2.x | 2.x | Kit 3 when shipped |
| .NET core family | netstandard2.1…net9 + **net10** | multi-TFM build | net10 | Wave 2 |
| .NET Mongo/Dapper/EF | includes net10 | net8/net10 consumers | net10 | Maintain |
| Java Spring | Boot 3.5 / Java 17 | Boot 3 hosts | Boot 3.5 | Boot 4 when stable |
| Java Redis | Jedis 5 + Jedis 8 | dual artifacts | Jedis 8 | No Lettuce 7 |
| Android | AGP 8.7 / Kotlin 2.0 | Java 17+21 | AGP 9 / Kotlin 2.2+ | Wave 3 dual line |
| Flutter | Dart `>=2.18.2 <4` | Flutter stable (Dart 3) | Dart 3 | Keep floor; equatable 3 deferred |
| iOS | iOS 14 / macOS 11 | Xcode 16.x matrix | Xcode 16.4 | Keep floor |
| Rust axum | axum 0.7 + axum08 | dual crates | 0.8 | Split-only |
| Go | Go 1.25; grpc 1.80 | CI | newer grpc | Coordinated bump only |

Update this file in the same PR that changes peers, fixtures, or TFMs.
