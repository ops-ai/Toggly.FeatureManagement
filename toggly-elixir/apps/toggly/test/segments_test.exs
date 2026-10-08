defmodule Toggly.SegmentsHTTP do
  import Plug.Conn
  def init(opts), do: opts

  def call(conn, {script, parent}) do
    {:ok, body, conn} = read_body(conn)
    send(parent, {:http, conn.method, conn.request_path, conn.req_headers, body})
    {status, reply, headers} = Agent.get(script, & &1)
    conn = Enum.reduce(headers, conn, fn {k, v}, c -> put_resp_header(c, k, v) end)
    send_resp(conn, status, reply)
  end
end

defmodule Toggly.SegmentsTest do
  use ExUnit.Case

  setup do
    script =
      start_supervised!(
        {Agent,
         fn ->
           {200, Jason.encode!([%{"id" => "list-1", "itemCount" => 1}]), []}
         end}
      )

    server =
      start_supervised!(
        {Bandit,
         plug: {Toggly.SegmentsHTTP, {script, self()}},
         port: 0,
         ip: {127, 0, 0, 1},
         startup_log: false}
      )

    {:ok, {_, port}} = ThousandIsland.listener_info(server)
    %{script: script, base: "http://127.0.0.1:#{port}"}
  end

  test "list_segments decodes JSON success bodies", %{base: base} do
    assert {:ok, [%{"id" => "list-1"}]} =
             Toggly.Segments.list_segments(app_key: "backend-key", app_base_url: base)
  end

  test "empty success body returns nil", %{script: script, base: base} do
    Agent.update(script, fn _ -> {204, "", []} end)

    assert {:ok, nil} =
             Toggly.Segments.remove_segment_members("beta", ["user-1"],
               app_key: "backend-key",
               app_base_url: base
             )
  end

  test "malformed success JSON returns error tuple", %{script: script, base: base} do
    Agent.update(script, fn _ -> {200, "not-json{", []} end)

    assert {:error, {:json, _}} =
             Toggly.Segments.list_segments(app_key: "backend-key", app_base_url: base)
  end
end
