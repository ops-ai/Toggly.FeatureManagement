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

      it "returns nil when user is not in list" do
        rule = { "users" => %w[user-1 user-2] }
        context = Toggly::Context.new(identity: "user-999")

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be_nil
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

      it "returns nil when user is not in any targeted group" do
        rule = { "groups" => %w[beta premium] }
        context = Toggly::Context.new(identity: "user-1", groups: ["standard"])

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be_nil
      end

      it "returns false when user is in excluded group" do
        rule = { "excludedGroups" => ["banned"] }
        context = Toggly::Context.new(identity: "user-1", groups: ["banned"])

        expect(evaluator.evaluate(rule, context, feature_key: "test")).to be false
      end
    end

    context "without context" do
      it "returns nil" do
        rule = { "users" => ["user-1"] }

        expect(evaluator.evaluate(rule, nil, feature_key: "test")).to be_nil
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
