# frozen_string_literal: true

RSpec.describe Toggly::EvaluatedVariantDef do
  describe "#initialize" do
    it "coerces enabled to a boolean" do
      entry = described_class.new(enabled: nil)
      expect(entry.enabled).to be false
    end

    it "defaults variant and configuration_value to nil" do
      entry = described_class.new(enabled: true)
      expect(entry.variant).to be_nil
      expect(entry.configuration_value).to be_nil
    end
  end

  describe ".from_hash" do
    it "parses camelCase API fields" do
      entry = described_class.from_hash(
        "enabled" => true,
        "variant" => "treatment",
        "configurationValue" => { "cta" => "Buy now" }
      )

      expect(entry.enabled).to be true
      expect(entry.variant).to eq("treatment")
      expect(entry.configuration_value).to eq({ "cta" => "Buy now" })
    end

    it "parses snake_case fields (snapshot round-trip)" do
      entry = described_class.from_hash(
        enabled: false,
        variant: "control",
        configuration_value: "raw"
      )

      expect(entry.enabled).to be false
      expect(entry.variant).to eq("control")
      expect(entry.configuration_value).to eq("raw")
    end

    it "handles a missing variant" do
      entry = described_class.from_hash("enabled" => true)
      expect(entry.variant).to be_nil
    end
  end

  describe "#to_h" do
    it "round-trips through from_hash" do
      entry = described_class.new(enabled: true, variant: "treatment", configuration_value: 42)
      rehydrated = described_class.from_hash(entry.to_h)

      expect(rehydrated).to eq(entry)
    end
  end

  describe "#==" do
    it "compares by value" do
      a = described_class.new(enabled: true, variant: "treatment")
      b = described_class.new(enabled: true, variant: "treatment")
      c = described_class.new(enabled: true, variant: "control")

      expect(a).to eq(b)
      expect(a).not_to eq(c)
    end
  end
end

RSpec.describe Toggly::VariantResult do
  it "exposes name and configuration_value" do
    result = described_class.new(name: "treatment", configuration_value: { "cta" => "Buy now" })

    expect(result.name).to eq("treatment")
    expect(result.configuration_value).to eq({ "cta" => "Buy now" })
  end

  it "defaults configuration_value to nil" do
    result = described_class.new(name: "treatment")
    expect(result.configuration_value).to be_nil
  end
end
