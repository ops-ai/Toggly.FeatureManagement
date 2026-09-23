defmodule Toggly.Client do
  @moduledoc false
  use GenServer

  alias Toggly.{JSON, Signature, Snapshot, Transport}

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.fetch!(opts, :name))
  end

  @impl true
  def init(opts) do
    Signature.validate_max_age!(Keyword.get(opts, :max_signature_age_seconds))
    name = Keyword.fetch!(opts, :name)
    :ets.new(name, [:named_table, :protected, read_concurrency: true])

    state = %{
      name: name,
      opts: opts,
      subscribers: %{},
      usage: %{},
      definition_cache_hits: 0,
      definition_cache_misses: 0,
      revision: nil,
      timestamp: 0,
      invalidation_pending: false,
      definitions: %{},
      defaults: Keyword.get(opts, :defaults, %{}),
      source: :defaults,
      jwks: Keyword.get(opts, :jwks)
    }

    # Restore and reverify before any refresh can reach the network. Identity,
    # groups and claims are evaluated per call and never persisted in this cache.
    state =
      with {:ok, stored} <- Snapshot.read(opts[:snapshot_path]),
           {:ok, body, jwks} <- Snapshot.decode(stored, opts),
           {:ok, loaded} <- activate(body, %{state | jwks: jwks}, nil, :snapshot) do
        record_cache_hit(loaded)
      else
        _ -> state
      end

    publish(state)
    interval = Keyword.get(opts, :refresh_interval, 60_000)
    if interval > 0, do: send(self(), :refresh)
    schedule(:flush, Keyword.get(opts, :flush_interval, 60_000))
    {:ok, state}
  end

  @impl true
  def handle_call(:refresh, _, state) do
    {result, state} = refresh(state)
    {:reply, result, state}
  end

  def handle_call(:flush, _, state) do
    {result, state} = flush(state)
    {:reply, result, state}
  end

  def handle_call({:subscribe, pid}, _, state) do
    state =
      if Map.has_key?(state.subscribers, pid),
        do: state,
        else: put_in(state.subscribers[pid], Process.monitor(pid))

    {:reply, :ok, state}
  end

  def handle_call({:unsubscribe, pid}, _, state) do
    {ref, subscribers} = Map.pop(state.subscribers, pid)
    if ref, do: Process.demonitor(ref, [:flush])
    {:reply, :ok, %{state | subscribers: subscribers}}
  end

  @impl true
  def handle_cast({:usage, key, enabled, kind, variant}, state) do
    label = variant || if(enabled, do: "enabled", else: "disabled")
    bucket = {key, label, kind}

    # Bound cardinality to configured features/defaults; never retain identity.
    usage =
      if Map.has_key?(state.definitions, key) or Map.has_key?(state.defaults, key),
        do: Map.update(state.usage, bucket, 1, &(&1 + 1)),
        else: state.usage

    {:noreply, %{state | usage: usage}}
  end

  @impl true
  def handle_info(:refresh, state) do
    {_, state} = refresh(state)
    schedule(:refresh, Keyword.get(state.opts, :refresh_interval, 60_000))
    {:noreply, state}
  end

  def handle_info(:invalidate, %{invalidation_pending: true} = state), do: {:noreply, state}

  def handle_info(:invalidate, state) do
    Process.send_after(self(), :apply_invalidation, Keyword.get(state.opts, :debounce, 300))
    {:noreply, %{state | invalidation_pending: true}}
  end

  def handle_info(:apply_invalidation, state) do
    {_, state} = refresh(%{state | invalidation_pending: false}, true)
    {:noreply, state}
  end

  def handle_info(:flush, state) do
    {_, state} = flush(state)
    schedule(:flush, Keyword.get(state.opts, :flush_interval, 60_000))
    {:noreply, state}
  end

  def handle_info({:DOWN, _, :process, pid, _}, state),
    do: {:noreply, %{state | subscribers: Map.delete(state.subscribers, pid)}}

  defp schedule(event, interval) when interval > 0,
    do: Process.send_after(self(), event, interval)

  defp schedule(_, _), do: :ok

  defp refresh(%{opts: opts} = state, force \\ false) do
    if opts[:app_key] in [nil, ""] do
      {{:error, :missing_app_key}, state}
    else
      signed = Keyword.get(opts, :signed, true)
      prefix = if signed, do: "definitions-signed/", else: "definitions/"

      path =
        prefix <>
          Transport.segment(opts[:app_key]) <>
          "/" <> Transport.segment(Keyword.get(opts, :environment, "Production"))

      headers = if state.revision && not force, do: [{"if-none-match", state.revision}], else: []
      result = request(state, :get, path, headers)

      case result do
        {:ok, %{status: 304}} ->
          {:ok, record_cache_hit(state)}

        {:ok, %{status: 200, body: body, headers: headers}} ->
          etag = header(headers, "etag")
          keys = if signed and is_nil(opts[:jwks]), do: fetch_keys(state), else: {:ok, state.jwks}

          with {:ok, jwks} <- keys,
               {:ok, updated} <- activate(body, %{state | jwks: jwks}, etag, :remote) do
            publish(updated)
            # Cache IO is best effort: verified live definitions remain active
            # even when this host cannot persist a file.
            Snapshot.write(opts[:snapshot_path], Snapshot.encode(body, updated.jwks, opts))

            Enum.each(updated.subscribers, fn {pid, _} ->
              send(pid, {:toggly_updated, state.name, updated.revision})
            end)

            {:ok, record_revision(updated, state.revision, etag)}
          else
            error -> {error, keep_cached(state)}
          end

        {:ok, %{status: status}} ->
          {{:error, {:http, status}}, keep_cached(state)}

        error ->
          {error, keep_cached(state)}
      end
    end
  end

  defp activate(body, state, revision, source) do
    result =
      if Keyword.get(state.opts, :signed, true) do
        Signature.verify(body, state.jwks || %{"keys" => []},
          minimum_timestamp: state.timestamp,
          allowed_kids: Keyword.get(state.opts, :allowed_kids, []),
          max_signature_age_seconds: Keyword.get(state.opts, :max_signature_age_seconds)
        )
      else
        try do
          {:ok, JSON.decode!(body), 0}
        rescue
          _ -> {:error, :invalid_json}
        end
      end

    with {:ok, definitions, timestamp} when is_list(definitions) <- result,
         true <- Enum.all?(definitions, &valid_definition?/1),
         mapped <- Map.new(definitions, &{&1["featureKey"], normalize_parameters(&1)}),
         true <- map_size(mapped) == length(definitions) do
      # Only public verification fields cross the persistence boundary.
      jwks =
        if Keyword.get(state.opts, :signed, true) do
          {:ok, public} = Signature.public_jwks(state.jwks)
          public
        end

      {:ok,
       %{
         state
         | definitions: mapped,
           timestamp: timestamp,
           revision: revision,
           source: source,
           jwks: jwks
       }}
    else
      {:error, _} = error -> error
      _ -> {:error, :invalid_definitions}
    end
  end

  defp valid_definition?(%{"featureKey" => key} = definition)
       when is_binary(key) and key != "" do
    filters = Map.get(definition, "filters") || []

    is_list(filters) and
      Enum.all?(filters, fn filter ->
        is_map(filter) and is_binary(filter["name"]) and
          (is_nil(filter["parameters"]) or is_map(filter["parameters"]))
      end)
  end

  defp valid_definition?(_), do: false

  defp normalize_parameters(definition) do
    # The service may serialize absent optional parameters as null. Normalize the
    # verified evaluation model only; persistence retains the original signed body.
    # Absent or null `filters` is treated as an empty list (same as the Rust SDK).
    filters = Map.get(definition, "filters") || []

    Map.put(
      definition,
      "filters",
      Enum.map(filters, fn filter ->
        Map.update(filter, "parameters", %{}, fn
          nil -> %{}
          parameters -> parameters
        end)
      end)
    )
  end

  defp publish(state) do
    # Readers receive an atomic view; subscribers and verification material stay
    # private to the owner process rather than entering the evaluation table.
    :ets.insert(
      state.name,
      {:snapshot, Map.take(state, [:definitions, :defaults, :source, :revision, :timestamp])}
    )
  end

  defp fetch_keys(state) do
    case request(state, :get, ".well-known/jwks", []) do
      {:ok, %{status: 200, body: body}} ->
        if Snapshot.trusted_origin?(state.opts) and is_binary(body) and byte_size(body) <= 131_072 do
          Signature.public_jwks(JSON.decode!(body))
        else
          {:error, :invalid_jwks}
        end

      _ ->
        {:error, :jwks_unavailable}
    end
  rescue
    _ -> {:error, :invalid_jwks}
  end

  defp request(state, method, path, headers, body \\ nil) do
    base =
      if method == :post,
        do: Keyword.get(state.opts, :usage_base_url, "https://metrics.toggly.io"),
        else: Keyword.get(state.opts, :base_url, "https://definitions.toggly.io")

    req = %{
      method: method,
      url: Transport.url(base, path),
      headers: [{"user-agent", "toggly-elixir/#{Toggly.version()}"} | headers],
      timeout: Keyword.get(state.opts, :timeout, 5_000)
    }

    req = if body, do: Map.put(req, :body, body), else: req
    Keyword.get(state.opts, :transport, &Transport.request/1).(req)
  rescue
    _ -> {:error, :transport}
  end

  defp header(headers, key),
    do: Enum.find_value(headers, fn {k, v} -> if String.downcase(k) == key, do: v end)

  defp flush(state) do
    hits = state.definition_cache_hits
    misses = state.definition_cache_misses

    if (map_size(state.usage) == 0 and hits == 0 and misses == 0) or
         state.opts[:app_key] in [nil, ""] or not Keyword.get(state.opts, :usage, true) do
      {:ok, %{state | usage: %{}}}
    else
      stats =
        state.usage
        |> Enum.group_by(fn {{key, _, _}, _} -> key end)
        |> Enum.map(fn {key, items} ->
          variants =
            Enum.reduce(items, %{}, fn {{_, variant, kind}, count}, acc ->
              field = %{check: "checkCount", used: "usedCount", viewed: "viewedCount"}[kind]
              Map.update(acc, variant, %{field => count}, &Map.put(&1, field, count))
            end)

          %{"feature" => key, "variantStats" => variants}
        end)

      packet = %{
        "appKey" => state.opts[:app_key],
        "environment" => Keyword.get(state.opts, :environment, "Production"),
        "time" => DateTime.to_iso8601(DateTime.utc_now()),
        "stats" => stats
      }

      packet = if hits > 0, do: Map.put(packet, "definitionCacheHits", hits), else: packet
      packet = if misses > 0, do: Map.put(packet, "definitionCacheMisses", misses), else: packet

      case request(
             state,
             :post,
             "api/usage/stats",
             [{"content-type", "application/json"}],
             IO.iodata_to_binary(:json.encode(packet))
           ) do
        {:ok, %{status: status}} when status in 200..299 ->
          {:ok, %{state | usage: %{}, definition_cache_hits: 0, definition_cache_misses: 0}}

        _ ->
          {{:error, :usage_upload}, state}
      end
    end
  end

  # GenServer handle_call serializes refresh; there is no in-flight skip to count.
  defp record_revision(state, previous, etag) when is_binary(etag) and etag == previous,
    do: record_cache_hit(state)

  defp record_revision(state, _, _), do: record_cache_miss(state)

  defp keep_cached(%{source: source} = state) when source in [:remote, :snapshot],
    do: record_cache_hit(state)

  defp keep_cached(state), do: state

  defp record_cache_hit(state),
    do: %{state | definition_cache_hits: state.definition_cache_hits + 1}

  defp record_cache_miss(state),
    do: %{state | definition_cache_misses: state.definition_cache_misses + 1}
end
