# frozen_string_literal: true

module Toggly
  module Evaluators
    # Evaluator for UserClaims filters (Claim + Value params).
    class UserClaims < Base
      def self.type
        "UserClaims"
      end

      def evaluate(rule, context, feature_key: nil)
        percentage = SegmentHelpers.as_float(rule, "Percentage")
        identity = context&.identity
        return false unless StickyHash.segment_percentage_passes?(percentage, feature_key.to_s, identity)

        claim_type = SegmentHelpers.as_string(rule, "Claim")
        claim_value = SegmentHelpers.as_string(rule, "Value")
        return false if claim_type.nil? || claim_value.nil? || context.nil?

        claims = context.claims
        return false if claims.nil? || !claims.key?(claim_type)

        claim_value == claims[claim_type]
      end
    end
  end
end
