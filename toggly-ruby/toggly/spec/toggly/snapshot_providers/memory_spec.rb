# frozen_string_literal: true

RSpec.describe Toggly::SnapshotProviders::Memory do
  let(:provider) { described_class.new }

  describe "#save and #load" do
    it "saves and loads definitions" do
      definitions = {
        "feature-1" => Toggly::FeatureDefinition.new(feature_key: "feature-1", enabled: true),
        "feature-2" => Toggly::FeatureDefinition.new(feature_key: "feature-2", enabled: false)
      }

      provider.save(definitions, { version: "1.0" })
      result = provider.load

      expect(result[:definitions].keys).to eq(%w[feature-1 feature-2])
      expect(result[:definitions]["feature-1"].enabled).to be true
      expect(result[:metadata][:version]).to eq("1.0")
    end
  end

  describe "#exists?" do
    it "returns false when empty" do
      expect(provider.exists?).to be false
    end

    it "returns true when data exists" do
      provider.save({})
      expect(provider.exists?).to be true
    end
  end

  describe "#clear" do
    it "clears stored data" do
      provider.save({})
      provider.clear

      expect(provider.exists?).to be false
    end
  end

  describe "definitions with variants/allocation" do
    it "round-trips variants and allocation through save/load" do
      definition = Toggly::FeatureDefinition.new(
        feature_key: "checkout-flow",
        enabled: true,
        variants: [Toggly::FeatureVariant.new(name: "A", configuration_value: { "cta" => "Buy" })],
        allocation: Toggly::FeatureVariantAllocation.new(default_when_enabled: "A")
      )

      provider.save({ "checkout-flow" => definition })
      result = provider.load

      loaded = result[:definitions]["checkout-flow"]
      expect(loaded.variants.first.name).to eq("A")
      expect(loaded.variants.first.configuration_value).to eq({ "cta" => "Buy" })
      expect(loaded.allocation.default_when_enabled).to eq("A")
    end
  end
end
