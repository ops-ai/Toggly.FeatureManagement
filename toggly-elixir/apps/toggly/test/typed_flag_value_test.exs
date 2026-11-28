defmodule Toggly.TypedFlagValueTest do
  use ExUnit.Case

  defp start_client(name, features) do
    transport = fn _req ->
      {:ok, %{status: 200, body: Jason.encode!(features), headers: [{"etag", "v1"}]}}
    end

    start_supervised!(
      {Toggly,
       name: name,
       app_key: "test",
       signed: false,
       transport: transport,
       refresh_interval: 0,
       websocket: false}
    )

    assert :ok = Toggly.refresh(name)
    name
  end

  describe "get_string_value/3" do
    test "decodes when the declared valueType matches" do
      client =
        start_client(TypedStringFlags, [
          %{
            "featureKey" => "greeting",
            "filters" => [%{"name" => "AlwaysOn"}],
            "valueType" => "string",
            "value" => "hello"
          }
        ])

      assert Toggly.get_string_value(client, "greeting") == "hello"
    end

    test "soft-nulls on a declared mismatch" do
      client =
        start_client(TypedStringMismatchFlags, [
          %{
            "featureKey" => "limit",
            "filters" => [%{"name" => "AlwaysOn"}],
            "valueType" => "number",
            "value" => 42
          }
        ])

      assert Toggly.get_string_value(client, "limit") == nil
    end
  end

  test "get_number_value/3 decodes numeric values when the declared type matches" do
    client =
      start_client(TypedNumberFlags, [
        %{
          "featureKey" => "limit",
          "filters" => [%{"name" => "AlwaysOn"}],
          "valueType" => "number",
          "value" => 42
        }
      ])

    assert Toggly.get_number_value(client, "limit") == 42
  end

  test "get_json_value/3 decodes object values when the declared type matches" do
    client =
      start_client(TypedJsonFlags, [
        %{
          "featureKey" => "config",
          "filters" => [%{"name" => "AlwaysOn"}],
          "valueType" => "json",
          "value" => %{"nested" => %{"flag" => true}}
        }
      ])

    assert Toggly.get_json_value(client, "config") == %{"nested" => %{"flag" => true}}
  end

  describe "get_datetime_value/3" do
    test "parses ISO-8601 into a DateTime" do
      client =
        start_client(TypedDateTimeFlags, [
          %{
            "featureKey" => "launch-at",
            "filters" => [%{"name" => "AlwaysOn"}],
            "valueType" => "datetime",
            "value" => "2026-06-01T00:00:00Z"
          }
        ])

      decoded = Toggly.get_datetime_value(client, "launch-at")
      assert %DateTime{} = decoded
      assert decoded.year == 2026
      assert decoded.month == 6
    end

    test "soft-nulls on an unparsable value" do
      client =
        start_client(TypedDateTimeBadFlags, [
          %{
            "featureKey" => "launch-at",
            "filters" => [%{"name" => "AlwaysOn"}],
            "valueType" => "datetime",
            "value" => "not-a-date"
          }
        ])

      assert Toggly.get_datetime_value(client, "launch-at") == nil
    end
  end

  test "soft-nulls every typed getter on a disabled flag" do
    client =
      start_client(TypedDisabledFlags, [
        %{
          "featureKey" => "greeting",
          "filters" => [%{"name" => "AlwaysOff"}],
          "valueType" => "string",
          "value" => "hello"
        }
      ])

    assert Toggly.get_string_value(client, "greeting") == nil
  end

  test "soft-nulls every typed getter on an unknown feature" do
    client = start_client(TypedUnknownFlags, [])

    assert Toggly.get_string_value(client, "unknown") == nil
    assert Toggly.get_number_value(client, "unknown") == nil
    assert Toggly.get_json_value(client, "unknown") == nil
    assert Toggly.get_datetime_value(client, "unknown") == nil
  end

  test "still decodes legacy catalogs that predate valueType" do
    client =
      start_client(TypedLegacyFlags, [
        %{
          "featureKey" => "greeting",
          "filters" => [%{"name" => "AlwaysOn"}],
          "value" => "hello"
        }
      ])

    assert Toggly.get_string_value(client, "greeting") == "hello"
  end
end
