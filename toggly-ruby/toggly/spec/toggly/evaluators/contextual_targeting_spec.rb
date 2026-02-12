# frozen_string_literal: true

RSpec.describe Toggly::Evaluators::ContextualTargeting do
  let(:evaluator) { described_class.new }

  describe ".type" do
    it "returns contextual" do
      expect(described_class.type).to eq("contextual")
    end
  end

  describe "#evaluate" do
    context "equality operators" do
      it "matches eq operator" do
        rule = { "conditions" => [{ "trait" => "country", "operator" => "eq", "value" => "US" }] }
        context = Toggly::Context.new(traits: { country: "US" })

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be true
      end

      it "matches ne operator" do
        rule = { "conditions" => [{ "trait" => "country", "operator" => "ne", "value" => "US" }] }
        context = Toggly::Context.new(traits: { country: "UK" })

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be true
      end
    end

    context "numeric operators" do
      it "matches gt operator" do
        rule = { "conditions" => [{ "trait" => "age", "operator" => "gt", "value" => 18 }] }
        context = Toggly::Context.new(traits: { age: 25 })

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be true
      end

      it "matches gte operator" do
        rule = { "conditions" => [{ "trait" => "age", "operator" => "gte", "value" => 18 }] }
        context = Toggly::Context.new(traits: { age: 18 })

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be true
      end

      it "matches lt operator" do
        rule = { "conditions" => [{ "trait" => "age", "operator" => "lt", "value" => 18 }] }
        context = Toggly::Context.new(traits: { age: 16 })

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be true
      end

      it "matches lte operator" do
        rule = { "conditions" => [{ "trait" => "age", "operator" => "lte", "value" => 18 }] }
        context = Toggly::Context.new(traits: { age: 18 })

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be true
      end
    end

    context "string operators" do
      it "matches contains operator" do
        rule = { "conditions" => [{ "trait" => "email", "operator" => "contains", "value" => "@example" }] }
        context = Toggly::Context.new(traits: { email: "user@example.com" })

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be true
      end

      it "matches starts_with operator" do
        rule = { "conditions" => [{ "trait" => "email", "operator" => "starts_with", "value" => "admin" }] }
        context = Toggly::Context.new(traits: { email: "admin@example.com" })

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be true
      end

      it "matches ends_with operator" do
        rule = { "conditions" => [{ "trait" => "email", "operator" => "ends_with", "value" => ".com" }] }
        context = Toggly::Context.new(traits: { email: "user@example.com" })

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be true
      end
    end

    context "list operators" do
      it "matches in operator" do
        rule = { "conditions" => [{ "trait" => "country", "operator" => "in", "value" => %w[US UK CA] }] }
        context = Toggly::Context.new(traits: { country: "US" })

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be true
      end

      it "matches not_in operator" do
        rule = { "conditions" => [{ "trait" => "country", "operator" => "not_in", "value" => %w[US UK] }] }
        context = Toggly::Context.new(traits: { country: "DE" })

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be true
      end
    end

    context "existence operators" do
      it "matches exists operator" do
        rule = { "conditions" => [{ "trait" => "premium", "operator" => "exists" }] }
        context = Toggly::Context.new(traits: { premium: true })

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be true
      end

      it "matches not_exists operator" do
        rule = { "conditions" => [{ "trait" => "premium", "operator" => "not_exists" }] }
        context = Toggly::Context.new(traits: { country: "US" })

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be true
      end
    end

    context "regex operator" do
      it "matches regex pattern" do
        rule = { "conditions" => [{ "trait" => "email", "operator" => "matches", "value" => "^admin@" }] }
        context = Toggly::Context.new(traits: { email: "admin@example.com" })

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be true
      end

      it "handles invalid regex gracefully" do
        rule = { "conditions" => [{ "trait" => "email", "operator" => "matches", "value" => "[invalid" }] }
        context = Toggly::Context.new(traits: { email: "test@example.com" })

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be false
      end
    end

    context "match types" do
      it "requires all conditions for matchType=all" do
        rule = {
          "matchType" => "all",
          "conditions" => [
            { "trait" => "country", "operator" => "eq", "value" => "US" },
            { "trait" => "premium", "operator" => "eq", "value" => "true" }
          ]
        }
        context = Toggly::Context.new(traits: { country: "US", premium: "true" })

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be true
      end

      it "requires any condition for matchType=any" do
        rule = {
          "matchType" => "any",
          "conditions" => [
            { "trait" => "country", "operator" => "eq", "value" => "US" },
            { "trait" => "country", "operator" => "eq", "value" => "UK" }
          ]
        }
        context = Toggly::Context.new(traits: { country: "UK" })

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be true
      end
    end

    context "empty conditions" do
      it "returns nil when no conditions" do
        rule = { "conditions" => [] }
        context = Toggly::Context.new(traits: { country: "US" })

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be_nil
      end
    end
  end
end
