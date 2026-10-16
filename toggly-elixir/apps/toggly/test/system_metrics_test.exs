defmodule Toggly.SystemMetricsTest.ExceptionClient do
  @moduledoc false
  use GenServer

  def start_link(_), do: GenServer.start_link(__MODULE__, 0)
  def init(n), do: {:ok, n}
  def handle_cast(:system_metrics_exception, n), do: {:noreply, n + 1}
  def get(pid), do: :sys.get_state(pid)
end

defmodule Toggly.SystemMetricsTest do
  use ExUnit.Case

  alias Toggly.SystemMetrics

  test "interval_ms and max_pending defaults" do
    assert SystemMetrics.interval_ms([]) == 10_000
    assert SystemMetrics.interval_ms(system_metrics_interval_ms: 2500) == 2500
    assert SystemMetrics.max_pending() == 30
  end

  test "default_sample returns BEAM metrics with finite values" do
    _ = :erlang.statistics(:runtime)
    _ = :erlang.statistics(:wall_clock)
    Process.sleep(2)

    {0, samples} = SystemMetrics.default_sample(0)
    metrics = Map.new(samples)

    assert Map.has_key?(metrics, "GCHeapSize")
    assert Map.has_key?(metrics, "ProcessCount")
    assert metrics["GCHeapSize"] > 0
    assert metrics["ProcessCount"] > 0
    # CpuUsage is best-effort; when present it must be a finite percentage.
    if Map.has_key?(metrics, "CpuUsage") do
      assert metrics["CpuUsage"] >= 0
      assert metrics["CpuUsage"] <= 100
    end
  end

  test "default_sample emits ExceptionCount once and clears the counter" do
    {0, samples} = SystemMetrics.default_sample(2)
    assert {"ExceptionCount", 2.0} in samples
    {0, again} = SystemMetrics.default_sample(0)
    refute Enum.any?(again, fn {m, _} -> m == "ExceptionCount" end)
  end

  test "system_metrics: false does not sample" do
    {sup, name} = start_client(SystemMetricsOff, system_metrics: false, metrics: true)

    send(name, :system_metrics_sample)
    :sys.get_state(name)
    assert :ok = Toggly.flush(name)
    refute_metrics_posted()

    Toggly.stop(sup)
  end

  test "system_metrics samples via injectable sampler and uploads on flush" do
    {sup, name} = start_client(SystemMetricsSampler, system_metrics: true, metrics: true)

    send(name, :system_metrics_sample)

    assert :ok = Toggly.metric(name, :counter, "orders", 1)
    assert :ok = Toggly.flush(name)

    [packet] = flush_metrics_packets(name)

    assert Enum.any?(packet["observations"], fn row ->
             row["metric"] == "CpuUsage" and row["variantValues"]["enabled"] == 42.0
           end)

    Toggly.stop(sup)
  end

  test "system_metrics requires metrics: true" do
    {sup, name} =
      start_client(SystemMetricsNoMetrics,
        system_metrics: true,
        metrics: false,
        system_metrics_sampler: fn -> [{"CpuUsage", 1.0}] end
      )

    send(name, :system_metrics_sample)
    assert :ok = Toggly.flush(name)
    refute_metrics_posted()

    Toggly.stop(sup)
  end

  test "attach and detach exception handler is idempotent" do
    assert :ok = SystemMetrics.attach_exception_handler(SmHandlerIdempotent, self())
    assert :ok = SystemMetrics.attach_exception_handler(SmHandlerIdempotent, self())
    assert :ok = SystemMetrics.detach_exception_handler(SmHandlerIdempotent)
    assert :ok = SystemMetrics.detach_exception_handler(SmHandlerIdempotent)
  end

  test "attach_exception_handler refreshes stale client pid on already_exists" do
    {:ok, stale} = Toggly.SystemMetricsTest.ExceptionClient.start_link([])
    assert :ok = SystemMetrics.attach_exception_handler(SmHandlerRefresh, stale)
    GenServer.stop(stale)

    {:ok, live} = Toggly.SystemMetricsTest.ExceptionClient.start_link([])
    assert :ok = SystemMetrics.attach_exception_handler(SmHandlerRefresh, live)

    {:ok, handler_config} =
      :logger.get_handler_config(:"toggly.system_metrics.SmHandlerRefresh")

    client =
      case handler_config do
        %{config: %{client: pid}} -> pid
        %{client: pid} -> pid
      end

    assert client == live

    assert :ok =
             Toggly.SystemMetrics.LogHandler.log(
               %{msg: {:report, %{kind: :crash_report}}},
               handler_config
             )

    assert Toggly.SystemMetricsTest.ExceptionClient.get(live) == 1
    assert :ok = SystemMetrics.detach_exception_handler(SmHandlerRefresh)
    GenServer.stop(live)
  end

  test "parse_vm_rss extracts kilobytes from /proc status" do
    assert SystemMetrics.parse_vm_rss("Name:\tfoo\nVmRSS:\t 2048 kB\n") == 2048 * 1024.0
    assert SystemMetrics.parse_vm_rss("VmRSS:\tnot-a-number\n") == nil
    assert SystemMetrics.parse_vm_rss("nope\n") == nil
  end

  test "LogHandler ignores crash reports for dead clients and keyword reports" do
    {:ok, pid} = Toggly.SystemMetricsTest.ExceptionClient.start_link([])
    GenServer.stop(pid)

    assert :ok =
             Toggly.SystemMetrics.LogHandler.log(
               %{msg: {:report, %{kind: :crash_report}}},
               %{config: %{client: pid}}
             )

    assert :ok =
             Toggly.SystemMetrics.LogHandler.log(
               %{msg: {:report, [kind: :crash_report]}},
               %{config: %{client: self()}}
             )
  end

  test "LogHandler casts exception on crash_report and ignores other events" do
    {:ok, pid} = Toggly.SystemMetricsTest.ExceptionClient.start_link([])

    assert :ok =
             Toggly.SystemMetrics.LogHandler.log(
               %{msg: {:report, %{kind: :crash_report}}},
               %{config: %{client: pid}}
             )

    assert Toggly.SystemMetricsTest.ExceptionClient.get(pid) == 1

    assert :ok =
             Toggly.SystemMetrics.LogHandler.log(
               %{msg: {:report, %{label: {:proc_lib, :crash}}}},
               %{client: pid}
             )

    assert Toggly.SystemMetricsTest.ExceptionClient.get(pid) == 2

    assert :ok = Toggly.SystemMetrics.LogHandler.log(%{msg: {:string, ~c"hi"}}, %{})
    assert Toggly.SystemMetricsTest.ExceptionClient.get(pid) == 2

    GenServer.stop(pid)
  end

  test "atom metric keys are accepted" do
    {sup, name} = start_client(SystemMetricsAtomKey, system_metrics: false, metrics: true)
    assert :ok = Toggly.metric(name, :counter, :orders, 1)
    assert :ok = Toggly.flush(name)
    [packet] = flush_metrics_packets(name)

    assert Enum.any?(packet["counters"], fn row -> row["metric"] == "orders" end)

    Toggly.stop(sup)
  end

  defp start_client(name, opts) do
    parent = self()

    transport = fn req ->
      send(parent, {:request, req})

      if req.method == :post do
        {:ok, %{status: 200, body: "", headers: []}}
      else
        {:ok, %{status: 200, body: "[]", headers: [{"etag", "v1"}]}}
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
            websocket: false,
            system_metrics_sampler: fn -> [{"CpuUsage", 42.0}] end
          ],
          opts
        )
      )

    {sup, name}
  end

  defp flush_metrics_packets(name) do
    assert :ok = Toggly.flush(name)

    receive do
      {:request, %{method: :post, url: url, body: body}} ->
        if String.contains?(url, "api/metrics") do
          [Jason.decode!(body)]
        else
          flush_metrics_packets(name)
        end
    after
      50 -> flunk("expected metrics upload")
    end
  end

  defp refute_metrics_posted do
    receive do
      {:request, %{method: :post, url: url}} ->
        if String.contains?(url, "api/metrics"), do: flunk("unexpected metrics upload")
    after
      50 -> :ok
    end
  end
end
