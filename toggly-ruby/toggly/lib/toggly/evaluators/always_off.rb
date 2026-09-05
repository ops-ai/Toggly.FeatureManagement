# frozen_string_literal: true

module Toggly
  module Evaluators
    # Evaluator that always returns false.
    #
    # Used for features that should be disabled for everyone.
    class AlwaysOff < Base
      def self.type
        "AlwaysOff"
      end

      def self.aliases
        %w[always_off]
      end

      # @param rule [Hash] The rule configuration (ignored)
      # @param context [Context] The evaluation context (ignored)
      # @param feature_key [String] The feature key
      # @return [Boolean] Always returns false
      def evaluate(_rule, _context, feature_key: nil)
        false
      end
    end
  end
end
