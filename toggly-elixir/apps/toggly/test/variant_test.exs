defmodule Toggly.VariantTest do
  use ExUnit.Case, async: true
  alias Toggly.Variant, as: V
  alias Toggly.Variant.Assignment

  defp def_(variants, allocation, extra \\ %{}) do
    Map.merge(
      %{
        "featureKey" => "test-feature",
        "filters" => [%{"name" => "AlwaysOn"}],
        "variants" => variants,
        "allocation" => allocation
      },
      extra
    )
  end

  defp variant(name, value, status_override \\ "None"),
    do: %{"name" => name, "configurationValue" => value, "statusOverride" => status_override}

  test "no variants defined at all: reason is None" do
    definition = def_([], nil)
    assignment = V.assign(definition, %{})

    assert %Assignment{
             variant_name: nil,
             configuration_value: nil,
             enabled: true,
             assignment_reason: "None"
           } = assignment
  end

  test "no allocation still reports default reason without a variant" do
    definition = def_([variant("A", %{"x" => 1})], nil)
    assignment = V.assign(definition, %{})

    assert assignment.variant_name == nil
    assert assignment.assignment_reason == "DefaultWhenEnabled"
    assert assignment.enabled
  end

  test "user allocation matches before default" do
    definition =
      def_(
        [variant("A", %{"color" => "blue"}), variant("B", %{"color" => "green"})],
        %{
          "defaultWhenEnabled" => "B",
          "user" => [%{"variant" => "A", "users" => ["alice", "bob"]}]
        }
      )

    assignment = V.assign(definition, %{"identity" => "alice"})
    assert assignment.variant_name == "A"
    assert assignment.configuration_value == %{"color" => "blue"}
    assert assignment.assignment_reason == "User"

    assignment = V.assign(definition, %{"identity" => "carol"})
    assert assignment.variant_name == "B"
    assert assignment.assignment_reason == "DefaultWhenEnabled"
  end

  test "group allocation matches before default" do
    definition =
      def_(
        [variant("A", %{"show" => false}), variant("B", %{"show" => true})],
        %{
          "defaultWhenEnabled" => "A",
          "group" => [%{"variant" => "B", "groups" => ["beta-testers"]}]
        }
      )

    assignment = V.assign(definition, %{"groups" => ["beta-testers"]})
    assert assignment.variant_name == "B"
    assert assignment.assignment_reason == "Group"
  end

  test "percentile to==100 edge always matches" do
    definition =
      def_(
        [variant("A", %{"tier" => "everyone"})],
        %{"percentile" => [%{"variant" => "A", "from" => 0, "to" => 100}]}
      )

    assignment = V.assign(definition, %{"identity" => "any-user"})
    assert assignment.variant_name == "A"
    assert assignment.assignment_reason == "Percentile"
  end

  test "case-insensitive user allocation opt-in" do
    definition =
      def_(
        [variant("A", %{"tag" => "targeted"}), variant("B", %{"tag" => "default"})],
        %{"defaultWhenEnabled" => "B", "user" => [%{"variant" => "A", "users" => ["User1"]}]}
      )

    assignment = V.assign(definition, %{"identity" => "user1"}, ignore_case: true)
    assert assignment.variant_name == "A"
    assert assignment.assignment_reason == "User"

    assignment = V.assign(definition, %{"identity" => "user1"}, ignore_case: false)
    assert assignment.variant_name == "B"
    assert assignment.assignment_reason == "DefaultWhenEnabled"
  end

  test "status override enabled flips a disabled feature" do
    definition =
      def_(
        [variant("Off", %{"killSwitch" => true}, "Enabled")],
        %{"defaultWhenDisabled" => "Off"},
        %{"filters" => []}
      )

    assignment = V.assign(definition, %{"identity" => "jack"})
    assert assignment.variant_name == "Off"
    assert assignment.assignment_reason == "DefaultWhenDisabled"
    assert assignment.enabled
  end

  test "status override disabled flips an enabled feature" do
    definition =
      def_(
        [variant("On", %{"killSwitch" => false}, "Disabled")],
        %{"defaultWhenEnabled" => "On"}
      )

    assignment = V.assign(definition, %{"identity" => "kim"})
    assert assignment.variant_name == "On"
    assert assignment.assignment_reason == "DefaultWhenEnabled"
    refute assignment.enabled
  end

  test "disabled feature skips user/group/percentile rules" do
    definition =
      def_(
        [variant("A", 1), variant("B", 2)],
        %{"defaultWhenDisabled" => "B", "user" => [%{"variant" => "A", "users" => ["gina"]}]},
        %{"filters" => []}
      )

    assignment = V.assign(definition, %{"identity" => "gina"})
    assert assignment.variant_name == "B"
    assert assignment.assignment_reason == "DefaultWhenDisabled"
  end
end
