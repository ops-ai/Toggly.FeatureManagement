defmodule Toggly do
  @moduledoc "Supervised local feature evaluation with explicit per-call context."

  @type client :: atom()

  @doc """
  Starts a supervised client for one backend application and environment.

  Required `:name` identifies both the GenServer and its protected ETS table.
  Evaluation context belongs to each call, never to shared client state.
  `:snapshot_path` optionally persists signed bytes and public verification keys
  in a durable application-owned directory. `:jwks` overrides stored keys;
  `:allowed_kids` and `:max_signature_age_seconds` also apply during cold restore.
  """
  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(options), do: Toggly.Supervisor.start_link(options)

  @doc "Returns a supervisor child specification keyed by the configured client name."
  def child_spec(options),
    do: %{
      id: Keyword.fetch!(options, :name),
      start: {__MODULE__, :start_link, [options]},
      type: :supervisor
    }

  @doc "Stops the returned supervisor, including its client, socket and ETS table."
  def stop(supervisor), do: Supervisor.stop(supervisor)

  @doc "Evaluates one or more keys against one immutable snapshot and the caller's context."
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

  @doc "Fetches and verifies definitions; a failure preserves the active snapshot."
  def refresh(client), do: GenServer.call(client, :refresh, 30_000)

  @doc "Subscribes the calling process to update messages; process death removes it."
  def subscribe(client), do: GenServer.call(client, {:subscribe, self()})

  @doc "Removes the calling process from update notifications."
  def unsubscribe(client), do: GenServer.call(client, {:unsubscribe, self()})

  @doc "Uploads queued usage counters; failed uploads retain the batch for retry."
  def flush(client), do: GenServer.call(client, :flush, 30_000)

  @doc "Records feature use after application work runs, separately from a check."
  def record_usage(client, key, enabled \\ true),
    do: GenServer.cast(client, {:usage, key, enabled, :used})

  @doc "Records a feature view in the current in-memory usage batch."
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

  @doc "Returns evaluated booleans and snapshot metadata without exposing definitions or keys."
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
