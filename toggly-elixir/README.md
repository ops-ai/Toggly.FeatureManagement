# Toggly Elixir package family

| Package | Purpose | Version |
| --- | --- | --- |
| [toggly](apps/toggly) | OTP client, ETS evaluation, signatures, snapshots, HTTP/WebSocket updates, usage and Telemetry | 0.1.0 |
| [toggly_phoenix](apps/toggly_phoenix) | Request-local Plug context and route gates | 0.1.0 |
| [toggly_live_view](apps/toggly_live_view) | Socket-local assigns, update/restart hooks and HEEx feature/fallback component | 0.1.0 |

Read the core README for setup, runtime requirements, exact filter parameters, lifecycle and security behavior. The three packages use Hex registry dependencies when published; umbrella paths are only a repository development arrangement.

Run `mix deps.get`, `mix format --check-formatted`, `mix compile --warnings-as-errors`, `mix test --cover`, `mix hex.audit`, and `python3 tools/build-packages.py` here. Coverage exceeds 90% per application; no coverage exclusions. Canonical fixture tests consume `../docs/filter-parity/fixtures` directly. Actual loopback HTTP/WebSocket and connected LiveView tests run without external keys.

Elixir 1.20 / OTP 29 is the tested support floor. SonarCloud has no native Elixir analyzer: grouped native analysis is the enforced tool boundary. Optional Ecto/cache integrations and gRPC metrics export remain separate follow-ups.

`TOGGLY_HEX_BUILD=1` excludes repository-only umbrella paths when building each package. Built artifacts declare normal Hex version requirements; standalone installs never consult sibling source folders. `tools/verify-sample-artifacts.py` installs those built artifacts into an ephemeral sample copy for validation without changing the committed registry-only sample manifest.
