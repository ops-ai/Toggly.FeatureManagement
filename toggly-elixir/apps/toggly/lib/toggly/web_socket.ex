defmodule Toggly.WebSocket do
  @moduledoc false
  use WebSockex

  def start_link(opts) do
    state = %{
      client: Keyword.fetch!(opts, :name),
      delay: Keyword.get(opts, :reconnect_interval, 5_000),
      base_delay: Keyword.get(opts, :reconnect_interval, 5_000)
    }

    WebSockex.start_link(url(opts), __MODULE__, state,
      async: true,
      handle_initial_conn_failure: true
    )
  end

  def child_spec(opts),
    do: %{id: __MODULE__, start: {__MODULE__, :start_link, [opts]}, shutdown: 5_000}

  def url(opts) do
    base =
      Keyword.get(opts, :base_url, "https://definitions.toggly.io")
      |> String.replace_prefix("https://", "wss://")
      |> String.replace_prefix("http://", "ws://")

    path =
      Toggly.Transport.segment(opts[:app_key]) <>
        "/" <>
        Toggly.Transport.segment(Keyword.get(opts, :environment, "Production")) <>
        "/ws?sdk=elixir&sdkVersion=0.1.0"

    Toggly.Transport.url(base, path)
  end

  @impl true
  def handle_connect(_, state) do
    # Connect/reconnect triggers a signed HTTP refresh. Socket frames never
    # directly activate definitions or public verification keys.
    send(state.client, :invalidate)
    {:ok, %{state | delay: state.base_delay}}
  end

  @impl true
  def handle_frame({:text, text}, state) do
    if invalidates?(text), do: send(state.client, :invalidate)
    {:ok, state}
  end

  def handle_frame(_, state), do: {:ok, state}

  @impl true
  def handle_disconnect(_, state) do
    # This delay belongs only to the socket process; evaluations remain ETS reads.
    Process.sleep(state.delay)
    {:reconnect, %{state | delay: min(state.delay * 2, 60_000)}}
  end

  def invalidates?(text) when text in ["update", "flags-updated"], do: true

  def invalidates?(text) do
    case Toggly.JSON.decode!(text) do
      %{"type" => "sync", "unchanged" => true} ->
        false

      %{"type" => type} when type in ["sync", "update", "flags-updated", "signing-key-updated"] ->
        true

      _ ->
        false
    end
  rescue
    _ -> false
  end
end
