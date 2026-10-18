defmodule Toggly.MetricsBatcher do
  @moduledoc false

  @max_metric_keys 500
  @max_observations 1_000

  def new do
    %{measures: %{}, counters: %{}, observations: [], dropped: false}
  end

  def empty?(%{measures: m, counters: c, observations: o}),
    do: map_size(m) == 0 and map_size(c) == 0 and o == []

  def measure(batch, metric, value, opts \\ %{}) when is_binary(metric) and is_number(value),
    do: add_to_map(batch, :measures, metric, value, opts)

  def increment_counter(batch, metric, value \\ 1, opts \\ %{})
      when is_binary(metric) and is_number(value),
      do: add_to_map(batch, :counters, metric, value, opts)

  def observe(batch, metric, value, opts \\ %{}) when is_binary(metric) and is_number(value) do
    if length(batch.observations) >= @max_observations do
      %{batch | dropped: true}
    else
      obs = %{
        time: DateTime.utc_now(),
        metric: metric,
        feature: opts[:feature] || opts["feature"],
        variant: opts[:variant] || opts["variant"] || "enabled",
        value: value
      }

      %{batch | observations: [obs | batch.observations]}
    end
  end

  def build_and_reset(batch, app_key, environment, instance_name \\ nil) do
    if empty?(batch) do
      {nil, batch}
    else
      packet = %{
        "appKey" => app_key,
        "environment" => environment,
        "time" => DateTime.to_iso8601(DateTime.utc_now()),
        "stats" => drain_map(batch.measures),
        "counters" => drain_map(batch.counters),
        "observations" => drain_observations(Enum.reverse(batch.observations))
      }

      packet =
        if is_binary(instance_name) and instance_name != "",
          do: Map.put(packet, "instanceName", instance_name),
          else: packet

      {packet, new()}
    end
  end

  def restore(batch, packet) when is_map(packet) do
    batch =
      Enum.reduce(packet["stats"] || [], batch, fn row, acc ->
        restore_row(acc, :measures, row)
      end)

    batch =
      Enum.reduce(packet["counters"] || [], batch, fn row, acc ->
        restore_row(acc, :counters, row)
      end)

    Enum.reduce(packet["observations"] || [], batch, fn row, acc ->
      variants = row["variantValues"] || %{}

      Enum.reduce(variants, acc, fn {variant, value}, inner ->
        observe(inner, row["metric"], value, %{
          feature: row["feature"],
          variant: variant
        })
      end)
    end)
  end

  defp restore_row(batch, field, row) do
    variants = row["variantValues"] || %{}

    Enum.reduce(variants, batch, fn {variant, value}, acc ->
      add_to_map(acc, field, row["metric"], value, %{
        feature: row["feature"],
        variant: variant
      })
    end)
  end

  defp add_to_map(batch, field, metric, value, opts) do
    feature = opts[:feature] || opts["feature"]
    variant = opts[:variant] || opts["variant"] || "enabled"
    key = {metric, feature}
    store = Map.fetch!(batch, field)

    case Map.fetch(store, key) do
      {:ok, variants} ->
        variants = Map.update(variants, variant, value, &(&1 + value))
        Map.put(batch, field, Map.put(store, key, variants))

      :error ->
        if map_size(store) >= @max_metric_keys do
          %{batch | dropped: true}
        else
          Map.put(batch, field, Map.put(store, key, %{variant => value}))
        end
    end
  end

  defp drain_map(store) do
    Enum.flat_map(store, fn {{metric, feature}, variants} ->
      variant_values =
        variants
        |> Enum.reject(fn {_, v} -> v == 0 end)
        |> Map.new()

      if map_size(variant_values) == 0 do
        []
      else
        row = %{"metric" => metric, "variantValues" => variant_values}
        [if(feature, do: Map.put(row, "feature", feature), else: row)]
      end
    end)
  end

  defp drain_observations(observations) do
    observations
    |> Enum.reduce(%{}, fn obs, acc ->
      group_key = {DateTime.to_iso8601(obs.time), obs.metric, obs.feature}
      variants = Map.get(acc, group_key, %{}) |> Map.put(obs.variant, obs.value)
      Map.put(acc, group_key, variants)
    end)
    |> Enum.map(fn {{time, metric, feature}, variant_values} ->
      row = %{
        "time" => time,
        "metric" => metric,
        "variantValues" => variant_values
      }

      if feature, do: Map.put(row, "feature", feature), else: row
    end)
  end
end
