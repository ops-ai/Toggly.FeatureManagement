defmodule Toggly.LiveViewTest do
  use ExUnit.Case
  use Phoenix.Component
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

  test "assigns flags using socket-local context and ordinary feature content" do
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

  test "feature exposes ordinary content without a disabled-content slot" do
    slots = Toggly.LiveView.__components__().feature.slots
    assert Enum.map(slots, & &1.name) == [:inner_block]
  end

  test "paired HEEx blocks render exactly one branch for all, any and defaults" do
    for {feature, requirement, default, expected} <- [
          {"on", :all, false, "enabled"},
          {"off", :all, false, "disabled"},
          {["on", "off"], :all, false, "disabled"},
          {["on", "off"], :any, false, "enabled"},
          {["off", "missing"], :any, false, "disabled"},
          {"missing", :all, true, "enabled"},
          {"off", :all, true, "disabled"},
          {[], :all, true, "disabled"},
          {[], :any, true, "disabled"}
        ] do
      html =
        render_component(&paired_features/1, %{
          flags: %{"on" => true, "off" => false},
          feature: feature,
          requirement: requirement,
          default: default
        })

      other = if expected == "enabled", do: "disabled", else: "enabled"
      assert html =~ ~s(id="#{expected}")
      refute html =~ ~s(id="#{other}")
    end
  end

  defp paired_features(assigns) do
    ~H"""
    <Toggly.LiveView.feature
      flags={@flags}
      feature={@feature}
      requirement={@requirement}
      default={@default}
    >
      <p id="enabled">Enabled</p>
    </Toggly.LiveView.feature>
    <Toggly.LiveView.feature
      flags={@flags}
      feature={@feature}
      requirement={@requirement}
      default={@default}
      negate={true}
    >
      <p id="disabled">Disabled</p>
    </Toggly.LiveView.feature>
    """
  end
end

defmodule Toggly.TestLiveEndpoint do
  use Phoenix.Endpoint, otp_app: :toggly_live_view
  socket("/live", Phoenix.LiveView.Socket)
end

defmodule Toggly.TestLive do
  use Phoenix.LiveView
  on_mount({Toggly.LiveView, {LiveHostFlags, ["audience", "always", "never"]}})

  def render(assigns) do
    ~H"""
    <div id="identity">{@toggly_context["identity"]}</div>
    <div id="result">{to_string(@toggly_flags["audience"])}</div>
    <div :for={{id, keys, requirement} <- [
      {"single", "audience", :all},
      {"all", ["audience", "always"], :all},
      {"any", ["audience", "never"], :any}
    ]}>
      <Toggly.LiveView.feature flags={@toggly_flags} feature={keys} requirement={requirement}>
        <p id={id <> "-enabled"}>Enabled</p>
      </Toggly.LiveView.feature>
      <Toggly.LiveView.feature
        flags={@toggly_flags}
        feature={keys}
        requirement={requirement}
        negate={true}
      >
        <p id={id <> "-disabled"}>Disabled</p>
      </Toggly.LiveView.feature>
    </div>
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
         defaults: %{"always" => true, "never" => false},
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
    assert_paired_branches(alice, "enabled")
    assert_paired_branches(bob, "disabled")

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
    assert_paired_branches(alice, "disabled")
    assert_paired_branches(bob, "enabled")
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
    assert_paired_branches(view, "enabled")
    assert map_size(:sys.get_state(LiveHostFlags).subscribers) == 1
  end

  defp assert_paired_branches(view, expected) do
    other = if expected == "enabled", do: "disabled", else: "enabled"

    for gate <- ~w(single all any) do
      assert has_element?(view, "##{gate}-#{expected}")
      refute has_element?(view, "##{gate}-#{other}")
    end
  end
end
