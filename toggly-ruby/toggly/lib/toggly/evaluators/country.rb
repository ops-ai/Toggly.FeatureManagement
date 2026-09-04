# frozen_string_literal: true

module Toggly
  module Evaluators
    # Evaluator for Country / CountryFamily segment filters.
    class Country < Base
      def self.type
        "Country"
      end

      def self.aliases
        %w[CountryFamily]
      end

      def evaluate(rule, context, feature_key: nil)
        percentage = SegmentHelpers.as_float(rule, "Percentage")
        identity = context&.identity
        return false unless StickyHash.segment_percentage_passes?(percentage, feature_key.to_s, identity)

        values = SegmentHelpers.collect_indexed_values(rule, "Country")
        return false if values.empty?

        country = context&.request&.country
        return false if country.nil? || country.empty?

        values.any? { |value| SegmentHelpers.equals_ignore_case?(value, country) }
      end
    end
  end
end
