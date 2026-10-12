defmodule Toggly.MetricsUploadTest do
  use ExUnit.Case

  test "metric/5 uploads measurement, counter, and observation kinds" do
    {sup, name} = start_client(MetricsKinds)

    assert :ok = Toggly.metric(name, :measurement, "latency", 12.5, %{feature: "Checkout"})
    assert :ok = Toggly.metric(name, :counter, "orders", 2, %{variant: "control"})
    assert :ok = Toggly.metric(name, :observation, "CpuUsage", 8.0)

    packets = flush_metrics_packets(name)
    assert length(packets) == 1
    packet = hd(packets)

    assert packet["appKey"] == "test"
    assert packet["environment"] == "Production"
    assert is_binary(packet["time"])

    assert Enum.any?(packet["stats"], fn row ->
             row["metric"] == "latency" and row["feature"] == "Checkout" and
               row["variantValues"]["enabled"] == 12.5
           end)

    assert Enum.any?(packet["counters"], fn row ->
             row["metric"] == "orders" and row["variantValues"]["control"] == 2
           end)

    assert Enum.any?(packet["observations"], fn row ->
             row["metric"] == "CpuUsage" and row["variantValues"]["enabled"] == 8.0 and
               is_binary(row["time"])
           end)

    Toggly.stop(sup)
  end

  test "failed metrics upload retains the batch for retry" do
    {sup, name, statuses} = start_client(MetricsRetry, return_status: true)

    assert :ok = Toggly.metric(name, :counter, "orders", 1)
    Agent.update(statuses, fn _ -> %{"api/metrics" => 500} end)
    assert {:error, :metrics_upload} = Toggly.flush(name)
    _ = drain_posts()

    Agent.update(statuses, fn _ -> %{"api/metrics" => 200} end)
    [packet] = flush_metrics_packets(name)
    assert Enum.any?(packet["counters"], &(&1["metric"] == "orders"))

    assert :ok = Toggly.flush(name)
    refute_metrics_posted()

    Toggly.stop(sup)
  end

  test "metrics: false keeps Telemetry and skips upload" do
    parent = self()

    handler_id = "metrics-false-#{System.unique_integer([:positive])}"

    :telemetry.attach(
      handler_id,
      [:toggly, :metric, :counter],
      fn event, measurements, metadata, _ ->
        send(parent, {:telemetry, event, measurements, metadata})
      end,
      nil
    )

    on_exit(fn -> :telemetry.detach(handler_id) end)

    {sup, name} = start_client(MetricsOff, metrics: false)
    assert :ok = Toggly.metric(name, :counter, "orders", 1, %{feature: "Checkout"})
    assert_receive {:telemetry, [:toggly, :metric, :counter], %{value: 1}, meta}
    assert meta.metric == "orders"

    assert :ok = Toggly.flush(name)
    refute_receive {:request, %{method: :post}}

    Toggly.stop(sup)
  end

  test "observation cap drops further samples until flush" do
    batch = Toggly.MetricsBatcher.new()

    batch =
      Enum.reduce(1..1001, batch, fn i, acc ->
        Toggly.MetricsBatcher.observe(acc, "m", i * 1.0)
      end)

    assert batch.dropped
    assert length(batch.observations) == 1000
  end

  test "failed usage upload does not discard metrics batch" do
    {sup, name, statuses} =
      start_client(MetricsIndependent, return_status: true, defaults: %{"live" => true})

    Toggly.record_usage(name, "live")
    assert :ok = Toggly.metric(name, :counter, "orders", 1)

    Agent.update(statuses, fn _ -> %{"api/usage/stats" => 500, "api/metrics" => 200} end)
    assert {:error, :usage_upload} = Toggly.flush(name)

    posts = drain_posts()
    assert Enum.any?(posts, fn {url, body} ->
             String.contains?(url, "api/metrics") and Jason.decode!(body)["counters"] != []
           end)

    Agent.update(statuses, fn _ -> %{"api/usage/stats" => 200, "api/metrics" => 200} end)
    assert :ok = Toggly.flush(name)

    posts = drain_posts()
    assert Enum.any?(posts, fn {url, _} -> String.contains?(url, "api/usage/stats") end)
    refute Enum.any?(posts, fn {url, _} -> String.contains?(url, "api/metrics") end)

    Toggly.stop(sup)
  end

  defp start_client(name, opts \\ []) do
    parent = self()
    {client_opts, opts} = Keyword.split(opts, [:return_status])
    statuses = Agent.start_link(fn -> %{} end) |> elem(1)

    on_exit(fn ->
      if Process.alive?(statuses), do: Agent.stop(statuses)
    end)

    transport = fn req ->
      send(parent, {:request, req})

      status =
        cond do
          req.method != :post -> 200
          String.contains?(req.url, "api/metrics") ->
            Agent.get(statuses, &Map.get(&1, "api/metrics", 200))

          String.contains?(req.url, "api/usage/stats") ->
            Agent.get(statuses, &Map.get(&1, "api/usage/stats", 200))

          true ->
            200
        end

      if req.method == :post do
        {:ok, %{status: status, body: "", headers: []}}
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
            websocket: false
          ],
          Keyword.drop(opts, [:return_status])
        )
      )

    if client_opts[:return_status], do: {sup, name, statuses}, else: {sup, name}
  end

  defp flush_metrics_packets(name) do
    assert :ok = Toggly.flush(name)
    flush_receive_metrics([])
  end

  defp flush_receive_metrics(acc) do
    receive do
      {:request, %{method: :post, url: url, body: body}} ->
        if String.contains?(url, "api/metrics") do
          flush_receive_metrics([Jason.decode!(body) | acc])
        else
          flush_receive_metrics(acc)
        end
    after
      50 -> Enum.reverse(acc)
    end
  end

  defp drain_posts(acc \\ []) do
    receive do
      {:request, %{method: :post, url: url, body: body}} ->
        drain_posts([{url, body} | acc])
    after
      50 -> Enum.reverse(acc)
    end
  end

  defp refute_metrics_posted do
    posts = drain_posts()
    refute Enum.any?(posts, fn {url, _} -> String.contains?(url, "api/metrics") end)
  end
end
