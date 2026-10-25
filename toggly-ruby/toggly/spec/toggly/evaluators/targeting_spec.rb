# frozen_string_literal: true

RSpec.describe Toggly::Evaluators::Targeting do
  let(:evaluator) { described_class.new }

  describe ".type" do
    it "returns targeting" do
      expect(described_class.type).to eq("Targeting")
    end
  end

  describe "#evaluate" do
    context "user targeting" do
      it "returns true when user is in list" do
        rule = { "users" => %w[user-1 user-2 user-3] }
        context = Toggly::Context.new(identity: "user-2")

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be true
      end

      it "returns false when user is not in list and default rollout is 0%" do
        rule = {
          "users" => %w[user-1 user-2],
          "Audience.DefaultRolloutPercentage" => 0
        }
        context = Toggly::Context.new(identity: "user-999")

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be false
      end

      it "returns false when user is excluded" do
        rule = { "excludedUsers" => %w[user-banned] }
        context = Toggly::Context.new(identity: "user-banned")

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be false
      end
    end

    context "group targeting" do
      it "returns true when user is in targeted group" do
        rule = { "groups" => %w[beta premium] }
        context = Toggly::Context.new(identity: "user-1", groups: ["beta"])

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be true
      end

      it "returns false when user is not in any targeted group and default rollout is 0%" do
        rule = {
          "groups" => %w[beta premium],
          "Audience.DefaultRolloutPercentage" => 0
        }
        context = Toggly::Context.new(identity: "user-1", groups: ["standard"])

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be false
      end

      it "returns false when user is in excluded group" do
        rule = { "excludedGroups" => ["banned"] }
        context = Toggly::Context.new(identity: "user-1", groups: ["banned"])

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be false
      end
    end

    context "default rollout (Definitions parity)" do
      let(:rollout_rule) do
        { "name" => "Targeting", "parameters" => { "Audience.DefaultRolloutPercentage" => 100 } }
      end

      it "returns true for 100% default rollout with nil context" do
        expect(evaluator.evaluate(rollout_rule, nil, feature_key: "f")).to be true
      end

      it "returns true for 100% default rollout with blank identity" do
        expect(evaluator.evaluate(rollout_rule, Toggly::Context.new(identity: ""), feature_key: "f")).to be true
      end

      it "returns false for 0% default rollout with no identity" do
        rule = { "parameters" => { "Audience.DefaultRolloutPercentage" => 0, "Audience.Users:0" => "alice" } }
        expect(evaluator.evaluate(rule, Toggly::Context.anonymous, feature_key: "filter-targeting")).to be false
      end

      it "returns false for partial default rollout with no identity" do
        rule = { "parameters" => { "Audience.DefaultRolloutPercentage" => 50 } }
        expect(evaluator.evaluate(rule, nil, feature_key: "f")).to be false
      end

      it "returns false when default rollout is unset and user is not listed" do
        rule = { "users" => ["alice"] }
        expect(evaluator.evaluate(rule, Toggly::Context.new(identity: "bob"), feature_key: "f")).to be false
      end

      it "uses sticky hash for partial default rollout with identity" do
        feature_key = "targeting-rollout"
        identity = "sticky-user"
        bucket = Toggly::StickyHash.compute_percentile(identity, feature_key)

        above = { "parameters" => { "Audience.DefaultRolloutPercentage" => bucket + 0.01 } }
        expect(evaluator.evaluate(above, Toggly::Context.new(identity: identity), feature_key: feature_key)).to be true

        below = { "parameters" => { "Audience.DefaultRolloutPercentage" => bucket - 0.01 } }
        expect(evaluator.evaluate(below, Toggly::Context.new(identity: identity), feature_key: feature_key)).to be false
      end

      it "enables alice and disables bob for LiveE2E filter-targeting shape" do
        rule = {
          "parameters" => {
            "Audience.DefaultRolloutPercentage" => 0,
            "Audience.Users:0" => "alice"
          }
        }
        expect(evaluator.evaluate(rule, Toggly::Context.new(identity: "alice"), feature_key: "filter-targeting")).to be true
        expect(evaluator.evaluate(rule, Toggly::Context.new(identity: "bob"), feature_key: "filter-targeting")).to be false
      end
    end

    context "exclusion takes priority" do
      it "excludes user even if in included users list" do
        rule = {
          "users" => ["user-1"],
          "excludedUsers" => ["user-1"]
        }
        context = Toggly::Context.new(identity: "user-1")

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be false
      end
    end
  end
end
