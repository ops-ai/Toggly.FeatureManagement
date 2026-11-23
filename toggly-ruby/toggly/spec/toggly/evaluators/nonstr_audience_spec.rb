# frozen_string_literal: true

RSpec.describe "non-string audience checks" do
  let(:targeting) { Toggly::Evaluators::Targeting.new }

  describe "named audience" do
    it "coerces a finite numeric identity to decimal text and matches that name" do
      rule = {
        "Audience.Users:0" => "42",
        "Audience.DefaultRolloutPercentage" => 0
      }
      context = Toggly::Context.new(identity: 42)

      expect(targeting.evaluate(rule, context, feature_key: "flag")).to be true
    end

    it "does not throw when a numeric identity misses the saved name" do
      rule = {
        "Audience.Users:0" => "alice",
        "Audience.DefaultRolloutPercentage" => 0
      }
      context = Toggly::Context.new(identity: 42)

      expect(targeting.evaluate(rule, context, feature_key: "flag")).to be false
    end

    it "matches a real group beside a nil slot and does not treat nil as a match" do
      named = {
        "Audience.Groups:0" => "beta",
        "Audience.DefaultRolloutPercentage" => 0
      }

      expect(
        targeting.evaluate(named, Toggly::Context.new(groups: [nil, "beta"]), feature_key: "flag")
      ).to be true
      expect(
        targeting.evaluate(named, Toggly::Context.new(groups: [nil]), feature_key: "flag")
      ).to be false
    end

    it "does not let a nil group slot exclude a rollout" do
      rule = {
        "Audience.Groups:0" => "beta",
        "Audience.DefaultRolloutPercentage" => 100
      }

      expect(
        targeting.evaluate(rule, Toggly::Context.new(groups: [nil]), feature_key: "flag")
      ).to be true
    end

    it "does not throw for an empty audience and a numeric identity" do
      rule = { "Audience.DefaultRolloutPercentage" => 0 }

      expect(
        targeting.evaluate(rule, Toggly::Context.new(identity: 42), feature_key: "flag")
      ).to be false
    end
  end

  describe "segment comparisons" do
    # Context.new coerces hashes and drops other request objects, so this
    # double is the path that still hands an Integer to the comparison.
    let(:context) do
      request = Struct.new(:country, :accept_language, :user_agent).new(42, 42, 42)
      Struct.new(:identity, :request).new("user", request)
    end

    it "fails closed when country is numeric" do
      rule = { "Percentage" => 100, "Country:0" => "US" }

      expect(
        Toggly::Evaluators::Country.new.evaluate(rule, context, feature_key: "flag")
      ).to be false
    end

    it "fails closed when accept-language is numeric" do
      rule = { "Percentage" => 100, "BrowserLanguage:0" => "en" }

      expect(
        Toggly::Evaluators::BrowserLanguage.new.evaluate(rule, context, feature_key: "flag")
      ).to be false
    end

    it "fails closed when the user agent is numeric" do
      expect(Toggly::UserAgentParser.parse(42)).to be_nil
    end

    it "does not case-fold a non-string" do
      expect(Toggly::Evaluators::SegmentHelpers.equals_ignore_case?(42, "US")).to be false
      expect(Toggly::Evaluators::SegmentHelpers.contains_ignore_case?(42, "en")).to be false
    end

    it "fails closed for a partial rollout when identity is numeric" do
      expect(Toggly::StickyHash.segment_percentage_passes?(50, "flag", 42)).to be false
    end
  end
end
