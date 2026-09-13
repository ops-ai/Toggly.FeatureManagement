defmodule Toggly.EdgeCasesTest do
  use ExUnit.Case
  def filter(name, p \\ %{}), do: %{"name" => name, "parameters" => p}

  def definition(filters, extra \\ %{}),
    do: Map.merge(%{"featureKey" => "x", "filters" => filters}, extra)

  alias Toggly.Evaluator, as: E

  test "entity operators, types, missing attributes and separate Any/All groups" do
    context = %{
      "entity" => %{
        "kind" => "Order",
        "attributes" => %{
          "Vip" => true,
          "Total" => 42,
          "Name" => "Example",
          "Tags" => ["one", "two"],
          "Date" => "2026-01-01T00:00:00Z"
        }
      }
    }

    for {property, op, expected, type, result} <- [
          {"Total", "gt", "40", "number", true},
          {"Total", "gte", "42", "number", true},
          {"Total", "lt", "50", "number", true},
          {"Total", "lte", "42", "number", true},
          {"Total", "gt", "bad", "number", false},
          {"Total", "gt", "0", "string", false},
          {"Name", "neq", "other", "string", true},
          {"Name", "in", " Other, Example ", "string", true},
          {"Name", "contains", "amp", "string", true},
          {"Tags", "contains", "TWO", "string[]", true},
          {"Name", "contains", "a", "string[]", false},
          {"Date", "gte", "2025-01-01T00:00:00Z", "datetime", true},
          {"Missing", "eq", "true", "string", false},
          {"Vip", "unknown", "true", "boolean", false},
          {"Vip", "eq", nil, "boolean", false}
        ] do
      d =
        definition([
          filter("ContextProperty", %{
            "Property" => property,
            "Operator" => op,
            "Value" => expected,
            "ValueType" => type
          })
        ])

      assert E.evaluate(d, context) == result, "#{property} #{op} #{expected}"
    end

    yes = filter("ContextProperty", %{"Property" => "vip", "Operator" => "eq", "Value" => "true"})
    no = filter("ContextProperty", %{"Property" => "Vip", "Operator" => "eq", "Value" => "false"})
    refute E.evaluate(definition([yes, no], %{"contextRequirementType" => "All"}), context)
    assert E.evaluate(definition([yes, no], %{"contextRequirementType" => "Any"}), context)
    refute E.evaluate(%{"featureKey" => "x", "filters" => nil}, context)
  end

  test "segment percentage gates, aliases, no request data and Macintosh normalization" do
    for name <- [
          "Country",
          "CountryFamily",
          "BrowserFamily",
          "BrowserLanguage",
          "DeviceType",
          "OperatingSystem",
          "OS",
          "UserClaims"
        ] do
      refute E.evaluate(definition([filter(name, %{"Percentage" => 100})]), %{})
      refute E.evaluate(definition([filter(name)]), %{})
    end

    ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

    assert E.evaluate(
             definition([
               filter("DeviceType", %{"Percentage" => 100, "DeviceType:0" => "Macintosh"})
             ]),
             %{"request" => %{"userAgent" => ua}}
           )

    c = %{"identity" => "alice", "request" => %{"country" => "US"}}

    assert E.evaluate(
             definition([filter("CountryFamily", %{"Percentage" => 100, "Country:0" => "US"})]),
             c
           )

    # Anonymous segment rollouts deliberately sample; endpoints remain deterministic.
    for _ <- 1..100,
        do:
          assert(
            is_boolean(
              E.evaluate(
                definition([filter("Country", %{"Percentage" => 50, "Country:0" => "US"})]),
                Map.delete(c, "identity")
              )
            )
          )

    assert is_boolean(E.evaluate(definition([filter("Percentage", %{"Value" => 50})]), c))
    refute E.evaluate(definition([filter("AlwaysOff")]), %{})

    assert E.evaluate(
             definition([
               filter("Targeting", %{"Audience:Users:0" => "Alice", "IgnoreCase" => true})
             ]),
             %{"identity" => "Alice"}
           )

    assert Toggly.Context.from_headers(%{"USER-AGENT" => "ignored"}, %{
             "request" => %{"userAgent" => "trusted"}
           })["request"]["userAgent"] == "trusted"
  end

  test "invalid snapshot files and failed writes preserve defaults" do
    path = Path.join(System.tmp_dir!(), "toggly-bad-#{System.unique_integer([:positive])}")
    File.write!(path, "bad")
    on_exit(fn -> File.rm(path) end)

    sup =
      start_supervised!(
        {Toggly,
         name: BadSnapshot, defaults: %{"on" => true}, snapshot_path: path, refresh_interval: 0}
      )

    assert Toggly.enabled?(BadSnapshot, "on")
    assert {:error, :missing_app_key} = Toggly.refresh(BadSnapshot)
    assert {:error, _} = Toggly.Snapshot.write(Path.join(path, "impossible"), "bad")
    Toggly.stop(sup)
  end

  test "subscribers are idempotent, removed when dead; telemetry spans and custom metrics" do
    start_supervised!(
      {Toggly, name: Events, defaults: %{"on" => true}, refresh_interval: 0, flush_interval: 10}
    )

    parent = self()
    events = for type <- [:start, :stop, :exception], do: [:toggly, :evaluation, type]

    :telemetry.attach_many(
      "toggly-test",
      events,
      fn event, measurements, metadata, _ ->
        send(parent, {:telemetry, event, measurements, metadata})
      end,
      nil
    )

    :telemetry.attach(
      "metric-test",
      [:toggly, :metric, :counter],
      fn e, m, d, _ -> send(parent, {:telemetry, e, m, d}) end,
      nil
    )

    on_exit(fn ->
      :telemetry.detach("toggly-test")
      :telemetry.detach("metric-test")
    end)

    assert Toggly.enabled?(Events, "on")
    assert_receive {:telemetry, [:toggly, :evaluation, :start], _, _}
    assert_receive {:telemetry, [:toggly, :evaluation, :stop], _, %{enabled: true}}
    assert_raise ArgumentError, fn -> Toggly.enabled?(NotRunning, "x") end
    assert_receive {:telemetry, [:toggly, :evaluation, :exception], _, _}
    Toggly.metric(Events, :counter, "orders", 1, %{feature: "on"})
    assert_receive {:telemetry, [:toggly, :metric, :counter], %{value: 1}, %{metric: "orders"}}

    pid =
      spawn(fn ->
        Toggly.subscribe(Events)
        Toggly.subscribe(Events)
        send(parent, :subscribed)

        receive do
          :finish -> :ok
        end
      end)

    assert_receive :subscribed
    assert map_size(:sys.get_state(Events).subscribers) == 1
    ref = Process.monitor(pid)
    send(pid, :finish)
    assert_receive {:DOWN, ^ref, :process, ^pid, _}
    :sys.get_state(Events)
    assert :sys.get_state(Events).subscribers == %{}
    assert :ok = Toggly.unsubscribe(Events)
    Process.sleep(15)
  end
end
