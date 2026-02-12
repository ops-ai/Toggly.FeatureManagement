# frozen_string_literal: true

RSpec.describe Toggly::EvaluationEngine do
  let(:engine) { described_class.new }

  describe "#evaluate" do
    context "without rules" do
      it "returns enabled status" do
        definition = Toggly::FeatureDefinition.new(
          feature_key: "test",
          enabled: true
        )

        expect(engine.evaluate(definition)).to be true
      end

      it "returns false when disabled" do
        definition = Toggly::FeatureDefinition.new(
          feature_key: "test",
          enabled: false
        )

        expect(engine.evaluate(definition)).to be false
      end
    end

    context "with rules" do
      it "evaluates always_on rule" do
        definition = Toggly::FeatureDefinition.new(
          feature_key: "test",
          enabled: true,
          rules: [{ "type" => "always_on" }]
        )

        expect(engine.evaluate(definition)).to be true
      end

      it "evaluates always_off rule" do
        definition = Toggly::FeatureDefinition.new(
          feature_key: "test",
          enabled: true,
          rules: [{ "type" => "always_off" }]
        )

        expect(engine.evaluate(definition)).to be false
      end

      it "evaluates rules in order" do
        definition = Toggly::FeatureDefinition.new(
          feature_key: "test",
          enabled: true,
          rules: [
            { "type" => "targeting", "users" => ["specific-user"] },
            { "type" => "always_off" }
          ]
        )

        # User not in list, continues to next rule
        context = Toggly::Context.new(identity: "other-user")
        expect(engine.evaluate(definition, context)).to be false

        # User in list, returns immediately
        context = Toggly::Context.new(identity: "specific-user")
        expect(engine.evaluate(definition, context)).to be true
      end
    end

    context "with nil definition" do
      it "returns false" do
        expect(engine.evaluate(nil)).to be false
      end
    end
  end

  describe "#evaluate_with_details" do
    it "returns EvaluationResult" do
      definition = Toggly::FeatureDefinition.new(
        feature_key: "test",
        enabled: true
      )

      result = engine.evaluate_with_details(definition)

      expect(result).to be_a(Toggly::EvaluationResult)
      expect(result.feature_key).to eq("test")
      expect(result.enabled).to be true
      expect(result.reason).to eq("globally_enabled")
    end

    it "includes matched rule info" do
      definition = Toggly::FeatureDefinition.new(
        feature_key: "test",
        enabled: true,
        rules: [{ "type" => "always_on" }]
      )

      result = engine.evaluate_with_details(definition)

      expect(result.enabled).to be true
      expect(result.matched_rule).to eq({ "type" => "always_on" })
      expect(result.matched_rule_index).to eq(0)
    end

    it "handles nil definition" do
      result = engine.evaluate_with_details(nil)

      expect(result.enabled).to be false
      expect(result.reason).to eq("feature_not_found")
    end

    it "handles disabled feature" do
      definition = Toggly::FeatureDefinition.new(
        feature_key: "test",
        enabled: false
      )

      result = engine.evaluate_with_details(definition)

      expect(result.enabled).to be false
      expect(result.reason).to eq("globally_disabled")
    end
  end
end
