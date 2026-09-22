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

  describe "#save_variants and #load_variants (dual-rail)" do
    it "saves and loads evaluated variants independently from definitions" do
      variants = {
        "checkout-flow" => Toggly::EvaluatedVariantDef.new(enabled: true, variant: "treatment", configuration_value: { "cta" => "Buy" })
      }

      provider.save_variants(variants, { version: "1.0" })
      result = provider.load_variants

      expect(result[:variants].keys).to eq(["checkout-flow"])
      expect(result[:variants]["checkout-flow"].variant).to eq("treatment")
      expect(result[:metadata][:version]).to eq("1.0")
    end

    it "returns nil when nothing has been saved" do
      expect(provider.load_variants).to be_nil
    end

    it "clears variants on #clear" do
      provider.save_variants({ "f" => Toggly::EvaluatedVariantDef.new(enabled: true) })
      provider.clear

      expect(provider.load_variants).to be_nil
    end
  end
end
