defmodule Toggly.SystemMetricsTest do
  use ExUnit.Case

  alias Toggly.SystemMetrics

  test "default_sample returns BEAM metrics with finite values" do
    {0, samples} = SystemMetrics.default_sample(0)
    metrics = Map.new(samples)

    assert Map.has_key?(metrics, "GCHeapSize")
    assert Map.has_key?(metrics, "ProcessCount")
    assert metrics["GCHeapSize"] > 0
    assert metrics["ProcessCount"] > 0
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
