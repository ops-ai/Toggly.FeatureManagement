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
end
