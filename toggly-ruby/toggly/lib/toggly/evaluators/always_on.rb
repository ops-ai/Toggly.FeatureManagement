# frozen_string_literal: true

module Toggly
  module Evaluators
    # Evaluator that always returns true.
    #
    # Used for features that should be enabled for everyone.
    class AlwaysOn < Base
      def self.type
        "always_on"
      end

      # @param rule [Hash] The rule configuration (ignored)
      # @param context [Context] The evaluation context (ignored)
      # @param feature_key [String] The feature key
      # @return [Boolean] Always returns true
      def evaluate(_rule, _context, feature_key: nil)
        true
      end
    end
  end
end
