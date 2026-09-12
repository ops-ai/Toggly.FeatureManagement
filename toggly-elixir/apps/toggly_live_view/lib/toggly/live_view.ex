defmodule Toggly.LiveView do
  @moduledoc "Socket-local feature assigns, supervised-client subscriptions and HEEx gates."
  use Phoenix.Component
  import Phoenix.LiveView, only: [connected?: 1, attach_hook: 4]

  @doc "Assigns booleans for keys; context defaults to socket.assigns.toggly_context."
  def assign_feature_flags(socket, client, keys, options \\ []) do
    context = Keyword.get(options, :context, Map.get(socket.assigns, :toggly_context, %{}))
    flags = Map.new(keys, &{&1, Toggly.enabled?(client, &1, context)})

    assign(socket,
      toggly_client: client,
      toggly_context: context,
      toggly_keys: keys,
      toggly_flags: flags
    )
  end

  @doc "Use on_mount {Toggly.LiveView, {MyFlags, [\"feature\"]}}; context comes from trusted socket assigns or signed session."
  def on_mount({client, keys}, _params, session, socket) do
    context = Map.get(socket.assigns, :toggly_context, Map.get(session, "toggly_context", %{}))
    socket = assign_feature_flags(socket, client, keys, context: context)

    socket =
      if connected?(socket) do
        socket
        |> subscribe(client)
        |> attach_hook(:toggly_updates, :handle_info, &handle_update/2)
      else
        socket
      end

    {:cont, socket}
  end

  defp subscribe(socket, client) do
    case Process.whereis(client) do
      nil ->
        Process.send_after(self(), {:toggly_reconnect, client}, 100)
        socket

      pid ->
        Toggly.subscribe(client)
        assign(socket, :toggly_monitor, Process.monitor(pid))
    end
  end

  defp handle_update({:toggly_updated, client, _}, %{assigns: %{toggly_client: client}} = socket) do
    {:halt, assign_feature_flags(socket, client, socket.assigns.toggly_keys)}
  end

  defp handle_update(
         {:DOWN, ref, :process, _, _},
         %{assigns: %{toggly_monitor: ref, toggly_client: client}} = socket
       ) do
    Process.send_after(self(), {:toggly_reconnect, client}, 100)
    {:halt, socket}
  end

  defp handle_update({:toggly_reconnect, client}, %{assigns: %{toggly_client: client}} = socket) do
    socket = subscribe(socket, client)

    socket =
      if Process.whereis(client),
        do: assign_feature_flags(socket, client, socket.assigns.toggly_keys),
        else: socket

    {:halt, socket}
  end

  defp handle_update(_, socket), do: {:cont, socket}

  attr(:flags, :map, required: true)
  attr(:feature, :any, required: true)
  attr(:requirement, :atom, values: [:all, :any], default: :all)
  attr(:negate, :boolean, default: false)
  attr(:default, :boolean, default: false)
  slot(:inner_block, required: true)
  slot(:fallback)
  @doc "Renders the inner block or fallback from already evaluated socket-local boolean flags."
  def feature(assigns) do
    checks =
      for key <- List.wrap(assigns.feature),
          do: Map.get(assigns.flags, key, assigns.default) == true

    enabled =
      checks != [] and
        if assigns.requirement == :any, do: Enum.any?(checks), else: Enum.all?(checks)

    assigns = assign(assigns, :enabled, if(assigns.negate, do: not enabled, else: enabled))

    ~H"""
    <%= if @enabled do %>
      {render_slot(@inner_block)}
    <% else %>
      {render_slot(@fallback)}
    <% end %>
    """
  end
end
