# frozen_string_literal: true

module Toggly
  module Rails
    # Snapshot provider that uses Rails.cache.
    #
    # Stores feature definitions in the Rails cache store
    # for persistence and sharing across processes.
    class CacheSnapshotProvider < Toggly::SnapshotProviders::Base
      # @param key_prefix [String] Cache key prefix
      # @param expires_in [Integer, nil] Cache expiration in seconds (nil = no expiration)
      def initialize(key_prefix: "toggly", expires_in: nil)
        @key_prefix = key_prefix
        @expires_in = expires_in
      end

      # Save definitions to Rails cache
      #
      # @param definitions [Hash<String, FeatureDefinition>] Definitions
      # @param metadata [Hash] Optional metadata
      def save(definitions, metadata = {})
        data = {
          definitions: serialize_definitions(definitions),
          metadata: metadata.merge(saved_at: Time.now.utc.iso8601)
        }

        cache_options = {}
        cache_options[:expires_in] = @expires_in if @expires_in

        ::Rails.cache.write(cache_key, data, **cache_options)
      end

      # Load definitions from Rails cache
      #
      # @return [Hash, nil] Hash with :definitions and :metadata
      def load
        data = ::Rails.cache.read(cache_key)
        return nil unless data

        {
          definitions: deserialize_definitions(data[:definitions]),
          metadata: data[:metadata] || {}
        }
      end

      # Clear the cached snapshot
      def clear
        ::Rails.cache.delete(cache_key)
      end

      # Check if snapshot exists in cache
      #
      # @return [Boolean]
      def exists?
        ::Rails.cache.exist?(cache_key)
      end

      private

      def cache_key
        "#{@key_prefix}:snapshot"
      end
    end
  end
end
