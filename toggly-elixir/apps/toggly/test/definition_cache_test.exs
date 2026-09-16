defmodule Toggly.DefinitionCacheTest do
  use ExUnit.Case

  @v1 Jason.encode!([%{"featureKey" => "live", "filters" => [%{"name" => "AlwaysOn"}]}])
  @v2 Jason.encode!([%{"featureKey" => "live", "filters" => []}])

  test "304 is a hit, new 200 is a miss, same etag 200 is a hit" do
    {sup, name} =
      start_flags(CacheFlagsA, [
        {200, @v1, [{"etag", "v1"}]},
        {304, "", []},
        {200, @v1, [{"etag", "v1"}]},
        {200, @v2, [{"etag", "v2"}]}
      ])

    assert :ok = Toggly.refresh(name)
    assert cache_counts(name) == {0, 1}

    assert :ok = Toggly.refresh(name)
    assert cache_counts(name) == {1, 0}

    assert :ok = Toggly.refresh(name)
    assert cache_counts(name) == {1, 0}

    assert :ok = Toggly.refresh(name)
    refute Toggly.enabled?(name, "live")
    assert cache_counts(name) == {0, 1}

    Toggly.stop(sup)
  end

  test "network error and HTTP 500 keep last-good defs as hits" do
    {sup, name} =
      start_flags(CacheFlagsB, [
        {200, @v1, [{"etag", "v1"}]},
        {:error, :network},
        {500, "", []}
      ])

    assert :ok = Toggly.refresh(name)
    assert cache_counts(name) == {0, 1}

    assert {:error, :network} = Toggly.refresh(name)
    assert Toggly.enabled?(name, "live")
    assert {:error, {:http, 500}} = Toggly.refresh(name)
    assert Toggly.enabled?(name, "live")
    assert cache_counts(name) == {2, 0}

    Toggly.stop(sup)
  end

  test "initial network failure with no last-good defs is not a hit" do
    {sup, name} = start_flags(CacheFlagsC, [{:error, :timeout}])

    assert {:error, :timeout} = Toggly.refresh(name)
    refute_flushed(name)

    Toggly.stop(sup)
  end

  test "startup snapshot restore is a hit before any network refresh" do
    path = Path.join(System.tmp_dir!(), "toggly-cache-#{System.unique_integer([:positive])}.json")
    on_exit(fn -> File.rm(path) end)

    {writer, name} =
      start_flags(CacheSnapWrite, [{200, @v1, [{"etag", "v1"}]}], snapshot_path: path)

    assert :ok = Toggly.refresh(name)
    Toggly.stop(writer)

    {sup, restored} = start_flags(CacheSnapRead, [], snapshot_path: path)
    assert Toggly.enabled?(restored, "live")
    assert Toggly.snapshot(restored).source == :snapshot
    assert cache_counts(restored) == {1, 0}

    Toggly.stop(sup)
  end

  test "flush sends cache counters when feature usage is empty" do
    {sup, name} = start_flags(CacheFlagsD, [{200, @v1, [{"etag", "v1"}]}])

    assert :ok = Toggly.refresh(name)
    packet = flush_packet(name)
    assert packet["stats"] == []
    assert packet["definitionCacheMisses"] == 1
    refute Map.has_key?(packet, "definitionCacheHits")

    Toggly.stop(sup)
  end

  test "User-Agent matches the Mix project version on definitions GET and usage POST" do
    expected = "toggly-elixir/#{Toggly.version()}"
    assert expected == "toggly-elixir/#{mix_version()}"
    refute expected == "toggly-elixir/0.1.0"

    {sup, name} = start_flags(CacheFlagsUA, [{200, @v1, [{"etag", "v1"}]}])
    assert :ok = Toggly.refresh(name)
    assert_receive {:request, %{method: :get, headers: get_headers}}
    assert {"user-agent", expected} in get_headers

    {_, post_headers} = flush(name)
    assert {"user-agent", expected} in post_headers

    Toggly.stop(sup)
  end

  test "usage: false and missing app key never upload cache counters" do
    {sup, name} = start_flags(CacheFlagsOptOut, [{200, @v1, [{"etag", "v1"}]}], usage: false)

    assert :ok = Toggly.refresh(name)
    refute_flushed(name)
    Toggly.stop(sup)

    parent = self()

    {:ok, missing} =
      Toggly.start_link(
        name: CacheFlagsNoKey,
        defaults: %{"live" => true},
        refresh_interval: 0,
        flush_interval: 0,
        websocket: false,
        transport: fn req ->
          send(parent, {:unexpected, req})
          {:ok, %{status: 200, body: "", headers: []}}
        end
      )

    assert {:error, :missing_app_key} = Toggly.refresh(CacheFlagsNoKey)
    assert :ok = Toggly.flush(CacheFlagsNoKey)
    refute_receive {:unexpected, _}
    Toggly.stop(missing)
  end

  test "enabled? does not increment cache counters; sequential refresh counts once each" do
    {sup, name} =
      start_flags(CacheFlagsEval, [
        {200, @v1, [{"etag", "v1"}]},
        {304, "", []},
        {304, "", []}
      ])

    assert :ok = Toggly.refresh(name)
    assert cache_counts(name) == {0, 1}

    for _ <- 1..5, do: Toggly.enabled?(name, "live")
    packet = flush_packet(name)
    refute Map.has_key?(packet, "definitionCacheHits")
    refute Map.has_key?(packet, "definitionCacheMisses")
    assert packet["stats"] != []

    # GenServer serializes refresh; there is no in-flight skip, so each call counts.
    assert :ok = Toggly.refresh(name)
    assert :ok = Toggly.refresh(name)
    assert cache_counts(name) == {2, 0}

    Toggly.stop(sup)
  end

  test "WS flags-updated invalidation that applies a new revision is a miss" do
    {sup, name} =
      start_flags(CacheFlagsWS, [
        {200, @v1, [{"etag", "v1"}]},
        {200, @v2, [{"etag", "v2"}]}
      ])

    assert :ok = Toggly.refresh(name)
    assert cache_counts(name) == {0, 1}
    assert :ok = Toggly.subscribe(name)

    send(name, :apply_invalidation)
    assert_receive {:toggly_updated, ^name, "v2"}
    refute Toggly.enabled?(name, "live")
    assert cache_counts(name) == {0, 1}

    Toggly.stop(sup)
  end

  test "failed usage upload retains feature and cache counters until HTTP 2xx" do
    {sup, name, usage} =
      start_flags(CacheFlagsRetry, [{200, @v1, [{"etag", "v1"}]}, {304, "", []}],
        return_usage: true
      )

    assert :ok = Toggly.refresh(name)
    Agent.update(usage, fn _ -> 500 end)
    Toggly.record_usage(name, "live")
    assert {:error, :usage_upload} = Toggly.flush(name)
    assert_receive {:request, %{method: :post}}

    assert :ok = Toggly.refresh(name)
    Agent.update(usage, fn _ -> 200 end)
    packet = flush_packet(name)
    assert packet["definitionCacheMisses"] == 1
    assert packet["definitionCacheHits"] == 1
    assert packet["stats"] != []

    refute_flushed(name)
    Toggly.stop(sup)
  end

  defp start_flags(name, replies, opts \\ []) do
    parent = self()
    {client_opts, opts} = Keyword.split(opts, [:return_usage])
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
          {:error, reason} -> {:error, reason}
          :exhausted -> {:error, :network}
        end
      end
    end

    {:ok, sup} =
      Toggly.start_link(
        Keyword.merge(
          [
            name: name,
            app_key: "test",
            signed: false,
            transport: transport,
            refresh_interval: 0,
            flush_interval: 0,
            websocket: false
          ],
          Keyword.drop(opts, [:return_usage])
        )
      )

    if client_opts[:return_usage], do: {sup, name, usage}, else: {sup, name}
  end

  defp cache_counts(name) do
    packet = flush_packet(name)
    {packet["definitionCacheHits"] || 0, packet["definitionCacheMisses"] || 0}
  end

  defp flush_packet(name) do
    {packet, _} = flush(name)
    packet
  end

  defp flush(name) do
    assert :ok = Toggly.flush(name)
    assert_receive {:request, %{method: :post, headers: headers, body: body}}
    {Jason.decode!(body), headers}
  end

  defp refute_flushed(name) do
    assert :ok = Toggly.flush(name)
    refute_received {:request, %{method: :post}}
  end

  defp mix_version do
    ~r/version: "([^"]+)"/
    |> Regex.run(File.read!(Path.expand("../mix.exs", __DIR__)), capture: :all_but_first)
    |> hd()
  end
end
