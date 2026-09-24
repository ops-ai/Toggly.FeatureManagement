# toggly_phoenix

Phoenix/Plug integration for [Toggly](https://toggly.io), usable with a remote application or offline defaults. A feature flag selects an application branch by a stable key.

Requires Elixir 1.20+, OTP 29+, Plug 1.18+. Add `{:toggly_phoenix, "~> 0.2.0"}` and supervise `{Toggly, name: MyApp.Flags, app_key: System.get_env("TOGGLY_APP_KEY")}`. See [core configuration](https://docs.toggly.io/sdks/elixir) for signed definitions, defaults, snapshots, usage and lifecycle.

```elixir
# Run after your authentication plug. Context remains on this connection.
plug Toggly.Phoenix.Plug,
  client: MyApp.Flags,
  flags: ["new-dashboard", "api-v2"],
  context: &MyAppWeb.FeatureContext.from_conn/1
```

The callback returns a string-keyed map such as `%{"identity" => conn.assigns.current_user.id}`. The Plug adds `request.userAgent`, `request.acceptLanguage` and `request.country` from request headers without replacing explicit context. Trust proxy headers only after your infrastructure sanitizes them. Assigns: `toggly_client`, `toggly_context`, `toggly_flags`.

For catalog-local variants, use the Plug helper so handlers need no manual map:

```elixir
assignment = Toggly.Phoenix.Plug.get_variant(conn, "checkout-flow")
```

Empty context identity still falls back to the client's `:identity` / `Toggly.set_identity/2`.

Route protection is optional: `gate: "beta-access"`, `status: 404` (default), `requirement: :all | :any`, `negate: false`, and `default: false`. A disabled gate sends `Feature unavailable` and halts. It does not replace authorization. Pass identity, claims, groups and `entity` per call; never mutate a shared user.

Run `mix test --cover` from the umbrella root for concurrent request isolation and route gate tests. MIT. [Full documentation](https://docs.toggly.io/sdks/elixir).
