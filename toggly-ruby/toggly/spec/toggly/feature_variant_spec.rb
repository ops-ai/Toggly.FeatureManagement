# frozen_string_literal: true

RSpec.describe Toggly::FeatureVariant do
  describe "#initialize" do
    it "defaults status_override to None" do
      variant = described_class.new(name: "A")
      expect(variant.status_override).to eq("None")
      expect(variant.enabled_override?).to be false
      expect(variant.disabled_override?).to be false
    end

    it "falls back to None for an unknown status_override" do
      variant = described_class.new(name: "A", status_override: "bogus")
      expect(variant.status_override).to eq("None")
    end

    it "recognizes Enabled/Disabled overrides" do
      expect(described_class.new(name: "A", status_override: "Enabled").enabled_override?).to be true
      expect(described_class.new(name: "A", status_override: "Disabled").disabled_override?).to be true
    end
  end

  describe ".from_hash" do
    it "parses camelCase wire fields" do
      variant = described_class.from_hash(
        "name" => "A",
        "configurationValue" => { "x" => 1 },
        "statusOverride" => "Enabled"
      )

      expect(variant.name).to eq("A")
      expect(variant.configuration_value).to eq({ "x" => 1 })
      expect(variant.status_override).to eq("Enabled")
    end

    it "parses snake_case fields (snapshot round-trip)" do
      variant = described_class.from_hash(name: "A", configuration_value: 42, status_override: "Disabled")

      expect(variant.configuration_value).to eq(42)
      expect(variant.status_override).to eq("Disabled")
    end
  end

  describe "#==" do
    it "compares by value" do
      a = described_class.new(name: "A", configuration_value: 1)
      b = described_class.new(name: "A", configuration_value: 1)
      c = described_class.new(name: "B", configuration_value: 1)

      expect(a).to eq(b)
      expect(a).not_to eq(c)
    end
  end
end

RSpec.describe Toggly::FeatureVariantAllocation do
  describe ".from_hash" do
    it "returns nil for a nil hash (no allocation configured)" do
      expect(described_class.from_hash(nil)).to be_nil
    end

    it "parses defaults, seed, and user/group/percentile entries" do
      allocation = described_class.from_hash(
        "defaultWhenEnabled" => "A",
        "defaultWhenDisabled" => "B",
        "seed" => "s1",
        "user" => [{ "variant" => "A", "users" => %w[alice bob] }],
        "group" => [{ "variant" => "B", "groups" => ["beta"] }],
        "percentile" => [{ "variant" => "A", "from" => 0, "to" => 50 }]
      )

      expect(allocation.default_when_enabled).to eq("A")
      expect(allocation.default_when_disabled).to eq("B")
      expect(allocation.seed).to eq("s1")
      expect(allocation.user).to eq([{ variant: "A", users: %w[alice bob] }])
      expect(allocation.group).to eq([{ variant: "B", groups: ["beta"] }])
      expect(allocation.percentile).to eq([{ variant: "A", from: 0.0, to: 50.0 }])
    end

    it "defaults missing arrays to []" do
      allocation = described_class.from_hash("defaultWhenEnabled" => "A")

      expect(allocation.user).to eq([])
      expect(allocation.group).to eq([])
      expect(allocation.percentile).to eq([])
    end
  end

  describe "#==" do
    it "compares by value" do
      a = described_class.new(default_when_enabled: "A")
      b = described_class.new(default_when_enabled: "A")
      c = described_class.new(default_when_enabled: "B")

      expect(a).to eq(b)
      expect(a).not_to eq(c)
    end
  end
end
