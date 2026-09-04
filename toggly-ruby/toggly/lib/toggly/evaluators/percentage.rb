# frozen_string_literal: true

module Toggly
  module Evaluators
    # Evaluator for percentage-based rollouts.
    #
    # Uses Definitions-aligned sticky SHA-256 hashing
    # (+feature_key+ + "\n" + +identity+) for consistent buckets.
    class Percentage < Base
      def self.type
        "Percentage"
      end

      def self.aliases
        %w[Microsoft.Percentage percentage]
      end

      # Evaluate percentage rollout
      #
      # @param rule [Hash] Rule with Percentage / Value params (0-100)
      # @param context [Context] Evaluation context with identity
      # @param feature_key [String] The feature key
      # @return [Boolean] True if user falls within percentage
      def evaluate(rule, context, feature_key: nil)
        percentage = SegmentHelpers.as_float(rule, "Value", "Percentage", "percentage", "value")
        return false if percentage.nil? || percentage <= 0
        return true if percentage >= 100
        return false unless context&.identity?

        StickyHash.compute_percentile(context.identity, feature_key.to_s) < percentage
      end
    end
  end
end
