defmodule Toggly.FeatureValueCodecTest do
  use ExUnit.Case

  alias Toggly.FeatureValueCodec

  describe "feature_value_type?/1" do
    test "recognizes the declared wire value types" do
      assert FeatureValueCodec.feature_value_type?("string")
      assert FeatureValueCodec.feature_value_type?("datetime")
      refute FeatureValueCodec.feature_value_type?("float")
      refute FeatureValueCodec.feature_value_type?(nil)
    end
  end

  describe "value_type_matches?/2" do
    test "allows the decode attempt for legacy catalogs without a declared type" do
      assert FeatureValueCodec.value_type_matches?(nil, "string")
      assert FeatureValueCodec.value_type_matches?("", "number")
    end

    test "rejects a declared mismatch" do
      refute FeatureValueCodec.value_type_matches?("number", "string")
      assert FeatureValueCodec.value_type_matches?("string", "string")
    end
  end

  describe "decode_string_value/2" do
    test "decodes plain strings and soft-nulls non-strings / mismatches" do
      assert FeatureValueCodec.decode_string_value("hello") == "hello"
      assert FeatureValueCodec.decode_string_value(42) == nil
      assert FeatureValueCodec.decode_string_value("hello", "number") == nil
    end
  end

  describe "decode_number_value/2" do
    test "decodes numeric values and numeric strings; booleans never count" do
      assert FeatureValueCodec.decode_number_value(42) == 42
      assert FeatureValueCodec.decode_number_value("3.14") == 3.14
      assert FeatureValueCodec.decode_number_value(true) == nil
      assert FeatureValueCodec.decode_number_value(false) == nil
      assert FeatureValueCodec.decode_number_value("not-a-number") == nil
      assert FeatureValueCodec.decode_number_value(42, "string") == nil
    end
  end

  describe "decode_json_value/2" do
    test "decodes maps/lists and JSON object/array strings only" do
      assert FeatureValueCodec.decode_json_value(%{"a" => 1}) == %{"a" => 1}
      assert FeatureValueCodec.decode_json_value(~s({"a": 1})) == %{"a" => 1}
      assert FeatureValueCodec.decode_json_value("not json") == nil
      assert FeatureValueCodec.decode_json_value(~s("a plain string")) == nil
      assert FeatureValueCodec.decode_json_value(%{"a" => 1}, "string") == nil
    end
  end

  describe "decode_datetime_value/2" do
    test "parses an ISO-8601 string with a Z suffix" do
      decoded = FeatureValueCodec.decode_datetime_value("2026-01-15T10:30:00Z")
      assert %DateTime{} = decoded
      assert decoded.year == 2026
      assert decoded.month == 1
      assert decoded.day == 15
    end

    test "soft-nulls on bad input" do
      assert FeatureValueCodec.decode_datetime_value("not-a-date") == nil
      assert FeatureValueCodec.decode_datetime_value(12_345) == nil
      assert FeatureValueCodec.decode_datetime_value("2026-01-15T10:30:00Z", "string") == nil
    end
  end
end
