# frozen_string_literal: true

RSpec.describe Toggly::Context do
  describe "#initialize" do
    it "creates context with all attributes" do
      context = described_class.new(
        identity: "user-123",
        groups: %w[beta premium],
        traits: { country: "US", plan: "enterprise" }
      )

      expect(context.identity).to eq("user-123")
      expect(context.groups).to eq(%w[beta premium])
      expect(context.traits).to eq("country" => "US", "plan" => "enterprise")
    end

    it "converts identity to string" do
      context = described_class.new(identity: 123)
      expect(context.identity).to eq("123")
    end

    it "converts groups to strings" do
      context = described_class.new(groups: %i[admin user])
      expect(context.groups).to eq(%w[admin user])
    end

    it "converts trait keys to strings" do
      context = described_class.new(traits: { country: "US" })
      expect(context.traits).to eq("country" => "US")
    end

    it "handles nil values" do
      context = described_class.new
      expect(context.identity).to be_nil
      expect(context.groups).to eq([])
      expect(context.traits).to eq({})
    end
  end

  describe ".with_identity" do
    it "creates context with just identity" do
      context = described_class.with_identity("user-456")
      expect(context.identity).to eq("user-456")
      expect(context.groups).to eq([])
    end
  end

  describe ".anonymous" do
    it "creates empty context" do
      context = described_class.anonymous
      expect(context.identity).to be_nil
      expect(context.groups).to eq([])
    end
  end

  describe "#identity?" do
    it "returns true when identity is set" do
      context = described_class.new(identity: "user-123")
      expect(context.identity?).to be true
    end

    it "returns false when identity is nil" do
      context = described_class.new
      expect(context.identity?).to be false
    end

    it "returns false when identity is empty" do
      context = described_class.new(identity: "")
      expect(context.identity?).to be false
    end
  end

  describe "#in_group?" do
    let(:context) { described_class.new(groups: %w[beta premium]) }

    it "returns true when in group" do
      expect(context.in_group?("beta")).to be true
      expect(context.in_group?(:premium)).to be true
    end

    it "returns false when not in group" do
      expect(context.in_group?("admin")).to be false
    end
  end

  describe "#trait" do
    let(:context) { described_class.new(traits: { country: "US", plan: "enterprise" }) }

    it "returns trait value" do
      expect(context.trait("country")).to eq("US")
      expect(context.trait(:plan)).to eq("enterprise")
    end

    it "returns nil for missing trait" do
      expect(context.trait("missing")).to be_nil
    end

    it "can be accessed via []" do
      expect(context["country"]).to eq("US")
    end
  end

  describe "#trait?" do
    let(:context) { described_class.new(traits: { country: "US" }) }

    it "returns true when trait exists" do
      expect(context.trait?("country")).to be true
    end

    it "returns false when trait missing" do
      expect(context.trait?("missing")).to be false
    end
  end

  describe "#with_traits" do
    it "returns new context with merged traits" do
      original = described_class.new(identity: "user-123", traits: { country: "US" })
      updated = original.with_traits(plan: "enterprise")

      expect(original.traits).to eq("country" => "US")
      expect(updated.traits).to eq("country" => "US", "plan" => "enterprise")
      expect(updated.identity).to eq("user-123")
    end
  end

  describe "#with_groups" do
    it "returns new context with added groups" do
      original = described_class.new(identity: "user-123", groups: ["beta"])
      updated = original.with_groups("premium", "vip")

      expect(original.groups).to eq(["beta"])
      expect(updated.groups).to eq(%w[beta premium vip])
    end
  end

  describe "#to_h" do
    it "returns hash representation" do
      context = described_class.new(
        identity: "user-123",
        groups: ["beta"],
        traits: { country: "US" }
      )

      expect(context.to_h).to eq(
        identity: "user-123",
        groups: ["beta"],
        traits: { "country" => "US" }
      )
    end
  end

  describe "#==" do
    it "returns true for equal contexts" do
      ctx1 = described_class.new(identity: "user", groups: ["beta"], traits: { a: 1 })
      ctx2 = described_class.new(identity: "user", groups: ["beta"], traits: { a: 1 })

      expect(ctx1).to eq(ctx2)
    end

    it "returns false for different contexts" do
      ctx1 = described_class.new(identity: "user1")
      ctx2 = described_class.new(identity: "user2")

      expect(ctx1).not_to eq(ctx2)
    end
  end

  describe "#cache_key" do
    it "generates consistent cache key" do
      context = described_class.new(
        identity: "user-123",
        groups: %w[beta alpha],
        traits: { b: 2, a: 1 }
      )

      key = context.cache_key
      expect(key).to include("user-123")
      expect(key).to include("alpha,beta") # sorted
    end
  end
end
