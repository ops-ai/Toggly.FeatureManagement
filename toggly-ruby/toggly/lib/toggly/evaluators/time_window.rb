# frozen_string_literal: true

module Toggly
  module Evaluators
    # Evaluator for time-based feature windows.
    #
    # Enables features within a specific time range.
    class TimeWindow < Base
      def self.type
        "time_window"
      end

      # Evaluate time window rule
      #
      # @param rule [Hash] Rule with "startTime"/"start_time" and/or "endTime"/"end_time"
      # @param context [Context] Evaluation context (ignored)
      # @param feature_key [String] The feature key
      # @return [Boolean] True if current time is within window
      def evaluate(rule, context, feature_key: nil)
        now = Time.now.utc

        start_time = parse_time(
          rule_value(rule, "startTime") || rule_value(rule, "start_time")
        )
        end_time = parse_time(
          rule_value(rule, "endTime") || rule_value(rule, "end_time")
        )

        # No time constraints means always valid
        return true if start_time.nil? && end_time.nil?

        # Check start time
        return false if start_time && now < start_time

        # Check end time
        return false if end_time && now > end_time

        true
      end

      private

      def parse_time(value)
        return nil if value.nil?
        return value if value.is_a?(Time)

        Time.parse(value.to_s).utc
      rescue ArgumentError
        nil
      end
    end
  end
end
