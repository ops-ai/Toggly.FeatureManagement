defmodule Toggly.Phoenix.Plug do
  @moduledoc "Assigns request-local feature context and optionally gates a Plug route."
  @behaviour Plug
  import Plug.Conn
  @impl true
  def init(options) do
    Keyword.fetch!(options, :client)
    options
  end

  @impl true
  def call(conn, options) do
    client = Keyword.fetch!(options, :client)
    # The callback should derive authenticated identity from this connection.
    context =
      Keyword.get(options, :context, fn c -> Map.get(c.assigns, :toggly_context, %{}) end).(conn)

    context = Toggly.Context.from_headers(conn.req_headers, context)
    flags = Map.new(Keyword.get(options, :flags, []), &{&1, Toggly.enabled?(client, &1, context)})

    conn =
      conn
      |> assign(:toggly_client, client)
      |> assign(:toggly_context, context)
      |> assign(:toggly_flags, flags)

    if options[:gate] && not Toggly.enabled?(client, options[:gate], context, options) do
      conn |> send_resp(Keyword.get(options, :status, 404), "Feature unavailable") |> halt()
    else
      conn
    end
  end
end
