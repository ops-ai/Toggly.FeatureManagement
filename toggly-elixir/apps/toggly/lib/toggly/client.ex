defmodule Toggly.Client do
  @moduledoc false
  use GenServer
  alias Toggly.{JSON, Signature, Snapshot, Transport}

  def start_link(opts),
    do: GenServer.start_link(__MODULE__, opts, name: Keyword.fetch!(opts, :name))

  @impl true
  def init(opts) do
    name = Keyword.fetch!(opts, :name)
    :ets.new(name, [:named_table, :protected, read_concurrency: true])

    state = %{
      name: name,
      opts: opts,
      subscribers: %{},
      usage: %{},
      revision: nil,
      timestamp: 0,
      invalidation_pending: false,
      definitions: %{},
      defaults: Keyword.get(opts, :defaults, %{}),
      source: :defaults,
      jwks: Keyword.get(opts, :jwks)
    }

    state =
      case Snapshot.read(opts[:snapshot_path]) do
        {:ok, body} ->
          case activate(body, state, nil, :snapshot) do
            {:ok, loaded} -> loaded
            _ -> state
          end

        _ ->
          state
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
  def handle_cast({:usage, key, enabled, kind}, state) do
    bucket = {key, if(enabled, do: "enabled", else: "disabled"), kind}
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
          {:ok, state}

        {:ok, %{status: 200, body: body, headers: headers}} ->
          keys = if signed and is_nil(opts[:jwks]), do: fetch_keys(state), else: {:ok, state.jwks}

          with {:ok, jwks} <- keys,
               {:ok, updated} <-
                 activate(body, %{state | jwks: jwks}, header(headers, "etag"), :remote) do
            publish(updated)
            Snapshot.write(opts[:snapshot_path], body)

            Enum.each(updated.subscribers, fn {pid, _} ->
              send(pid, {:toggly_updated, state.name, updated.revision})
            end)

            {:ok, updated}
          else
            error -> {error, state}
          end

        {:ok, %{status: status}} ->
          {{:error, {:http, status}}, state}

        error ->
          {error, state}
      end
    end
  end

  defp activate(body, state, revision, source) do
    result =
      if Keyword.get(state.opts, :signed, true) do
        Signature.verify(body, state.jwks || %{"keys" => []},
          minimum_timestamp: state.timestamp,
          allowed_kids: Keyword.get(state.opts, :allowed_kids, [])
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
         mapped <- Map.new(definitions, &{&1["featureKey"], &1}),
         true <- map_size(mapped) == length(definitions) do
      {:ok,
       %{state | definitions: mapped, timestamp: timestamp, revision: revision, source: source}}
    else
      {:error, _} = error -> error
      _ -> {:error, :invalid_definitions}
    end
  end

  defp valid_definition?(%{"featureKey" => key, "filters" => filters})
       when is_binary(key) and key != "" and is_list(filters),
       do:
         Enum.all?(filters, fn f ->
           is_map(f) and is_binary(f["name"]) and is_map(Map.get(f, "parameters", %{}))
         end)

  defp valid_definition?(_), do: false

  defp publish(state),
    do:
      :ets.insert(
        state.name,
        {:snapshot, Map.take(state, [:definitions, :defaults, :source, :revision, :timestamp])}
      )

  defp fetch_keys(state) do
    case request(state, :get, ".well-known/jwks", []) do
      {:ok, %{status: 200, body: body}} ->
        try do
          {:ok, JSON.decode!(body)}
        rescue
          _ -> {:error, :invalid_jwks}
        end

      _ ->
        {:error, :jwks_unavailable}
    end
  end

  defp request(state, method, path, headers, body \\ nil) do
    base =
      if method == :post,
        do: Keyword.get(state.opts, :usage_base_url, "https://app.toggly.io"),
        else: Keyword.get(state.opts, :base_url, "https://definitions.toggly.io")

    req = %{
      method: method,
      url: Transport.url(base, path),
      headers: [{"user-agent", "toggly-elixir/0.1.0"} | headers],
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
    if map_size(state.usage) == 0 or state.opts[:app_key] in [nil, ""] or
         not Keyword.get(state.opts, :usage, true) do
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

      case request(
             state,
             :post,
             "api/usage/stats",
             [{"content-type", "application/json"}],
             IO.iodata_to_binary(:json.encode(packet))
           ) do
        {:ok, %{status: status}} when status in 200..299 -> {:ok, %{state | usage: %{}}}
        _ -> {{:error, :usage_upload}, state}
      end
    end
  end
end
