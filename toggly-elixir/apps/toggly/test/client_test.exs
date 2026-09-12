defmodule Toggly.ClientTest do
  use ExUnit.Case

  test "local ETS evaluation defaults, gates, per-call context, subscriptions and lifecycle" do
    {:ok, sup} =
      Toggly.start_link(
        name: TestFlags,
        defaults: %{"on" => true, "off" => false},
        refresh_interval: 0,
        websocket: false
      )

    assert Toggly.enabled?(TestFlags, "on")
    refute Toggly.enabled?(TestFlags, ["on", "off"])
    assert Toggly.enabled?(TestFlags, ["on", "off"], %{}, requirement: :any)
    assert Toggly.enabled?(TestFlags, "off", %{}, negate: true)
    assert Toggly.enabled?(TestFlags, "missing", %{}, default: true)
    refute Toggly.enabled?(TestFlags, [])
    assert :ok = Toggly.subscribe(TestFlags)
    assert :ok = Toggly.unsubscribe(TestFlags)
    assert %{source: :defaults} = Toggly.snapshot(TestFlags)
    assert :ok = Toggly.stop(sup)
    assert :ets.whereis(TestFlags) == :undefined
  end

  test "network refresh, ETag, failure retaining last known good and restart from file" do
    path = Path.join(System.tmp_dir!(), "toggly-test-#{System.unique_integer([:positive])}.json")
    on_exit(fn -> File.rm(path) end)
    parent = self()

    {:ok, replies} =
      Agent.start_link(fn ->
        [
          {200,
           Jason.encode!([%{"featureKey" => "live", "filters" => [%{"name" => "AlwaysOn"}]}]),
           [{"etag", "v1"}]},
          {304, "", []},
          {500, "", []}
        ]
      end)

    transport = fn req ->
      send(parent, {:request, req})

      {status, body, headers} =
        Agent.get_and_update(replies, fn [reply | rest] -> {reply, rest} end)

      {:ok, %{status: status, body: body, headers: headers}}
    end

    {:ok, sup} =
      Toggly.start_link(
        name: RemoteFlags,
        app_key: "test",
        signed: false,
        transport: transport,
        snapshot_path: path,
        refresh_interval: 0,
        websocket: false
      )

    assert :ok = Toggly.subscribe(RemoteFlags)
    assert :ok = Toggly.refresh(RemoteFlags)
    assert_receive {:request, %{url: "https://definitions.toggly.io/definitions/test/Production"}}
    assert Toggly.enabled?(RemoteFlags, "live")
    assert_receive {:toggly_updated, RemoteFlags, "v1"}
    assert :ok = Toggly.refresh(RemoteFlags)
    assert_receive {:request, %{headers: headers}}
    assert {"if-none-match", "v1"} in headers
    assert {:error, {:http, 500}} = Toggly.refresh(RemoteFlags)
    assert Toggly.enabled?(RemoteFlags, "live")
    Toggly.stop(sup)

    {:ok, sup2} =
      Toggly.start_link(
        name: RemoteFlags,
        app_key: "test",
        signed: false,
        snapshot_path: path,
        refresh_interval: 0,
        websocket: false
      )

    assert Toggly.enabled?(RemoteFlags, "live")
    Toggly.stop(sup2)
  end
end
