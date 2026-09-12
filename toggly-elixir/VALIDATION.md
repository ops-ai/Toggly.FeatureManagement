# OPS-146 local validation evidence

2026-09-12. Builder evidence for independent Oracle; this is not an Oracle verdict or hosted-CI result.

Runtime: Elixir 1.20.4, Erlang/OTP 29, Node 24.18.0 for Docs. Mix/Hex configuration is scoped outside the package to the programme worktree. All commands below exited 0 unless explicitly marked otherwise.

| Command / surface | Result |
| --- | --- |
| `mix deps.get --check-locked` | Exact SDK umbrella lock resolves |
| `mix format --check-formatted` | Native formatting passes |
| `mix compile --warnings-as-errors` | No new SDK compiler warnings |
| `mix test --cover` | Core 34 tests, 96.51%; Plug 2 tests, 100%; LiveView 4 tests, 97.30%. Native line coverage threshold 91%, no exclusions |
| `mix hex.audit` | No retired/security-advisory packages in resolved graph |
| `python3 tools/build-packages.py` | All three 0.1.0 Hex tarballs built; metadata includes normal Hex dependencies, no umbrella paths |
| `mix run --no-start tools/release-check.exs toggly` | Read-only registry comparison reports manifest ahead/unpublished; no publish executed |
| `python3 tools/verify-sample-artifacts.py /absolute/path/elixir-phoenix-sdk` | Final tarballs unpacked into an ephemeral host; deps.get, compile warnings-as-errors, assets build, 2 full-host LiveView tests pass |
| Docs `npm test` | 7 tests pass |
| Docs `npm run build` | Production build passes; only recorded baseline entity-context / dashboard-overview anchor warnings |
| Sample browser | Real LiveSocket loads. Matching→Non-matching switches Alice→Bob, eight targeted/filter outcomes and VIP→standard checkout. Layout visually inspected at 1280px |

Tests cover canonical cross-language filter fixtures and independent SHA256 hash expectation, malformed/unknown filters, entity conjunction and comparisons, true WebCrypto positive signature fixture plus tampering/key/clock errors, real loopback HTTP/ETag/failure and HTTPS usage wire contract, WebSocket invalidation/reconnect, client supervisor restart/cleanup, signed snapshot trust, concurrent Plug contexts, connected LiveView isolation/update/restart hooks and subscription cleanup.

## Explicit boundaries

- `toggly`, `toggly_phoenix`, `toggly_live_view` 0.1.0 must be published to Hex in that order before the committed registry-only sample can resolve publicly. The ephemeral artifact check is local candidate evidence, not public-registry installation. No fake SDK lock entries or local paths were committed to the sample. Generate and commit its full Mix lock after actual publication.
- No package publication, push, PR, merge, dashboard provisioning, or live hosted-key connectivity was performed by this builder.
- Elixir 1.20 / OTP 29 is the tested support floor. No earlier runtime compatibility is asserted.
- SonarCloud has no native Elixir analyzer; this family enforces native compilation, formatting, ExUnit and coverage. It does not claim Sonar coverage/quality results.
- Resolved third-party Yamerl, WebSockex and Phoenix.Template emit existing deprecation/compiler warnings on the newly released runtime; SDK warnings-as-errors passes. Those dependencies were not patched or suppressed.
- Metrics expose native Telemetry events/custom exporter integration. Automatic Toggly gRPC metrics upload, toggly_ecto and toggly_cache are retained follow-ups in OPS-146. Usage uploads use the actual backend HTTPS variantStats contract without identity/claims/unique-user hashes.
- Authenticated signed offline restart requires configured trusted JWKS. Disk snapshots do not trust public keys embedded alongside stored definitions. Snapshots are not an external monotonic anti-replay ledger.
