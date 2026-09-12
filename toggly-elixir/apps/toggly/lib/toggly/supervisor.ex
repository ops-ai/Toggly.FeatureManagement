defmodule Toggly.Supervisor do
  @moduledoc false
  use Supervisor

  def start_link(options), do: Supervisor.start_link(__MODULE__, options)

  @impl true
  def init(options) do
    name = Keyword.fetch!(options, :name)

    if not is_atom(name) or is_nil(name),
      do: raise(ArgumentError, "name must be an existing module/atom")

    children = [{Toggly.Client, options}]

    children =
      if options[:app_key] not in [nil, ""] and Keyword.get(options, :websocket, true),
        do: children ++ [{Toggly.WebSocket, options}],
        else: children

    # A restarted client owns a new ETS table. Restart its socket too, so
    # invalidation delivery always follows that client lifecycle.
    Supervisor.init(children, strategy: :rest_for_one)
  end
end
