# frozen_string_literal: true

require "toggly"
require_relative "toggly/cache/version"
require_relative "toggly/cache/redis_snapshot_provider"

module Toggly
  # Redis caching module for Toggly.
  #
  # Provides a Redis-based snapshot provider for storing and sharing
  # feature definitions across processes and servers.
  #
  # @example Basic usage
  #   redis = Redis.new(url: ENV["REDIS_URL"])
  #   provider = Toggly::Cache::RedisSnapshotProvider.new(redis: redis)
  #
  #   client = Toggly::Client.new(
  #     app_key: "your-app-key",
  #     snapshot_provider: provider
  #   )
  #
  # @example With connection pool
  #   require "connection_pool"
  #
  #   pool = ConnectionPool.new(size: 5) { Redis.new(url: ENV["REDIS_URL"]) }
  #   provider = Toggly::Cache::RedisSnapshotProvider.new(redis: pool)
  #
  # @example With Rails
  #   # config/initializers/toggly.rb
  #   Toggly::Rails.configure do |config|
  #     config.app_key = Rails.application.credentials.toggly_app_key
  #     config.snapshot_provider = Toggly::Cache::RedisSnapshotProvider.new(
  #       redis: Redis.new(url: ENV["REDIS_URL"]),
  #       key_prefix: "myapp:toggly"
  #     )
  #   end
  module Cache
    class << self
      # Create a Redis snapshot provider with sensible defaults
      #
      # @param redis [Redis, ConnectionPool] Redis client or connection pool
      # @param options [Hash] Additional options
      # @return [RedisSnapshotProvider]
      def redis_provider(redis:, **options)
        RedisSnapshotProvider.new(redis: redis, **options)
      end
    end
  end
end
