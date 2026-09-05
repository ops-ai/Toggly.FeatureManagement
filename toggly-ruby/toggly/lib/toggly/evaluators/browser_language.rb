# frozen_string_literal: true

module Toggly
  module Evaluators
    # Evaluator for BrowserLanguage segment filters.
    class BrowserLanguage < Base
      def self.type
        "BrowserLanguage"
      end

      def evaluate(rule, context, feature_key: nil)
        percentage = SegmentHelpers.as_float(rule, "Percentage")
        identity = context&.identity
        return false unless StickyHash.segment_percentage_passes?(percentage, feature_key.to_s, identity)

        values = SegmentHelpers.collect_indexed_values(rule, "BrowserLanguage")
        return false if values.empty?

        accept = context&.request&.accept_language
        return false if accept.nil? || accept.empty?

        values.any? { |value| SegmentHelpers.contains_ignore_case?(accept, value) }
      end
    end
  end
end
