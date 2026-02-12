# frozen_string_literal: true

RSpec.describe Toggly::Evaluators::Percentage do
  let(:evaluator) { described_class.new }

  describe ".type" do
    it "returns percentage" do
      expect(described_class.type).to eq("percentage")
    end
  end

  describe "#evaluate" do
    context "with 0% rollout" do
      it "returns false" do
        rule = { "percentage" => 0 }
        context = Toggly::Context.new(identity: "user-123")

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be false
      end
    end

    context "with 100% rollout" do
      it "returns true" do
        rule = { "percentage" => 100 }
        context = Toggly::Context.new(identity: "user-123")

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be true
      end
    end

    context "without identity" do
      it "returns false" do
        rule = { "percentage" => 50 }
        context = Toggly::Context.new

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be false
      end
    end

    context "with percentage rollout" do
      it "consistently returns same result for same user" do
        rule = { "percentage" => 50 }
        context = Toggly::Context.new(identity: "user-consistent")

        results = 10.times.map { evaluator.evaluate(rule, context, feature_key: "test") }
        expect(results.uniq.length).to eq(1)
      end

      it "distributes users across buckets" do
        rule = { "percentage" => 50 }

        enabled_count = 0
        1000.times do |i|
          context = Toggly::Context.new(identity: "user-#{i}")
          enabled_count += 1 if evaluator.evaluate(rule, context, feature_key: "test")
        end

        # Should be roughly 50% (allow 10% variance)
        expect(enabled_count).to be_between(400, 600)
      end
    end

    context "with 'value' key instead of 'percentage'" do
      it "reads value correctly" do
        rule = { "value" => 100 }
        context = Toggly::Context.new(identity: "user-123")

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be true
      end
    end
  end
end
