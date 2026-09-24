defmodule Toggly.PhoenixTest do
  use ExUnit.Case
  import Plug.Test

  setup do
    start_supervised!(
      {Toggly,
       name: PlugFlags, defaults: %{"beta-access" => false}, refresh_interval: 0, websocket: false}
    )

    :ok
  end

  test "Plug isolates each request and maps headers without shared mutation" do
    opts =
      Toggly.Phoenix.Plug.init(
        client: PlugFlags,
        flags: ["beta-access"],
        context: fn conn -> %{"identity" => conn.params["user"]} end
      )

    results =
      for user <- ["alice", "bob"],
          do:
            Task.async(fn ->
              conn(:get, "/?user=#{user}")
              |> Plug.Conn.fetch_query_params()
              |> Plug.Conn.put_req_header("cf-ipcountry", "US")
              |> Toggly.Phoenix.Plug.call(opts)
            end)

    [alice, bob] = Enum.map(results, &Task.await/1)
    assert alice.assigns.toggly_context["identity"] == "alice"
    assert bob.assigns.toggly_context["identity"] == "bob"
    assert alice.assigns.toggly_context["request"]["country"] == "US"
    refute alice.assigns.toggly_flags["beta-access"]
  end

  test "optional route gate halts disabled requests; negate and defaults are explicit" do
    opts = Toggly.Phoenix.Plug.init(client: PlugFlags, gate: "beta-access")
    response = Toggly.Phoenix.Plug.call(conn(:get, "/"), opts)
    assert response.status == 404 and response.halted
    refute Toggly.Phoenix.Plug.call(conn(:get, "/"), Keyword.put(opts, :negate, true)).halted
  end

  test "get_variant/2 reads toggly_context without a manual map" do
    parent = self()

    transport = fn _req ->
      send(parent, :fetched)

      {:ok,
       %{
         status: 200,
         body:
           Jason.encode!([
             %{
               "featureKey" => "checkout-flow",
               "filters" => [%{"name" => "AlwaysOn"}],
               "variants" => [
                 %{"name" => "A", "configurationValue" => %{"color" => "blue"}},
                 %{"name" => "B", "configurationValue" => %{"color" => "green"}}
               ],
               "allocation" => %{
                 "defaultWhenEnabled" => "B",
                 "user" => [%{"variant" => "A", "users" => ["alice"]}]
               }
             }
           ]),
         headers: [{"etag", "v1"}]
       }}
    end

    start_supervised!(
      {Toggly,
       name: PlugVariantFlags,
       app_key: "test",
       signed: false,
       transport: transport,
       refresh_interval: 0,
       websocket: false}
    )

    assert :ok = Toggly.refresh(PlugVariantFlags)

    opts =
      Toggly.Phoenix.Plug.init(
        client: PlugVariantFlags,
        context: fn conn -> %{"identity" => conn.params["user"]} end
      )

    conn =
      conn(:get, "/?user=alice")
      |> Plug.Conn.fetch_query_params()
      |> Toggly.Phoenix.Plug.call(opts)

    assignment = Toggly.Phoenix.Plug.get_variant(conn, "checkout-flow")
    assert assignment.variant_name == "A"
    assert Toggly.Phoenix.Plug.get_variant_value(conn, "checkout-flow") == %{"color" => "blue"}
  end

  test "get_variant/2 raises when Plug has not run" do
    assert_raise ArgumentError, ~r/Toggly.Phoenix.Plug/, fn ->
      Toggly.Phoenix.Plug.get_variant(conn(:get, "/"), "checkout-flow")
    end
  end
end
