defmodule Toggly do
  @moduledoc "Supervised local feature evaluation with per-call context and optional client identity."

  @type client :: atom()
  @version Mix.Project.config()[:version]

  @doc false
  def version, do: @version

  @doc """
  Starts a supervised client for one backend application and environment.

  Required `:name` identifies both the GenServer and its protected ETS table.
  Optional `:identity` sets a default targeting userId for `get_variant/4` when
  the per-call context has none (mutable via `set_identity/2`). Groups and
  claims remain per-call / Plug ambient — never stored on the client.
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

  @doc """
  Sets the client's default targeting userId for variant assignment when the
  per-call context has no `"identity"`. Pass `nil` or `""` to clear.
  """
  @spec set_identity(client(), String.t() | nil) :: :ok
  def set_identity(client, identity), do: GenServer.call(client, {:set_identity, identity})

  @doc "Returns the client's current default targeting userId, or `nil`."
  @spec identity(client()) :: String.t() | nil
  def identity(client), do: GenServer.call(client, :identity)

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
            do: GenServer.cast(client, {:usage, key, enabled, :check, nil})

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

  @doc """
  Assigns a feature variant locally from the definitions catalog (MF-parity).

  Matches `Microsoft.FeatureManagement` (`IVariantFeatureManager`)
  bit-for-bit for the same definition, enabled state, and targeting
  context. Assigns from the same cached snapshot `enabled?/4` reads — no
  network call and no dependency on `evaluated-variants-signed`.

  When `context` has no `"identity"` (missing, `nil`, or `""`), the client's
  `:identity` / `set_identity/2` default is merged in. Groups are never taken
  from the client. Prefer `get_variant(client, key)` after setting identity, or
  `Toggly.Phoenix.Plug.get_variant/2` for Plug ambient context.

  Options: `:ignore_case` (default `false`, mirrors
  `TargetingEvaluationOptions.IgnoreCase`) and `:track` (default `true`).
  """
  @spec get_variant(client(), String.t(), Toggly.Context.t(), keyword()) ::
          Toggly.Variant.Assignment.t()
  def get_variant(client, key, context \\ %{}, options \\ []) do
    :telemetry.span([:toggly, :variant], %{client: client, feature: key}, fn ->
      data = data(client)
      context = merge_client_identity(client, context)

      assignment =
        case Map.fetch(data.definitions, key) do
          {:ok, definition} ->
            Toggly.Variant.assign(definition, context, options)

          :error ->
            %Toggly.Variant.Assignment{
              enabled: Map.get(data.defaults, key, false) == true,
              assignment_reason: "None"
            }
        end

      if Keyword.get(options, :track, true),
        do:
          GenServer.cast(
            client,
            {:usage, key, assignment.enabled, :check, assignment.variant_name}
          )

      {assignment, %{variant: assignment.variant_name, enabled: assignment.enabled}}
    end)
  end

  @doc """
  Convenience for `get_variant/4`: the assigned variant's configuration payload,
  or `nil`.

  Pass `as: Module` (with `new/1`) or `as: &decoder/1` in `options` to soft-decode
  the payload. Decode failures and missing assignments return `nil`.
  """
  @spec get_variant_value(client(), String.t(), Toggly.Context.t(), keyword()) :: term()
  def get_variant_value(client, key, context \\ %{}, options \\ []) do
    value = get_variant(client, key, context, options).configuration_value
    decode_variant_value(value, Keyword.get(options, :as))
  end

  defp decode_variant_value(value, nil), do: value
  defp decode_variant_value(nil, _as), do: nil

  defp decode_variant_value(value, as) when is_function(as, 1) do
    try do
      as.(value)
    rescue
      _ -> nil
    end
  end

  defp decode_variant_value(value, as) when is_atom(as) do
    cond do
      function_exported?(as, :new, 1) and is_map(value) ->
        try do
          as.new(value)
        rescue
          _ -> nil
        end

      function_exported?(as, :__struct__, 0) and is_map(value) ->
        try do
          attrs =
            as.__struct__()
            |> Map.from_struct()
            |> Map.keys()
            |> Enum.reduce(%{}, fn key, acc ->
              str = Atom.to_string(key)

              cond do
                is_map_key(value, key) -> Map.put(acc, key, Map.get(value, key))
                is_map_key(value, str) -> Map.put(acc, key, Map.get(value, str))
                true -> acc
              end
            end)

          struct!(as, attrs)
        rescue
          _ -> nil
        end

      true ->
        nil
    end
  end

  defp decode_variant_value(_value, _as), do: nil

  @doc "Fetches and verifies definitions; a failure preserves the active snapshot."
  def refresh(client), do: GenServer.call(client, :refresh, 30_000)

  @doc "Subscribes the calling process to update messages; process death removes it."
  def subscribe(client), do: GenServer.call(client, {:subscribe, self()})

  @doc "Removes the calling process from update notifications."
  def unsubscribe(client), do: GenServer.call(client, {:unsubscribe, self()})

  @doc "Uploads queued usage counters; failed uploads retain the batch for retry."
  def flush(client), do: GenServer.call(client, :flush, 30_000)

  @doc """
  Records feature use after application work runs, separately from a check.

  Pass the assigned variant name (e.g. `assignment.variant_name` from
  `get_variant/4`) to attribute usage to that variant instead of the
  `enabled`/`disabled` label.
  """
  def record_usage(client, key, enabled \\ true, variant \\ nil),
    do: GenServer.cast(client, {:usage, key, enabled, :used, variant})

  @doc "Records a feature view in the current in-memory usage batch."
  def record_view(client, key, enabled \\ true, variant \\ nil),
    do: GenServer.cast(client, {:usage, key, enabled, :viewed, variant})

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

  defp merge_client_identity(client, nil), do: merge_client_identity(client, %{})

  defp merge_client_identity(client, context) when is_map(context) do
    case Map.get(context, "identity") do
      id when is_binary(id) and id != "" ->
        context

      _ ->
        case :ets.lookup(client, :identity) do
          [{:identity, id}] when is_binary(id) and id != "" ->
            Map.put(context, "identity", id)

          _ ->
            context
        end
    end
  end
end
