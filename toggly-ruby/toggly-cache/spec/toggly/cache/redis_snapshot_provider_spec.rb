# frozen_string_literal: true

RSpec.describe Toggly::Cache::RedisSnapshotProvider do
  let(:redis) { MockRedis.new }
  let(:provider) { described_class.new(redis: redis) }

  describe "#initialize" do
    it "sets default values" do
      expect(provider.key_prefix).to eq("toggly")
      expect(provider.ttl).to be_nil
    end

    it "accepts custom values" do
      custom_provider = described_class.new(
        redis: redis,
        key_prefix: "myapp:toggly",
        ttl: 3600
      )

      expect(custom_provider.key_prefix).to eq("myapp:toggly")
      expect(custom_provider.ttl).to eq(3600)
    end
  end

  describe "#save and #load" do
    it "saves and loads definitions" do
      definitions = {
        "feature-1" => Toggly::FeatureDefinition.new(feature_key: "feature-1", enabled: true),
        "feature-2" => Toggly::FeatureDefinition.new(feature_key: "feature-2", enabled: false)
      }

      provider.save(definitions, { version: "1.0" })
      result = provider.load

      expect(result[:definitions].keys).to eq(%w[feature-1 feature-2])
      expect(result[:definitions]["feature-1"].enabled).to be true
      expect(result[:definitions]["feature-2"].enabled).to be false
      expect(result[:metadata][:version]).to eq("1.0")
    end

    it "stores data in Redis" do
      definitions = {
        "test" => Toggly::FeatureDefinition.new(feature_key: "test", enabled: true)
      }

      provider.save(definitions)

      raw = redis.get("toggly:snapshot")
      expect(raw).not_to be_nil

      data = JSON.parse(raw)
      expect(data["definitions"]).to be_an(Array)
    end

    it "uses TTL when set" do
      ttl_provider = described_class.new(redis: redis, ttl: 3600)

      definitions = {
        "test" => Toggly::FeatureDefinition.new(feature_key: "test", enabled: true)
      }

      ttl_provider.save(definitions)

      # MockRedis simulates TTL
      remaining = redis.ttl("toggly:snapshot")
      expect(remaining).to be > 0
    end
  end

  describe "#exists?" do
    it "returns false when empty" do
      expect(provider.exists?).to be false
    end

    it "returns true when data exists" do
      provider.save({})
      expect(provider.exists?).to be true
    end
  end

  describe "#clear" do
    it "removes the snapshot" do
      provider.save({})
      provider.clear

      expect(provider.exists?).to be false
    end
  end

  describe "#remaining_ttl" do
    it "returns nil when no TTL" do
      provider.save({})
      expect(provider.remaining_ttl).to be_nil
    end

    it "returns remaining TTL when set" do
      ttl_provider = described_class.new(redis: redis, ttl: 3600)
      ttl_provider.save({})

      remaining = ttl_provider.remaining_ttl
      expect(remaining).to be > 0
    end
  end

  describe "#touch" do
    it "returns false when no TTL configured" do
      provider.save({})
      expect(provider.touch).to be false
    end

    it "extends TTL when configured" do
      ttl_provider = described_class.new(redis: redis, ttl: 3600)
      ttl_provider.save({})

      # Simulate time passing by manually reducing TTL
      redis.expire("toggly:snapshot", 100)

      expect(ttl_provider.touch).to be true

      # TTL should be reset to 3600
      remaining = redis.ttl("toggly:snapshot")
      expect(remaining).to eq(3600)
    end
  end

  describe "with connection pool" do
    it "works with pool-like interface" do
      # Simulate a connection pool with #with method
      pool = double("ConnectionPool")
      allow(pool).to receive(:with).and_yield(redis)

      pool_provider = described_class.new(redis: pool)

      definitions = {
        "test" => Toggly::FeatureDefinition.new(feature_key: "test", enabled: true)
      }

      pool_provider.save(definitions)
      result = pool_provider.load

      expect(result[:definitions]["test"].enabled).to be true
    end
  end

  describe "error handling" do
    it "raises SnapshotError on Redis errors during save" do
      failing_redis = double("Redis")
      allow(failing_redis).to receive(:set).and_raise(StandardError, "Connection failed")

      failing_provider = described_class.new(redis: failing_redis)

      expect { failing_provider.save({}) }
        .to raise_error(Toggly::SnapshotError, /Failed to save/)
    end

    it "raises SnapshotError on Redis errors during load" do
      failing_redis = double("Redis")
      allow(failing_redis).to receive(:get).and_raise(StandardError, "Connection failed")

      failing_provider = described_class.new(redis: failing_redis)

      expect { failing_provider.load }
        .to raise_error(Toggly::SnapshotError, /Failed to load/)
    end

    it "raises SnapshotError on invalid JSON during load" do
      redis.set("toggly:snapshot", "invalid json")

      expect { provider.load }
        .to raise_error(Toggly::SnapshotError, /Failed to parse/)
    end
  end

  describe "custom key prefix" do
    it "uses custom key prefix" do
      custom_provider = described_class.new(redis: redis, key_prefix: "myapp:features")

      definitions = {
        "test" => Toggly::FeatureDefinition.new(feature_key: "test", enabled: true)
      }

      custom_provider.save(definitions)

      expect(redis.get("myapp:features:snapshot")).not_to be_nil
      expect(redis.get("toggly:snapshot")).to be_nil
    end
  end
end
