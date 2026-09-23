# frozen_string_literal: true

RSpec.describe Toggly::FeatureDefinition do
  describe "#initialize" do
    it "creates definition with all attributes" do
      definition = described_class.new(
        feature_key: "dark-mode",
        feature_type: "Release",
        enabled: true,
        rules: [{ "type" => "percentage", "value" => 50 }],
        description: "Dark mode feature"
      )

      expect(definition.feature_key).to eq("dark-mode")
      expect(definition.feature_type).to eq("Release")
      expect(definition.enabled).to be true
      expect(definition.rules).to eq([{ "type" => "percentage", "value" => 50 }])
      expect(definition.description).to eq("Dark mode feature")
    end

    it "uses default values" do
      definition = described_class.new(feature_key: "test")

      expect(definition.feature_type).to eq("Release")
      expect(definition.enabled).to be false
      expect(definition.rules).to eq([])
    end

    it "converts feature_key to string" do
      definition = described_class.new(feature_key: :test_feature)
      expect(definition.feature_key).to eq("test_feature")
    end

    it "validates feature type" do
      definition = described_class.new(feature_key: "test", feature_type: "Invalid")
      expect(definition.feature_type).to eq("Release")
    end
  end

  describe ".from_hash" do
    it "creates definition from hash with camelCase keys" do
      hash = {
        "featureKey" => "my-feature",
        "featureType" => "Experiment",
        "enabled" => true,
        "rules" => [{ "type" => "always_on" }]
      }

      definition = described_class.from_hash(hash)

      expect(definition.feature_key).to eq("my-feature")
      expect(definition.feature_type).to eq("Experiment")
      expect(definition.enabled).to be true
    end

    it "creates definition from hash with snake_case keys" do
      hash = {
        feature_key: "my-feature",
        feature_type: "Ops",
        enabled: true
      }

      definition = described_class.from_hash(hash)

      expect(definition.feature_key).to eq("my-feature")
      expect(definition.feature_type).to eq("Ops")
    end

    it "parses variants and allocation from the catalog wire" do
      hash = {
        "featureKey" => "checkout-flow",
        "enabled" => true,
        "variants" => [
          { "name" => "A", "configurationValue" => { "cta" => "Buy" }, "statusOverride" => "None" },
          { "name" => "Off", "statusOverride" => "Disabled" }
        ],
        "allocation" => {
          "defaultWhenEnabled" => "A",
          "defaultWhenDisabled" => "Off",
          "seed" => "campaign-1",
          "user" => [{ "variant" => "A", "users" => ["alice"] }],
          "group" => [{ "variant" => "Off", "groups" => ["beta"] }],
          "percentile" => [{ "variant" => "A", "from" => 0, "to" => 100 }]
        }
      }

      definition = described_class.from_hash(hash)

      expect(definition.variants.map(&:name)).to eq(%w[A Off])
      expect(definition.variants.first.configuration_value).to eq({ "cta" => "Buy" })
      expect(definition.variants.last.status_override).to eq("Disabled")
      expect(definition.allocation.default_when_enabled).to eq("A")
      expect(definition.allocation.default_when_disabled).to eq("Off")
      expect(definition.allocation.seed).to eq("campaign-1")
      expect(definition.allocation.user).to eq([{ variant: "A", users: ["alice"] }])
      expect(definition.allocation.group).to eq([{ variant: "Off", groups: ["beta"] }])
      expect(definition.allocation.percentile).to eq([{ variant: "A", from: 0.0, to: 100.0 }])
    end

    it "defaults variants to [] and allocation to nil when absent" do
      definition = described_class.from_hash("featureKey" => "no-variants", "enabled" => true)

      expect(definition.variants).to eq([])
      expect(definition.allocation).to be_nil
    end
  end

  describe "#to_h" do
    it "returns hash representation" do
      definition = described_class.new(
        feature_key: "test",
        feature_type: "Release",
        enabled: true,
        rules: [{ "type" => "always_on" }]
      )

      hash = definition.to_h

      expect(hash[:feature_key]).to eq("test")
      expect(hash[:feature_type]).to eq("Release")
      expect(hash[:enabled]).to be true
      expect(hash[:rules]).to eq([{ "type" => "always_on" }])
    end
  end

  describe "#rules?" do
    it "returns true when rules exist" do
      definition = described_class.new(
        feature_key: "test",
        rules: [{ "type" => "always_on" }]
      )
      expect(definition.rules?).to be true
    end

    it "returns false when no rules" do
      definition = described_class.new(feature_key: "test")
      expect(definition.rules?).to be false
    end
  end

  describe "type predicates" do
    it "#release? returns true for Release type" do
      definition = described_class.new(feature_key: "test", feature_type: "Release")
      expect(definition.release?).to be true
      expect(definition.experiment?).to be false
    end

    it "#experiment? returns true for Experiment type" do
      definition = described_class.new(feature_key: "test", feature_type: "Experiment")
      expect(definition.experiment?).to be true
    end

    it "#ops? returns true for Ops type" do
      definition = described_class.new(feature_key: "test", feature_type: "Ops")
      expect(definition.ops?).to be true
    end

    it "#permission? returns true for Permission type" do
      definition = described_class.new(feature_key: "test", feature_type: "Permission")
      expect(definition.permission?).to be true
    end
  end

  describe "#==" do
    it "returns true for equal definitions" do
      def1 = described_class.new(feature_key: "test", enabled: true)
      def2 = described_class.new(feature_key: "test", enabled: true)

      expect(def1).to eq(def2)
    end

    it "returns false for different definitions" do
      def1 = described_class.new(feature_key: "test1")
      def2 = described_class.new(feature_key: "test2")

      expect(def1).not_to eq(def2)
    end
  end
end
