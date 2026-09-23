# frozen_string_literal: true

RSpec.describe Toggly::VariantResult do
  it "exposes name, configuration_value, enabled, and reason" do
    result = described_class.new(
      name: "treatment",
      configuration_value: { "cta" => "Buy now" },
      enabled: true,
      reason: "User"
    )

    expect(result.name).to eq("treatment")
    expect(result.configuration_value).to eq({ "cta" => "Buy now" })
    expect(result.enabled).to be true
    expect(result.reason).to eq("User")
  end

  it "defaults configuration_value to nil, enabled to true, and reason to nil" do
    result = described_class.new(name: "treatment")

    expect(result.configuration_value).to be_nil
    expect(result.enabled).to be true
    expect(result.reason).to be_nil
  end

  describe "#to_h" do
    it "returns a hash of all fields" do
      result = described_class.new(name: "A", configuration_value: 1, enabled: false, reason: "Group")

      expect(result.to_h).to eq(name: "A", configuration_value: 1, enabled: false, reason: "Group")
    end
  end

  describe "#==" do
    it "compares by value" do
      a = described_class.new(name: "A", enabled: true, reason: "User")
      b = described_class.new(name: "A", enabled: true, reason: "User")
      c = described_class.new(name: "B", enabled: true, reason: "User")

      expect(a).to eq(b)
      expect(a).not_to eq(c)
    end
  end
end
