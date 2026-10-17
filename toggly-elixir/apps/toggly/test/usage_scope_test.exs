defmodule Toggly.UsageScopeTest do
  use ExUnit.Case, async: false

  @v1 ~s([{"featureKey":"live","filters":[{"name":"AlwaysOn"}]}])

  test "with_usage records success duration" do
    {sup, name} = start_flags(UsageScopeOk, [{200, @v1, [{"etag", "v1"}]}])
    assert :ok = Toggly.refresh(name)

    assert :done = Toggly.with_usage(name, "live", fn -> :done end)
    Process.sleep(20)
    packet = flush_packet(name)
    enabled = variant(packet, "live", "enabled")
    assert enabled["usedCount"] >= 1
    assert (enabled["durationSumMs"] || 0) >= 0

    Toggly.stop(sup)
  end

  test "with_usage records failure on raise" do
    {sup, name} = start_flags(UsageScopeRaise, [{200, @v1, [{"etag", "v1"}]}])
    assert :ok = Toggly.refresh(name)

    assert_raise RuntimeError, fn ->
      Toggly.with_usage(name, "live", fn -> raise "boom" end)
    end

    Process.sleep(20)
    packet = flush_packet(name)
    enabled = variant(packet, "live", "enabled")
    assert enabled["usedCount"] >= 1
    assert enabled["errorCount"] >= 1

    Toggly.stop(sup)
  end

  test "with_usage records failure on throw" do
    {sup, name} = start_flags(UsageScopeThrow, [{200, @v1, [{"etag", "v1"}]}])
    assert :ok = Toggly.refresh(name)

    assert catch_throw(Toggly.with_usage(name, "live", fn -> throw(:bail) end)) == :bail
    Process.sleep(20)
    packet = flush_packet(name)
    enabled = variant(packet, "live", "enabled")
    assert enabled["usedCount"] >= 1
    assert enabled["errorCount"] >= 1

    Toggly.stop(sup)
  end

  test "with_usage records failure on exit" do
    {sup, name} = start_flags(UsageScopeExit, [{200, @v1, [{"etag", "v1"}]}])
    assert :ok = Toggly.refresh(name)

    assert catch_exit(Toggly.with_usage(name, "live", fn -> exit(:timeout) end)) == :timeout
    Process.sleep(20)
    packet = flush_packet(name)
    enabled = variant(packet, "live", "enabled")
    assert enabled["usedCount"] >= 1
    assert enabled["errorCount"] >= 1

    Toggly.stop(sup)
  end

  test "with_usage soft-fail callback records error" do
    {sup, name} = start_flags(UsageScopeSoft, [{200, @v1, [{"etag", "v1"}]}])
    assert :ok = Toggly.refresh(name)

    assert :ok =
             Toggly.with_usage(name, "live", fn fail ->
               fail.()
               :ok
             end)

    Process.sleep(20)
    packet = flush_packet(name)
    enabled = variant(packet, "live", "enabled")
    assert enabled["usedCount"] >= 1
    assert enabled["errorCount"] >= 1

    Toggly.stop(sup)
  end

  defp variant(packet, key, label) do
    stat = Enum.find(packet["stats"] || [], &(&1["feature"] == key))
    assert stat, "expected stats for #{key}, got #{inspect(packet["stats"])}"
    Map.fetch!(stat["variantStats"], label)
  end

  defp flush_packet(name) do
    assert :ok = Toggly.flush(name)
    assert_receive {:request, %{method: :post, body: body}}, 1_000
    Jason.decode!(body)
  end

  defp start_flags(name, replies) do
    parent = self()
    defs = Agent.start_link(fn -> replies end) |> elem(1)
    usage = Agent.start_link(fn -> 200 end) |> elem(1)

    on_exit(fn ->
      if Process.alive?(defs), do: Agent.stop(defs)
      if Process.alive?(usage), do: Agent.stop(usage)
    end)

    transport = fn req ->
      send(parent, {:request, req})

      if req.method == :post do
        {:ok, %{status: Agent.get(usage, & &1), body: "", headers: []}}
      else
        case Agent.get_and_update(defs, fn
               [next | rest] -> {next, rest}
               [] -> {:exhausted, []}
             end) do
          {status, body, headers} -> {:ok, %{status: status, body: body, headers: headers}}
          :exhausted -> {:error, :network}
        end
      end
    end

    {:ok, sup} =
      Toggly.start_link(
        name: name,
        app_key: "test",
        signed: false,
        transport: transport,
        refresh_interval: 0,
        flush_interval: 0,
        websocket: false
      )

    {sup, name}
  end
end
