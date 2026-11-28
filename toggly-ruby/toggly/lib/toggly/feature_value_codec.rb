# frozen_string_literal: true

require "json"
require "time"

module Toggly
  # Soft-decodes a resolved feature's value by its declared catalog
  # +value_type+ (OPS-2102).
  #
  # Mirrors the wire contract used across Toggly SDKs: a feature definition
  # may carry a +valueType+ of +"boolean" | "string" | "number" | "json" |
  # "datetime"+. These helpers never raise solely for a shape mismatch and
  # never return a wrong-typed value — they soft-null (+nil+) on a missing
  # feature, a disabled flag, a declared-type mismatch, or a decode failure.
  #
  # Legacy catalogs without a declared +value_type+ (a +nil+ +declared+
  # argument) still attempt the decode so older flags keep working; the
  # decode itself is still soft-null on failure.
  module FeatureValueCodec
    # Recognized wire +valueType+ strings.
    FEATURE_VALUE_TYPES = %w[boolean string number json datetime].freeze

    class << self
      # Returns whether +value+ is a recognized FeatureValueType string.
      #
      # @param value [Object]
      # @return [Boolean]
      def feature_value_type?(value)
        FEATURE_VALUE_TYPES.include?(value)
      end

      # Returns whether a typed getter for +requested+ may attempt a decode
      # against +declared+.
      #
      # A missing/blank +declared+ (legacy catalogs predating +valueType+)
      # always allows the decode attempt; the decode itself still soft-nulls
      # on failure.
      #
      # @param declared [String, nil]
      # @param requested [String]
      # @return [Boolean]
      def value_type_matches?(declared, requested)
        return true if declared.nil? || declared == ""

        declared == requested
      end

      # Soft-decodes +raw+ as a +String+, or +nil+ on mismatch/non-string input.
      #
      # @param raw [Object]
      # @param declared [String, nil]
      # @return [String, nil]
      def decode_string_value(raw, declared = nil)
        return nil unless value_type_matches?(declared, "string")

        raw.is_a?(String) ? raw : nil
      end

      # Soft-decodes +raw+ as a finite +Float+, or +nil+ on mismatch/failure.
      # +true+/+false+ are never treated as numbers.
      #
      # @param raw [Object]
      # @param declared [String, nil]
      # @return [Float, nil]
      def decode_number_value(raw, declared = nil)
        return nil unless value_type_matches?(declared, "number")

        case raw
        when Numeric
          value = raw.to_f
          value.finite? ? value : nil
        when String
          decode_numeric_string(raw)
        end
      end

      # Soft-decodes +raw+ as a JSON object/array value tree (+Hash+/+Array+),
      # or +nil+ on mismatch/undecodable input.
      #
      # @param raw [Object]
      # @param declared [String, nil]
      # @return [Hash, Array, nil]
      def decode_json_value(raw, declared = nil)
        return nil unless value_type_matches?(declared, "json")
        return nil if raw.nil?

        case raw
        when Hash, Array
          raw
        when String
          decode_json_string(raw)
        end
      end

      # Soft-decodes +raw+ as a +Time+ parsed from an ISO-8601 string.
      #
      # Soft-nulls on a non-ISO-8601 string, non-string/Time input, or a
      # declared-type mismatch.
      #
      # @param raw [Object]
      # @param declared [String, nil]
      # @return [Time, nil]
      def decode_datetime_value(raw, declared = nil)
        return nil unless value_type_matches?(declared, "datetime")

        case raw
        when Time
          raw
        when String
          decode_datetime_string(raw)
        end
      end

      private

      def decode_numeric_string(raw)
        trimmed = raw.strip
        return nil if trimmed.empty?

        value = Float(trimmed)
        value.finite? ? value : nil
      rescue ArgumentError, TypeError
        nil
      end

      def decode_json_string(raw)
        trimmed = raw.strip
        return nil if trimmed.empty?

        parsed = JSON.parse(trimmed)
        parsed.is_a?(Hash) || parsed.is_a?(Array) ? parsed : nil
      rescue JSON::ParserError
        nil
      end

      def decode_datetime_string(raw)
        trimmed = raw.strip
        return nil if trimmed.empty?

        Time.parse(trimmed)
      rescue ArgumentError
        nil
      end
    end
  end
end
