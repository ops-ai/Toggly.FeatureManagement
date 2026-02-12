# frozen_string_literal: true

module Toggly
  module Evaluators
    # Evaluator for percentage-based rollouts.
    #
    # Uses FNV-1a hash for consistent bucketing based on
    # feature key and user identity.
    class Percentage < Base
      # FNV-1a hash constants (32-bit)
      FNV_PRIME = 0x01000193
      FNV_OFFSET_BASIS = 0x811c9dc5

      def self.type
        "percentage"
      end

      # Evaluate percentage rollout
      #
      # @param rule [Hash] Rule with "percentage" or "value" key (0-100)
      # @param context [Context] Evaluation context with identity
      # @param feature_key [String] The feature key
      # @return [Boolean] True if user falls within percentage
      def evaluate(rule, context, feature_key: nil)
        percentage = rule_value(rule, "percentage") ||
                     rule_value(rule, "value") ||
                     0

        percentage = percentage.to_f

        # 0% always off, 100% always on
        return false if percentage <= 0
        return true if percentage >= 100

        # Need identity for percentage rollouts
        return false unless context&.identity?

        # Calculate bucket using FNV-1a hash
        bucket_key = "#{feature_key}:#{context.identity}"
        bucket = calculate_bucket(bucket_key)

        bucket < percentage
      end

      private

      # Calculate bucket (0-100) using FNV-1a hash
      #
      # @param key [String] The key to hash
      # @return [Float] Bucket value 0-100
      def calculate_bucket(key)
        hash = fnv1a_hash(key)
        (hash % 10_000) / 100.0
      end

      # FNV-1a hash implementation
      #
      # @param data [String] Data to hash
      # @return [Integer] 32-bit hash value
      def fnv1a_hash(data)
        hash = FNV_OFFSET_BASIS

        data.each_byte do |byte|
          hash ^= byte
          hash = (hash * FNV_PRIME) & 0xFFFFFFFF
        end

        hash
      end
    end
  end
end
