# frozen_string_literal: true

require "json"

# Shared gold corpus (`Toggly.FeatureManagement/variant-allocator-corpus/`):
# ground-truth variant-allocation outcomes from `Microsoft.FeatureManagement`
# 4.7.0 (`FeatureManager#GetVariantAsync`). Every case here must match
# bit-for-bit; see the corpus README for schema.
TOGGLY_VARIANT_CORPUS_PATH = File.expand_path("../../../../variant-allocator-corpus/cases.json", __dir__)

RSpec.describe Toggly::VariantAllocator do
  def definition_from_case_feature(feature)
    Toggly::FeatureDefinition.from_hash(
      "featureKey" => feature["name"],
      "filters" => feature["enabledFor"],
      "variants" => feature["variants"],
      "allocation" => feature["allocation"]
    )
  end

  let(:engine) { Toggly::EvaluationEngine.new }

  it "the corpus file exists and is non-empty" do
    expect(File.exist?(TOGGLY_VARIANT_CORPUS_PATH)).to be true
    expect(JSON.parse(File.read(TOGGLY_VARIANT_CORPUS_PATH))).not_to be_empty
  end

  JSON.parse(File.read(TOGGLY_VARIANT_CORPUS_PATH)).each do |kase|
    it "matches MF for case: #{kase["id"]}" do
      definition = definition_from_case_feature(kase["feature"])
      context = Toggly::Context.new(
        identity: kase.dig("targeting", "userId"),
        groups: kase.dig("targeting", "groups") || []
      )

      enabled = engine.evaluate(definition, context)
      assignment = described_class.assign(
        definition,
        enabled: enabled,
        identity: context.identity,
        groups: context.groups,
        ignore_case: kase["ignoreCase"] || false
      )

      expected = kase["expected"]
      aggregate_failures("case #{kase["id"]}") do
        expect(assignment.variant_name).to eq(expected["variantName"])
        expect(assignment.configuration_value).to eq(expected["configurationValue"])
        expect(assignment.enabled).to eq(expected["enabled"])
        expect(assignment.reason).to eq(expected["assignmentReason"])
      end
    end
  end

  describe "#compute_percentile" do
    it "is deterministic for the same inputs" do
      a = described_class.compute_percentile("alice", nil, "feature-a", false)
      b = described_class.compute_percentile("alice", nil, "feature-a", false)
      expect(a).to eq(b)
    end

    it "differs across custom seeds" do
      with_seed = described_class.compute_percentile("alice", "seed-1", "feature-a", false)
      without_seed = described_class.compute_percentile("alice", nil, "feature-a", false)
      expect(with_seed).not_to eq(without_seed)
    end
  end
end
