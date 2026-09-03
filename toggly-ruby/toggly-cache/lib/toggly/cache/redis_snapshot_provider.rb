# frozen_string_literal: true

require "json"

module Toggly
  module Cache
    # Redis-based snapshot provider for Toggly.
    #
    # Stores feature definitions in Redis for persistence and sharing
    # across multiple processes or servers.
    #
    # @example Basic usage
    #   redis = Redis.new(url: "redis://localhost:6379")
    #   provider = Toggly::Cache::RedisSnapshotProvider.new(redis: redis)
    #
    # @example With connection pool
    #   pool = ConnectionPool.new(size: 5) { Redis.new }
    #   provider = Toggly::Cache::RedisSnapshotProvider.new(redis: pool)
    #
    # @example With TTL
    #   provider = Toggly::Cache::RedisSnapshotProvider.new(
    #     redis: redis,
    #     ttl: 3600,  # 1 hour
    #     key_prefix: "myapp:toggly"
    #   )
    class RedisSnapshotProvider < Toggly::SnapshotProviders::Base
      # @return [String] Key prefix for Redis keys
      attr_reader :key_prefix

      # @return [Integer, nil] TTL in seconds (nil = no expiration)
      attr_reader :ttl

      # Create a new Redis snapshot provider
      #
      # @param redis [Redis, ConnectionPool] Redis client or connection pool
      # @param key_prefix [String] Prefix for Redis keys
      # @param ttl [Integer, nil] TTL in seconds (nil = no expiration)
      def initialize(redis:, key_prefix: "toggly", ttl: nil)
        super()
        @redis = redis
        @key_prefix = key_prefix
        @ttl = ttl
      end

      # Save definitions to Redis
      #
      # @param definitions [Hash<String, FeatureDefinition>] Definitions to save
      # @param metadata [Hash] Optional metadata
      def save(definitions, metadata = {})
        data = {
          "definitions" => serialize_definitions(definitions),
          "metadata" => metadata.merge("saved_at" => Time.now.utc.iso8601)
        }

        json = JSON.generate(data)

        with_redis do |redis|
          if @ttl
            redis.setex(snapshot_key, @ttl, json)
          else
            redis.set(snapshot_key, json)
          end
        end
      rescue StandardError => e
        raise Toggly::SnapshotError, "Failed to save snapshot to Redis: #{e.message}"
      end

      # Load definitions from Redis
      #
      # @return [Hash, nil] Hash with :definitions and :metadata, or nil if not found
      def load
        json = with_redis { |redis| redis.get(snapshot_key) }
        return nil unless json

        data = JSON.parse(json)

        {
          definitions: deserialize_definitions(data["definitions"]),
          metadata: symbolize_keys(data["metadata"] || {})
        }
      rescue JSON::ParserError => e
        raise Toggly::SnapshotError, "Failed to parse Redis snapshot: #{e.message}"
      rescue StandardError => e
        raise Toggly::SnapshotError, "Failed to load snapshot from Redis: #{e.message}"
      end

      # Clear the snapshot from Redis
      def clear
        with_redis { |redis| redis.del(snapshot_key) }
      rescue StandardError => e
        raise Toggly::SnapshotError, "Failed to clear Redis snapshot: #{e.message}"
      end

      # Check if snapshot exists in Redis
      #
      # @return [Boolean]
      def exists?
        result = with_redis { |redis| redis.exists?(snapshot_key) }
        # Handle both Redis 4.x (returns Integer) and 5.x (returns Boolean)
        result.is_a?(Integer) ? result.positive? : result
      rescue StandardError
        false
      end

      # Get TTL of the snapshot
      #
      # @return [Integer, nil] Remaining TTL in seconds, or nil if no TTL
      def remaining_ttl
        ttl = with_redis { |redis| redis.ttl(snapshot_key) }
        return nil if ttl.nil? || ttl.negative?

        ttl
      rescue StandardError
        nil
      end

      # Touch the snapshot to extend its TTL
      #
      # @return [Boolean] Whether the operation succeeded
      def touch
        return false unless @ttl

        with_redis { |redis| redis.expire(snapshot_key, @ttl) }
        true
      rescue StandardError
        false
      end

      private

      def snapshot_key
        "#{@key_prefix}:snapshot"
      end

      def with_redis(&)
        if @redis.respond_to?(:with)
          # ConnectionPool
          @redis.with(&)
        else
          # Direct Redis client
          yield @redis
        end
      end

      def symbolize_keys(hash)
        return {} unless hash.is_a?(Hash)

        hash.transform_keys(&:to_sym)
      end
    end
  end
end
