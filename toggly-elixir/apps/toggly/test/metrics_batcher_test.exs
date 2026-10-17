defmodule Toggly.MetricsBatcherTest do
  use ExUnit.Case, async: true

  alias Toggly.MetricsBatcher

  test "measure, increment, observe, and build_and_reset with instanceName" do
    batch =
      MetricsBatcher.new()
      |> MetricsBatcher.measure("Latency", 12.5, %{feature: "f", variant: "a"})
      |> MetricsBatcher.increment_counter("Hits", 2, %{feature: "f"})
      |> MetricsBatcher.observe("CpuUsage", 3.0, %{})

    refute MetricsBatcher.empty?(batch)

    {packet, cleared} = MetricsBatcher.build_and_reset(batch, "app", "prod", "node-1")
    assert MetricsBatcher.empty?(cleared)
    assert packet["appKey"] == "app"
    assert packet["environment"] == "prod"
    assert packet["instanceName"] == "node-1"
    assert length(packet["stats"]) >= 1
    assert length(packet["counters"]) >= 1
    assert length(packet["observations"]) >= 1
  end

  test "restore rehydrates stats, counters, and observations" do
    packet = %{
      "stats" => [
        %{"metric" => "Latency", "feature" => "f", "variantValues" => %{"a" => 1.5}}
      ],
      "counters" => [
        %{"metric" => "Hits", "feature" => "f", "variantValues" => %{"enabled" => 3}}
      ],
      "observations" => [
        %{"metric" => "CpuUsage", "feature" => nil, "variantValues" => %{"enabled" => 9.0}}
      ]
    }

    batch = MetricsBatcher.restore(MetricsBatcher.new(), packet)
    {out, _} = MetricsBatcher.build_and_reset(batch, "app", "prod")
    assert Enum.any?(out["stats"], &(&1["metric"] == "Latency"))
    assert Enum.any?(out["counters"], &(&1["metric"] == "Hits"))
    assert Enum.any?(out["observations"], &(&1["metric"] == "CpuUsage"))
  end

  test "adding the same measure key accumulates variant values" do
    batch =
      MetricsBatcher.new()
      |> MetricsBatcher.measure("Latency", 1.0, %{feature: "f", variant: "a"})
      |> MetricsBatcher.measure("Latency", 2.0, %{feature: "f", variant: "a"})

    {packet, _} = MetricsBatcher.build_and_reset(batch, "app", "prod")
    row = Enum.find(packet["stats"], &(&1["metric"] == "Latency"))
    assert row["variantValues"]["a"] == 3.0
  end
end
