# frozen_string_literal: true

module Toggly
  module Evaluators
    # Evaluator for OS / OperatingSystem segment filters.
    class OperatingSystem < Base
      def self.type
        "OperatingSystem"
      end

      def self.aliases
        %w[OS]
      end

      def evaluate(rule, context, feature_key: nil)
        percentage = SegmentHelpers.as_float(rule, "Percentage")
        identity = context&.identity
        return false unless StickyHash.segment_percentage_passes?(percentage, feature_key.to_s, identity)

        values = SegmentHelpers.collect_indexed_values(rule, "OperatingSystem")
        return false if values.empty?

        ua = context&.request&.user_agent
        parsed = UserAgentParser.parse(ua)
        return false if parsed.nil? || parsed.os_family == "Other"

        values.any? { |value| SegmentHelpers.contains_ignore_case?(parsed.os_family, value) }
      end
    end
  end
end
