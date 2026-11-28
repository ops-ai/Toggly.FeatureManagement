# frozen_string_literal: true

RSpec.describe Toggly::FeatureValueCodec do
  describe ".feature_value_type?" do
    it "recognizes the declared wire value types" do
      expect(described_class.feature_value_type?("string")).to be true
      expect(described_class.feature_value_type?("datetime")).to be true
      expect(described_class.feature_value_type?("float")).to be false
      expect(described_class.feature_value_type?(nil)).to be false
    end
  end

  describe ".value_type_matches?" do
    it "allows the decode attempt for legacy catalogs without a declared type" do
      expect(described_class.value_type_matches?(nil, "string")).to be true
      expect(described_class.value_type_matches?("", "number")).to be true
    end

    it "rejects a declared mismatch" do
      expect(described_class.value_type_matches?("number", "string")).to be false
      expect(described_class.value_type_matches?("string", "string")).to be true
    end
  end

  describe ".decode_string_value" do
    it "decodes plain strings and soft-nulls non-strings / mismatches" do
      expect(described_class.decode_string_value("hello")).to eq("hello")
      expect(described_class.decode_string_value(42)).to be_nil
      expect(described_class.decode_string_value("hello", "number")).to be_nil
    end
  end

  describe ".decode_number_value" do
    it "decodes numeric values and numeric strings; booleans never count" do
      expect(described_class.decode_number_value(42)).to eq(42.0)
      expect(described_class.decode_number_value("3.14")).to eq(3.14)
      expect(described_class.decode_number_value(true)).to be_nil
      expect(described_class.decode_number_value(false)).to be_nil
      expect(described_class.decode_number_value("not-a-number")).to be_nil
      expect(described_class.decode_number_value(42, "string")).to be_nil
    end
  end

  describe ".decode_json_value" do
    it "decodes hashes/arrays and JSON object/array strings only" do
      expect(described_class.decode_json_value({ "a" => 1 })).to eq({ "a" => 1 })
      expect(described_class.decode_json_value('{"a": 1}')).to eq({ "a" => 1 })
      expect(described_class.decode_json_value("not json")).to be_nil
      expect(described_class.decode_json_value('"a plain string"')).to be_nil
      expect(described_class.decode_json_value({ "a" => 1 }, "string")).to be_nil
    end
  end

  describe ".decode_datetime_value" do
    it "parses an ISO-8601 string with a Z suffix" do
      decoded = described_class.decode_datetime_value("2026-01-15T10:30:00Z")
      expect(decoded).not_to be_nil
      expect(decoded.year).to eq(2026)
      expect(decoded.month).to eq(1)
      expect(decoded.day).to eq(15)
    end

    it "soft-nulls on bad input" do
      expect(described_class.decode_datetime_value("not-a-date")).to be_nil
      expect(described_class.decode_datetime_value(12_345)).to be_nil
      expect(described_class.decode_datetime_value("2026-01-15T10:30:00Z", "string")).to be_nil
    end
  end
end
