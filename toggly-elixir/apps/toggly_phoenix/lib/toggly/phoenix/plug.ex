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
      conn
      |> send_resp(Keyword.get(options, :status, 404), "Feature unavailable")
      |> halt()
    else
      conn
    end
  end

  @doc """
  Assigns a feature variant using `conn.assigns.toggly_context` (and
  `toggly_client`) set by this Plug — no manual context map required.

  Empty context identity still falls back to the client's `set_identity/2`
  default via `Toggly.get_variant/4`.

  Raises `ArgumentError` if this Plug has not run on `conn` (missing
  `:toggly_client` assign).
  """
  @spec get_variant(Plug.Conn.t(), String.t(), keyword()) :: Toggly.Variant.Assignment.t()
  def get_variant(conn, key, options \\ []) do
    client = require_toggly_client!(conn)
    context = Map.get(conn.assigns, :toggly_context, %{})
    Toggly.get_variant(client, key, context, options)
  end

  @doc "Convenience for `get_variant/3`: the assigned configuration payload, or `nil`.

  Pass `as:` in `options` for soft-typed decode (see `Toggly.get_variant_value/4`).
  "
  @spec get_variant_value(Plug.Conn.t(), String.t(), keyword()) :: term()
  def get_variant_value(conn, key, options \\ []) do
    client = require_toggly_client!(conn)
    context = Map.get(conn.assigns, :toggly_context, %{})
    Toggly.get_variant_value(client, key, context, options)
  end

  defp require_toggly_client!(conn) do
    case Map.fetch(conn.assigns, :toggly_client) do
      {:ok, client} ->
        client

      :error ->
        raise ArgumentError,
              "Toggly.Phoenix.Plug.get_variant/2 requires Toggly.Phoenix.Plug in the pipeline " <>
                "(conn.assigns[:toggly_client] is missing)"
    end
  end
end
