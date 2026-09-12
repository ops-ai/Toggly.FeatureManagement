# toggly_live_view

LiveView feature assigns, update subscriptions and declarative HEEx gates for [Toggly](https://toggly.io). Usable with online definitions or offline defaults.

Requires Elixir 1.20+, OTP 29+, Phoenix 1.8 / LiveView 1.2+. Add `{:toggly_live_view, "~> 0.1.0"}`. Supervise one named `Toggly` client; [core documentation](https://docs.toggly.io/sdks/elixir) covers configuration and filters.

```elixir
use Phoenix.LiveView
import Toggly.LiveView, only: [feature: 1]
on_mount {Toggly.LiveView, {MyApp.Flags, ["new-dashboard", "api-v2"]}}
```

The hook reads `socket.assigns.toggly_context`, or the signed session's `"toggly_context"` map. Populate it from authenticated application state before the Toggly hook. HTTP Plug assigns do not automatically become LiveView session data. Raw URL parameters are not trusted identity.

```heex
<.feature flags={@toggly_flags} feature={["new-dashboard", "api-v2"]} requirement={:any}>
  <p>New dashboard</p>
  <:fallback><p>Classic dashboard</p></:fallback>
</.feature>
```

`requirement` defaults to `:all`; `negate` and `default` default to false. Empty features are false before negation. Flags are booleans, not multivariate experiment assignments. Gates render presentation branches and do not authorize access.

Use `Toggly.LiveView.assign_feature_flags(socket, MyApp.Flags, keys, context: context)` after a socket-local identity or entity change. The `on_mount` hook subscribes only for connected sockets, reevaluates using that socket's current context on updates, and resubscribes after a client restart. Process death removes server subscriptions; no manual terminate callback is required. Unrelated messages continue to your LiveView handler.

The socket receives only evaluated booleans. Do not send backend app keys or raw definitions to browsers. See [the full Phoenix showcase](https://github.com/ops-ai/Toggly.Samples/tree/develop/elixir-phoenix-sdk) for identity and Order.Vip contexts.

Run `mix test --cover` from the umbrella root. Tests use real connected LiveViews for concurrent identities, definition updates, client restarts and cleanup. MIT.
