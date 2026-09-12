defmodule Toggly.LiveViewTest do
  use ExUnit.Case
  import Phoenix.LiveViewTest

  setup do
    start_supervised!(
      {Toggly,
       name: LiveFlags,
       defaults: %{"on" => true, "off" => false},
       refresh_interval: 0,
       websocket: false}
    )

    :ok
  end

  test "assigns flags using socket-local context and declarative fallback slots" do
    socket = %Phoenix.LiveView.Socket{
      assigns: %{__changed__: %{}, toggly_context: %{"identity" => "alice"}}
    }

    socket = Toggly.LiveView.assign_feature_flags(socket, LiveFlags, ["on", "off"])
    assert socket.assigns.toggly_flags == %{"on" => true, "off" => false}
    assert socket.assigns.toggly_context["identity"] == "alice"

    assert render_component(&Toggly.LiveView.feature/1, %{
             flags: socket.assigns.toggly_flags,
             feature: "on",
             inner_block: [%{__slot__: :inner_block, inner_block: fn _, _ -> "ON" end}]
           }) =~ "ON"
  end

  test "HEEx gates all, any, negate, default and fallback" do
    flags = %{"on" => true, "off" => false}

    for {options, expect} <- [
          {%{feature: ["on", "off"]}, "FALLBACK"},
          {%{feature: ["on", "off"], requirement: :any}, "ON"},
          {%{feature: "off", negate: true}, "ON"},
          {%{feature: "missing", default: true}, "ON"}
        ] do
      assigns =
        Map.merge(
          %{
            flags: flags,
            inner_block: [%{inner_block: fn _, _ -> "ON" end}],
            fallback: [%{inner_block: fn _, _ -> "FALLBACK" end}]
          },
          options
        )

      assert render_component(&Toggly.LiveView.feature/1, assigns) =~ expect
    end
  end
end

defmodule Toggly.TestLiveEndpoint do
  use Phoenix.Endpoint, otp_app: :toggly_live_view
  socket("/live", Phoenix.LiveView.Socket)
end

defmodule Toggly.TestLive do
  use Phoenix.LiveView
  on_mount({Toggly.LiveView, {LiveHostFlags, ["audience"]}})

  def render(assigns) do
    ~H"""
    <div id="identity">{@toggly_context["identity"]}</div>
    <div id="result">{to_string(@toggly_flags["audience"])}</div>
    <div id="custom">{Map.get(assigns,:custom,"none")}</div>
    """
  end

  def handle_info(:custom, socket), do: {:noreply, assign(socket, :custom, "received")}
end

defmodule Toggly.LiveHostTest do
  use ExUnit.Case
  import Phoenix.LiveViewTest
  @endpoint Toggly.TestLiveEndpoint
  setup do
    Application.put_env(:toggly_live_view, @endpoint,
      secret_key_base: String.duplicate("test-secret-", 8),
      live_view: [signing_salt: "test-signing-salt"],
      pubsub_server: Toggly.TestPubSub,
      server: false
    )

    start_supervised!({Phoenix.PubSub, name: Toggly.TestPubSub})
    start_supervised!(@endpoint)

    {:ok, definitions} =
      Agent.start_link(fn ->
        [
          %{
            "featureKey" => "audience",
            "filters" => [
              %{"name" => "Targeting", "parameters" => %{"Audience.Users:0" => "alice"}}
            ]
          }
        ]
      end)

    transport = fn _ ->
      {:ok, %{status: 200, body: Agent.get(definitions, &Jason.encode!/1), headers: []}}
    end

    supervisor =
      start_supervised!(
        {Toggly,
         name: LiveHostFlags,
         app_key: "test",
         signed: false,
         transport: transport,
         refresh_interval: 0,
         websocket: false}
      )

    Toggly.refresh(LiveHostFlags)
    %{definitions: definitions, supervisor: supervisor}
  end

  test "real connected LiveViews preserve separate identities across updates and clean subscriptions",
       %{definitions: definitions} do
    {:ok, alice, _} =
      live_isolated(Phoenix.ConnTest.build_conn(), Toggly.TestLive,
        session: %{"toggly_context" => %{"identity" => "alice"}}
      )

    {:ok, bob, _} =
      live_isolated(Phoenix.ConnTest.build_conn(), Toggly.TestLive,
        session: %{"toggly_context" => %{"identity" => "bob"}}
      )

    assert has_element?(alice, "#result", "true")
    assert has_element?(bob, "#result", "false")

    Agent.update(definitions, fn _ ->
      [
        %{
          "featureKey" => "audience",
          "filters" => [%{"name" => "Targeting", "parameters" => %{"Audience.Users:0" => "bob"}}]
        }
      ]
    end)

    Toggly.refresh(LiveHostFlags)
    assert has_element?(alice, "#result", "false")
    assert has_element?(bob, "#result", "true")
    assert has_element?(alice, "#identity", "alice")
    send(alice.pid, :custom)
    assert has_element?(alice, "#custom", "received")
    GenServer.stop(alice.pid)
    GenServer.stop(bob.pid)
    :sys.get_state(LiveHostFlags)
    assert :sys.get_state(LiveHostFlags).subscribers == %{}
  end

  test "LiveView re-subscribes after its client is temporarily unavailable", %{
    supervisor: supervisor
  } do
    {:ok, view, _} =
      live_isolated(Phoenix.ConnTest.build_conn(), Toggly.TestLive,
        session: %{"toggly_context" => %{"identity" => "alice"}}
      )

    :ok = Supervisor.terminate_child(supervisor, Toggly.Client)
    Process.sleep(150)
    {:ok, _} = Supervisor.restart_child(supervisor, Toggly.Client)
    Process.sleep(150)
    Toggly.refresh(LiveHostFlags)
    assert has_element?(view, "#result", "true")
    assert map_size(:sys.get_state(LiveHostFlags).subscribers) == 1
  end
end
