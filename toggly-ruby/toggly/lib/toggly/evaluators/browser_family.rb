# frozen_string_literal: true

module Toggly
  module Evaluators
    # Evaluator for BrowserFamily segment filters.
    class BrowserFamily < Base
      def self.type
        "BrowserFamily"
      end

      def evaluate(rule, context, feature_key: nil)
        percentage = SegmentHelpers.as_float(rule, "Percentage")
        identity = context&.identity
        return false unless StickyHash.segment_percentage_passes?(percentage, feature_key.to_s, identity)

        values = SegmentHelpers.collect_indexed_values(rule, "BrowserFamily")
        return false if values.empty?

        ua = context&.request&.user_agent
        parsed = UserAgentParser.parse(ua)
        return false if parsed.nil? || parsed.browser_family == "Other"

        values.any? { |value| SegmentHelpers.contains_ignore_case?(parsed.browser_family, value) }
      end
    end
  end
end
