# frozen_string_literal: true

RSpec.describe Toggly::Cache do
  describe ".redis_provider" do
    it "creates a RedisSnapshotProvider" do
      redis = MockRedis.new
      provider = described_class.redis_provider(redis: redis)

      expect(provider).to be_a(Toggly::Cache::RedisSnapshotProvider)
    end

    it "passes options to provider" do
      redis = MockRedis.new
      provider = described_class.redis_provider(
        redis: redis,
        key_prefix: "custom",
        ttl: 3600
      )

      expect(provider.key_prefix).to eq("custom")
      expect(provider.ttl).to eq(3600)
    end
  end
end
