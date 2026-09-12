# OPS-146 local validation evidence

2026-09-12. Builder evidence for independent Oracle; no Oracle verdict or hosted-CI result is asserted here.

Runtime: Elixir 1.20.4, Erlang/OTP 29, Node 24.18.0 for Docs. Commands use programme-scoped `MIX_HOME=.worktrees/sdk-expansion/.mix` and `HEX_HOME=.worktrees/sdk-expansion/.hex`; no global configuration changes. Mix lock/event sockets and real loopback fixtures require local network permission.

## Current correction checks

| Command / surface | Result |
| --- | --- |
| Failure-first fresh signed restart test | Original source fails: real file written using fetched JWKS, first supervised client stopped, new named client with all transport disabled returns false instead of the verified flag |
| Failure-first scope fingerprint and optional-null-key tests | Reproduced cleartext scope metadata and optional JSON null round-trip issues before corrections |
| `mix deps.get --check-locked` | Committed SDK lock resolves unchanged |
| `mix format --check-formatted` | Native SDK formatter passes |
| `mix compile --warnings-as-errors` | SDK/adapters compile without warnings |
| `mix test --cover` | Core 49 tests, 97.18%; Plug 2 tests, 100%; LiveView 4 tests, 97.30%. Existing 91% line threshold retained, no exclusions |
| `mix hex.audit` | No retired/security-advisory packages in resolved graph |
| `python3 tools/build-packages.py` | Three 0.1.0 Hex artifacts built with normal registry dependencies |
| HTTPS Hex API lookup for all three package names | Each returns 404; initial unpublished 0.1.0 retained with changelog correction |
| `TOGGLY_MAX_SIGNATURE_AGE_SECONDS=60 python3 tools/verify-sample-artifacts.py /absolute/path/elixir-phoenix-sdk` | Final artifacts unpacked into fresh ephemeral host; deps.get, warnings-as-errors compilation, assets build and 6 host tests pass |
| Native Phoenix formatter on committed sample sources | Elixir and HEEx formatting passes using sample `.formatter.exs` and installed umbrella dependencies |
| Prettier on sample JavaScript/CSS | Compressed assets expanded using the existing programme-isolated formatter tool |
| Docs `npm test` / `npm run build` | 7 tests and production build pass; existing entity-context/dashboard-overview anchor warnings remain |
| `git diff --check` | SDK, Docs and Samples pass |

Final artifact host: `/var/folders/v1/8qftn7312fg9sz4798fktzhh0000gn/T/toggly-hex-fnq1vzpc/showcase`. Complete artifact verification log: `/tmp/ops146-final-artifact-validation.log`. That host uses ephemeral artifact path overrides only; it does not establish public-registry installability. The committed sample remains registry-only and its lock/public-install requirements are unchanged.

The new file tests cover fetched-only JWKS cold restoration before network access, invalid envelope and schema, duplicate/oversized/expired/malformed keys, configured-key precedence, key allowlist and signature age, hashed application/environment/endpoint/signed-mode partition, unsupported versions, corrupt/oversized storage, storage write failure, optional null key fields, exclusion of private key parameters, and rotation/update persistence through the WebSocket invalidation callback. Separate existing real loopback tests cover HTTP/ETag/usage, WebSocket reconnect and supervisor cleanup. A test-only teardown race was corrected by supervising the response Agent before its listener; the exposing seed 396694 and the final full run pass without the previous background handler error.

## Final tarball SHA256

| Artifact | SHA256 |
| --- | --- |
| `apps/toggly/toggly-0.1.0.tar` | `61ff8aa472f0679035bf856af4d5372e677191a389a00f41e44a58ccbe57883e` |
| `apps/toggly_phoenix/toggly_phoenix-0.1.0.tar` | `8888e3499fc560dfb6e8e79b1edad59bdb108c6063ee7d25d887606c962afe3f` |
| `apps/toggly_live_view/toggly_live_view-0.1.0.tar` | `8940560db79f6ce7379c35d8928960eb071b6b2f43029273bfaa1c655c4b7645` |

## Explicit boundaries

- `toggly`, `toggly_phoenix`, `toggly_live_view` 0.1.0 must be published to Hex in dependency order before the committed sample can resolve publicly. Generate and commit its full Mix lock only after actual publication; local artifact checks do not satisfy that gate.
- This builder does not push, publish, merge, mark Done, or issue Oracle pass. Root owns independent Oracle and hosted delivery.
- Elixir 1.20 / OTP 29 is the tested support floor. No earlier-runtime compatibility is asserted. Third-party Yamerl, WebSockex and Phoenix.Template emit baseline runtime deprecation warnings; no dependency patches or warning suppression were added.
- SonarCloud has no native Elixir analyzer; native compilation, formatting, ExUnit and coverage are the enforced evidence here.
- Backend raw signed definitions are evaluated locally with per-call identity, claims and entity context. Browser-evaluated-signed semantics are not substituted into this server SDK.
- Persistent public keys are application-owned trusted local state. Configured JWKS override stored keys; coordinate-derived allowed key IDs constrain substitution. Unpinned whole-store key/envelope substitution and whole-store rollback need independent protected trust/state and are not claimed. Signature age, future skew and key expiry are rechecked on restoration; already active last-known-good state survives failed refreshes.
- New files carry a versioned SHA256 scope fingerprint rather than duplicating backend app credentials in metadata. Legacy signed files without scope are ignored. Explicit unsigned local fixtures remain available; a sample without an app key uses that demonstration mode and does not prove a live signed cache.
- Automatic Toggly gRPC metrics upload, toggly_ecto and toggly_cache remain OPS-146 follow-ups. Usage uploads retain the backend HTTPS variantStats contract without identity/claims/unique-user hashes.
