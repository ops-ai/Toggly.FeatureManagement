defmodule Toggly.TestSocket do
  def init(parent) do
    send(parent, {:socket, self()})
    {:ok, parent}
  end

  def handle_in(_, state), do: {:ok, state}
  def handle_info({:send, text}, state), do: {:push, {:text, text}, state}
  def handle_info(:disconnect, state), do: {:stop, :normal, state}
end

defmodule Toggly.TestHTTP do
  import Plug.Conn
  def init(opts), do: opts

  def call(conn, {script, parent}) do
    if String.ends_with?(conn.request_path, "/ws") do
      WebSockAdapter.upgrade(conn, Toggly.TestSocket, parent, []) |> halt()
    else
      {:ok, body, conn} = read_body(conn)
      send(parent, {:http, conn.method, conn.request_path, conn.req_headers, body})
      {status, reply, headers} = Agent.get(script, & &1)
      conn = Enum.reduce(headers, conn, fn {k, v}, c -> put_resp_header(c, k, v) end)
      send_resp(conn, status, reply)
    end
  end
end

defmodule Toggly.NetworkTest do
  use ExUnit.Case

  setup do
    {:ok, script} =
      Agent.start_link(fn ->
        {200, Jason.encode!([%{"featureKey" => "live", "filters" => [%{"name" => "AlwaysOn"}]}]),
         [{"etag", "v1"}]}
      end)

    server =
      start_supervised!(
        {Bandit,
         plug: {Toggly.TestHTTP, {script, self()}},
         port: 0,
         ip: {127, 0, 0, 1},
         startup_log: false}
      )

    {:ok, {_, port}} = ThousandIsland.listener_info(server)
    %{script: script, base: "http://127.0.0.1:#{port}"}
  end

  test "real HTTP status/ETag/usage contract and transport failure", %{script: script, base: base} do
    sup =
      start_supervised!(
        {Toggly,
         name: HTTPFlags,
         app_key: "test",
         base_url: base,
         usage_base_url: base,
         signed: false,
         websocket: false,
         refresh_interval: 0}
      )

    assert :ok = Toggly.refresh(HTTPFlags)
    assert_receive {:http, "GET", "/definitions/test/Production", _, ""}
    assert Toggly.enabled?(HTTPFlags, "live")
    Toggly.record_usage(HTTPFlags, "live")
    Toggly.record_view(HTTPFlags, "live", false)
    assert :ok = Toggly.flush(HTTPFlags)
    assert_receive {:http, "POST", "/api/usage/stats", _, body}
    packet = Jason.decode!(body)
    assert packet["appKey"] == "test"

    assert [
             %{
               "feature" => "live",
               "variantStats" => %{
                 "enabled" => %{"checkCount" => 1, "usedCount" => 1},
                 "disabled" => %{"viewedCount" => 1}
               }
             }
           ] = packet["stats"]

    assert :ok = Toggly.flush(HTTPFlags)
    Agent.update(script, fn _ -> {304, "", []} end)
    assert :ok = Toggly.refresh(HTTPFlags)
    assert_receive {:http, "GET", _, headers, _}
    assert {"if-none-match", "v1"} in headers
    Agent.update(script, fn _ -> {500, "", []} end)
    assert {:error, {:http, 500}} = Toggly.refresh(HTTPFlags)
    assert Toggly.enabled?(HTTPFlags, "live")
    Toggly.record_usage(HTTPFlags, "live")
    assert {:error, :usage_upload} = Toggly.flush(HTTPFlags)
    Agent.update(script, fn _ -> {200, "{}", []} end)
    assert :ok = Toggly.flush(HTTPFlags)
    assert {:error, :invalid_definitions} = Toggly.refresh(HTTPFlags)
    Agent.update(script, fn _ -> {200, "bad", []} end)
    assert {:error, :invalid_json} = Toggly.refresh(HTTPFlags)
    assert Toggly.enabled?(HTTPFlags, "live")
    Toggly.stop(sup)

    assert {:error, :network} =
             Toggly.Transport.request(%{
               method: :get,
               url: "http://127.0.0.1:1",
               headers: [],
               timeout: 50
             })
  end

  test "real websocket invalidation, reconnect, periodic refresh and supervisor cleanup", %{
    script: script,
    base: base
  } do
    sup =
      start_supervised!(
        {Toggly,
         name: WSFlags,
         app_key: "test",
         base_url: base,
         signed: false,
         refresh_interval: 50,
         reconnect_interval: 10}
      )

    assert_receive {:socket, socket}, 2000
    assert_receive {:http, "GET", _, _, _}, 2000

    Agent.update(script, fn _ ->
      {200, Jason.encode!([%{"featureKey" => "live", "filters" => []}]), [{"etag", "v2"}]}
    end)

    Toggly.subscribe(WSFlags)
    send(socket, {:send, ~s({"type":"flags-updated"})})
    assert_receive {:toggly_updated, WSFlags, "v2"}, 2000
    refute Toggly.enabled?(WSFlags, "live")
    send(socket, :disconnect)
    assert_receive {:socket, socket2}, 2000
    refute socket == socket2
    client = Process.whereis(WSFlags)
    Process.exit(client, :kill)
    assert_receive {:socket, _}, 2000
    assert Process.whereis(WSFlags) != client
    children = Supervisor.which_children(sup) |> Enum.map(&elem(&1, 1))
    Toggly.stop(sup)
    assert Enum.all?(children, &(!Process.alive?(&1)))
    assert :ets.whereis(WSFlags) == :undefined
  end
end
