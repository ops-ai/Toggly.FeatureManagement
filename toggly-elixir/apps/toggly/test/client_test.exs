defmodule Toggly.ClientTest do
  use ExUnit.Case

  test "local ETS evaluation defaults, gates, per-call context, subscriptions and lifecycle" do
    {:ok, sup} =
      Toggly.start_link(
        name: TestFlags,
        defaults: %{"on" => true, "off" => false},
        refresh_interval: 0,
        websocket: false
      )

    assert Toggly.enabled?(TestFlags, "on")
    refute Toggly.enabled?(TestFlags, ["on", "off"])
    assert Toggly.enabled?(TestFlags, ["on", "off"], %{}, requirement: :any)
    assert Toggly.enabled?(TestFlags, "off", %{}, negate: true)
    assert Toggly.enabled?(TestFlags, "missing", %{}, default: true)
    refute Toggly.enabled?(TestFlags, [])
    assert :ok = Toggly.subscribe(TestFlags)
    assert :ok = Toggly.unsubscribe(TestFlags)
    assert %{source: :defaults} = Toggly.snapshot(TestFlags)
    assert :ok = Toggly.stop(sup)
    assert :ets.whereis(TestFlags) == :undefined
  end

  test "network refresh, ETag, failure retaining last known good and restart from file" do
    path = Path.join(System.tmp_dir!(), "toggly-test-#{System.unique_integer([:positive])}.json")
    on_exit(fn -> File.rm(path) end)
    parent = self()

    {:ok, replies} =
      Agent.start_link(fn ->
        [
          {200,
           Jason.encode!([%{"featureKey" => "live", "filters" => [%{"name" => "AlwaysOn"}]}]),
           [{"etag", "v1"}]},
          {304, "", []},
          {500, "", []}
        ]
      end)

    transport = fn req ->
      send(parent, {:request, req})

      {status, body, headers} =
        Agent.get_and_update(replies, fn [reply | rest] -> {reply, rest} end)

      {:ok, %{status: status, body: body, headers: headers}}
    end

    {:ok, sup} =
      Toggly.start_link(
        name: RemoteFlags,
        app_key: "test",
        signed: false,
        transport: transport,
        snapshot_path: path,
        refresh_interval: 0,
        websocket: false
      )

    assert :ok = Toggly.subscribe(RemoteFlags)
    assert :ok = Toggly.refresh(RemoteFlags)
    assert_receive {:request, %{url: "https://definitions.toggly.io/definitions/test/Production"}}
    assert Toggly.enabled?(RemoteFlags, "live")
    assert_receive {:toggly_updated, RemoteFlags, "v1"}
    assert :ok = Toggly.refresh(RemoteFlags)
    assert_receive {:request, %{headers: headers}}
    assert {"if-none-match", "v1"} in headers
    assert {:error, {:http, 500}} = Toggly.refresh(RemoteFlags)
    assert Toggly.enabled?(RemoteFlags, "live")
    Toggly.stop(sup)

    {:ok, sup2} =
      Toggly.start_link(
        name: RemoteFlags,
        app_key: "test",
        signed: false,
        snapshot_path: path,
        refresh_interval: 0,
        websocket: false
      )

    assert Toggly.enabled?(RemoteFlags, "live")
    Toggly.stop(sup2)
  end

  test "get_variant/4 and get_variant_value/4 assign locally from the catalog" do
    parent = self()

    transport = fn req ->
      send(parent, {:request, req})

      {:ok,
       %{
         status: 200,
         body:
           Jason.encode!([
             %{
               "featureKey" => "checkout-flow",
               "filters" => [%{"name" => "AlwaysOn"}],
               "variants" => [
                 %{"name" => "A", "configurationValue" => %{"color" => "blue"}},
                 %{"name" => "B", "configurationValue" => %{"color" => "green"}}
               ],
               "allocation" => %{
                 "defaultWhenEnabled" => "B",
                 "user" => [%{"variant" => "A", "users" => ["alice"]}]
               }
             }
           ]),
         headers: [{"etag", "v1"}]
       }}
    end

    {:ok, sup} =
      Toggly.start_link(
        name: VariantFlags,
        app_key: "test",
        signed: false,
        transport: transport,
        refresh_interval: 0,
        websocket: false
      )

    assert :ok = Toggly.refresh(VariantFlags)

    assignment = Toggly.get_variant(VariantFlags, "checkout-flow", %{"identity" => "alice"})
    assert assignment.variant_name == "A"
    assert assignment.configuration_value == %{"color" => "blue"}
    assert assignment.enabled
    assert assignment.assignment_reason == "User"

    assert Toggly.get_variant_value(VariantFlags, "checkout-flow", %{"identity" => "carol"}) ==
             %{"color" => "green"}

    assert %Toggly.Variant.Assignment{variant_name: nil, enabled: false} =
             Toggly.get_variant(VariantFlags, "missing-feature")

    Toggly.stop(sup)
  end

  test "get_variant uses client identity when context identity is blank" do
    transport = fn _req ->
      {:ok,
       %{
         status: 200,
         body:
           Jason.encode!([
             %{
               "featureKey" => "checkout-flow",
               "filters" => [%{"name" => "AlwaysOn"}],
               "variants" => [
                 %{"name" => "A", "configurationValue" => %{"color" => "blue"}},
                 %{"name" => "B", "configurationValue" => %{"color" => "green"}}
               ],
               "allocation" => %{
                 "defaultWhenEnabled" => "B",
                 "user" => [%{"variant" => "A", "users" => ["alice"]}]
               }
             }
           ]),
         headers: [{"etag", "v1"}]
       }}
    end

    {:ok, sup} =
      Toggly.start_link(
        name: IdentityVariantFlags,
        app_key: "test",
        signed: false,
        transport: transport,
        refresh_interval: 0,
        websocket: false,
        identity: "alice"
      )

    assert :ok = Toggly.refresh(IdentityVariantFlags)
    assert Toggly.identity(IdentityVariantFlags) == "alice"

    assignment = Toggly.get_variant(IdentityVariantFlags, "checkout-flow")
    assert assignment.variant_name == "A"
    assert assignment.assignment_reason == "User"

    assert :ok = Toggly.set_identity(IdentityVariantFlags, "carol")
    fallback = Toggly.get_variant(IdentityVariantFlags, "checkout-flow", %{})
    assert fallback.variant_name == "B"
    assert fallback.assignment_reason == "DefaultWhenEnabled"

    override =
      Toggly.get_variant(IdentityVariantFlags, "checkout-flow", %{"identity" => "alice"})

    assert override.variant_name == "A"

    Toggly.stop(sup)
  end

  test "refresh accepts definitions with null or missing filters" do
    {:ok, replies} =
      Agent.start_link(fn ->
        [
          {200, Jason.encode!([%{"featureKey" => "null-filters", "filters" => nil}]),
           [{"etag", "n1"}]},
          {200, Jason.encode!([%{"featureKey" => "missing-filters"}]), [{"etag", "n2"}]}
        ]
      end)

    transport = fn _req ->
      {status, body, headers} =
        Agent.get_and_update(replies, fn [reply | rest] -> {reply, rest} end)

      {:ok, %{status: status, body: body, headers: headers}}
    end

    {:ok, _sup} =
      Toggly.start_link(
        name: NullFiltersFlags,
        app_key: "test",
        signed: false,
        transport: transport,
        refresh_interval: 0,
        websocket: false
      )

    assert :ok = Toggly.refresh(NullFiltersFlags)
    refute Toggly.enabled?(NullFiltersFlags, "null-filters")
    assert :ok = Toggly.refresh(NullFiltersFlags)
    refute Toggly.enabled?(NullFiltersFlags, "missing-filters")
    Toggly.stop(NullFiltersFlags)
  end
end
