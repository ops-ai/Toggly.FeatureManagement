defmodule Toggly.EvaluatorTest do
  use ExUnit.Case, async: true
  alias Toggly.Evaluator, as: E
  @fixtures Path.wildcard(Path.expand("../../../../docs/filter-parity/fixtures/*.json", __DIR__))
  for file <- @fixtures do
    fixture = Jason.decode!(File.read!(file))
    @fixture fixture
    test "canonical fixture #{fixture["id"]}" do
      context =
        Toggly.Context.from_headers(@fixture["httpHeaders"] || %{}, @fixture["context"] || %{})

      assert E.evaluate(@fixture, context) == @fixture["expected"]
    end
  end

  def filter(name, p \\ %{}), do: %{"name" => name, "parameters" => p}

  def definition(filters, extra \\ %{}),
    do: Map.merge(%{"featureKey" => "x", "filters" => filters}, extra)

  test "canonical SHA256 little-endian sticky percentage" do
    assert_in_delta E.percentile("alice", "filter-percentage"), 9.54170869885518, 0.0000001
  end

  test "empty, all, aliases and unknown filters" do
    refute E.evaluate(definition([]), %{})
    assert E.evaluate(definition([filter("Microsoft.AlwaysOn")]), %{})

    refute E.evaluate(
             definition([filter("AlwaysOn"), filter("Unknown")], %{"requirementType" => "All"}),
             %{}
           )

    assert E.evaluate(definition([filter("Unknown"), filter("AlwaysOn")]), %{})
  end

  test "entity gates are mandatory even when user filters match" do
    defn =
      definition(
        [
          filter("AlwaysOn"),
          filter("ContextProperty", %{"Property" => "Vip", "Operator" => "eq", "Value" => "true"})
        ],
        %{"contextKind" => "Order"}
      )

    refute E.evaluate(defn, %{})

    refute E.evaluate(defn, %{"entity" => %{"kind" => "Order", "attributes" => %{"Vip" => false}}})

    assert E.evaluate(defn, %{"entity" => %{"kind" => "Order", "attributes" => %{"Vip" => true}}})

    refute E.evaluate(defn, %{
             "entity" => %{"kind" => "Customer", "attributes" => %{"Vip" => true}}
           })
  end

  test "percentage bounds, identity required for partial rollout" do
    for {value, expected} <- [{0, false}, {100, true}, {-1, false}, {"100", true}, {"x", false}] do
      assert E.evaluate(definition([filter("Percentage", %{"Value" => value})]), %{}) == expected
    end

    refute E.evaluate(definition([filter("Percentage", %{"Value" => 50})]), %{})
  end

  test "named audience accepts a numeric identity and a nil group slot" do
    users =
      definition([
        filter("Targeting", %{
          "Audience.Users:0" => "42",
          "Audience.DefaultRolloutPercentage" => 0
        })
      ])

    assert E.evaluate(users, %{"identity" => 42})
    refute E.evaluate(users, %{"identity" => 7})

    groups =
      definition([
        filter("Targeting", %{
          "Audience.Groups:0" => "beta",
          "Audience.DefaultRolloutPercentage" => 0
        })
      ])

    assert E.evaluate(groups, %{"groups" => [nil, "beta"]})
    refute E.evaluate(groups, %{"groups" => [nil]})

    rollout =
      definition([
        filter("Targeting", %{
          "Audience.Groups:0" => "beta",
          "Audience.DefaultRolloutPercentage" => 100
        })
      ])

    assert E.evaluate(rollout, %{"groups" => [nil]})

    empty = definition([filter("Targeting", %{"Audience.DefaultRolloutPercentage" => 0})])
    refute E.evaluate(empty, %{"identity" => 42})
  end

  test "numeric country and browser language fail closed without throwing" do
    # Country is evaluated before AlwaysOn. A throw is rescued as false for the
    # whole flag; a fail-closed comparison lets AlwaysOn still enable it.
    country =
      definition([
        filter("Country", %{"Percentage" => 100, "Country:0" => "US"}),
        filter("AlwaysOn")
      ])

    assert E.evaluate(country, %{"identity" => "u", "request" => %{"country" => 42}})

    language =
      definition([
        filter("BrowserLanguage", %{"Percentage" => 100, "BrowserLanguage:0" => "en"}),
        filter("AlwaysOn")
      ])

    assert E.evaluate(language, %{"identity" => "u", "request" => %{"acceptLanguage" => 42}})
  end

  test "targeting exclusion wins and case behavior is explicit" do
    p = %{"Audience.Users:0" => "ALICE", "Audience.Exclusion.Groups:0" => "blocked"}
    d = definition([filter("Targeting", p)])
    assert E.evaluate(d, %{"identity" => "alice"})
    refute E.evaluate(d, %{"identity" => "alice", "groups" => ["BLOCKED"]})

    refute E.evaluate(definition([filter("Targeting", Map.put(p, "IgnoreCase", false))]), %{
             "identity" => "alice"
           })
  end

  test "time boundaries and invalid time fail closed" do
    now = "2026-09-12T00:00:00Z"

    assert E.evaluate(definition([filter("TimeWindow", %{"Start" => now, "End" => now})]), %{
             "now" => now
           })

    assert E.evaluate(definition([filter("TimeWindow")]), %{})

    for p <- [
          %{"Start" => "bad"},
          %{"Start" => "2099-01-01T00:00:00Z"},
          %{"End" => "2000-01-01T00:00:00Z"}
        ] do
      refute E.evaluate(definition([filter("TimeWindow", p)]), %{})
    end
  end
end
