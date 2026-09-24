defmodule Toggly.IdentityVariantTest do
  use ExUnit.Case

  defp checkout_body do
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
    ])
  end

  defp start_variant_client(name, opts \\ []) do
    transport = fn _req ->
      {:ok, %{status: 200, body: checkout_body(), headers: [{"etag", "v1"}]}}
    end

    start_supervised!(
      {Toggly,
       Keyword.merge(
         [
           name: name,
           app_key: "test",
           signed: false,
           transport: transport,
           refresh_interval: 0,
           websocket: false
         ],
         opts
       )}
    )

    assert :ok = Toggly.refresh(name)
    name
  end

  test "get_variant/2 uses config identity when context is empty" do
    client = start_variant_client(IdentityConfigFlags, identity: "alice")
    assignment = Toggly.get_variant(client, "checkout-flow")
    assert assignment.variant_name == "A"
    assert Toggly.identity(client) == "alice"
  end

  test "set_identity/2 overrides config and empty context uses it" do
    client = start_variant_client(IdentitySetFlags, identity: "carol")
    assert :ok = Toggly.set_identity(client, "alice")
    assert Toggly.identity(client) == "alice"
    assert Toggly.get_variant(client, "checkout-flow").variant_name == "A"
  end

  test "per-call identity overrides client identity" do
    client = start_variant_client(IdentityOverrideFlags, identity: "carol")

    assert Toggly.get_variant(client, "checkout-flow", %{"identity" => "alice"}).variant_name ==
             "A"

    assert Toggly.get_variant(client, "checkout-flow").variant_name == "B"
  end

  test "empty client identity falls back to defaultWhenEnabled" do
    client = start_variant_client(IdentityEmptyFlags)
    assert Toggly.get_variant(client, "checkout-flow").variant_name == "B"
  end

  test "get_variant_value/2 merges client identity" do
    client = start_variant_client(IdentityValueFlags, identity: "alice")

    assert Toggly.get_variant_value(client, "checkout-flow") == %{"color" => "blue"}
  end

  test "set_identity clears with nil or empty string" do
    client = start_variant_client(IdentityClearFlags, identity: "alice")
    assert :ok = Toggly.set_identity(client, nil)
    assert Toggly.identity(client) == nil
    assert Toggly.get_variant(client, "checkout-flow").variant_name == "B"

    assert :ok = Toggly.set_identity(client, "alice")
    assert :ok = Toggly.set_identity(client, "")
    assert Toggly.identity(client) == nil
  end

  test "get_variant/4 treats nil context like empty map" do
    client = start_variant_client(IdentityNilContextFlags, identity: "alice")
    assert Toggly.get_variant(client, "checkout-flow", nil).variant_name == "A"
  end

  test "set_identity ignores non-stringable values without crashing" do
    client = start_variant_client(IdentityBadTypeFlags, identity: "alice")
    assert :ok = Toggly.set_identity(client, %{not: "an-id"})
    assert Toggly.identity(client) == nil
    assert :ok = Toggly.set_identity(client, 42)
    assert Toggly.identity(client) == "42"
  end
end
