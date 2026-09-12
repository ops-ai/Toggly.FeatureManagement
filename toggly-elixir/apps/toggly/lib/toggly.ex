defmodule Toggly do
  @moduledoc "Supervised local feature evaluation with explicit per-call context."
  @type client :: atom()
  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(options), do: Toggly.Supervisor.start_link(options)

  def child_spec(options),
    do: %{
      id: Keyword.fetch!(options, :name),
      start: {__MODULE__, :start_link, [options]},
      type: :supervisor
    }

  def stop(supervisor), do: Supervisor.stop(supervisor)
  @spec enabled?(client(), String.t() | [String.t()], Toggly.Context.t(), keyword()) :: boolean()
  def enabled?(client, keys, context \\ %{}, options \\ []) do
    :telemetry.span([:toggly, :evaluation], %{client: client, features: List.wrap(keys)}, fn ->
      data = data(client)

      checks =
        for key <- List.wrap(keys) do
          enabled =
            case Map.fetch(data.definitions, key) do
              {:ok, definition} -> Toggly.Evaluator.evaluate(definition, context)
              :error -> Map.get(data.defaults, key, Keyword.get(options, :default, false)) == true
            end

          if Keyword.get(options, :track, true),
            do: GenServer.cast(client, {:usage, key, enabled, :check})

          enabled
        end

      result =
        checks != [] and
          if Keyword.get(options, :requirement, :all) == :any,
            do: Enum.any?(checks),
            else: Enum.all?(checks)

      result = if Keyword.get(options, :negate, false), do: not result, else: result
      {result, %{enabled: result}}
    end)
  end

  def refresh(client), do: GenServer.call(client, :refresh, 30_000)
  def subscribe(client), do: GenServer.call(client, {:subscribe, self()})
  def unsubscribe(client), do: GenServer.call(client, {:unsubscribe, self()})
  def flush(client), do: GenServer.call(client, :flush, 30_000)

  def record_usage(client, key, enabled \\ true),
    do: GenServer.cast(client, {:usage, key, enabled, :used})

  def record_view(client, key, enabled \\ true),
    do: GenServer.cast(client, {:usage, key, enabled, :viewed})

  @doc "Emits a custom metric; attach an exporter to [:toggly, :metric, kind]. No implicit gRPC upload."
  def metric(client, kind, key, value, metadata \\ %{})
      when kind in [:counter, :measurement, :observation] and is_number(value) do
    :telemetry.execute(
      [:toggly, :metric, kind],
      %{value: value},
      Map.merge(metadata, %{client: client, metric: key})
    )
  end

  def snapshot(client, context \\ %{}) do
    data = data(client)
    keys = (Map.keys(data.defaults) ++ Map.keys(data.definitions)) |> Enum.uniq() |> Enum.sort()

    %{
      source: data.source,
      revision: data.revision,
      timestamp: data.timestamp,
      flags: Map.new(keys, &{&1, evaluate_snapshot(data, &1, context)})
    }
  end

  defp evaluate_snapshot(data, key, context) do
    case Map.fetch(data.definitions, key) do
      {:ok, definition} -> Toggly.Evaluator.evaluate(definition, context)
      :error -> Map.get(data.defaults, key, false) == true
    end
  end

  @doc false
  def data(client) do
    [{:snapshot, data}] = :ets.lookup(client, :snapshot)
    data
  end
end
