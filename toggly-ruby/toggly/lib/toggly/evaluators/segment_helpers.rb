# frozen_string_literal: true

module Toggly
  module Evaluators
    # Shared helpers for Definitions-style segment / claims filters.
    module SegmentHelpers
      module_function

      # @param rule [Hash]
      # @return [Hash]
      def parameters(rule)
        return {} unless rule.is_a?(Hash)

        params = rule["parameters"] || rule[:parameters]
        params.is_a?(Hash) ? params : rule
      end

      # @param rule [Hash]
      # @param keys [Array<String>]
      # @return [Float, nil]
      def as_float(rule, *keys)
        params = parameters(rule)
        keys.each do |key|
          value = lookup(params, key)
          next if value.nil?
          next if [true, false].include?(value)

          begin
            return Float(value)
          rescue ArgumentError, TypeError
            return nil
          end
        end
        nil
      end

      # @param rule [Hash]
      # @param key [String]
      # @return [String, nil]
      def as_string(rule, key)
        value = lookup(parameters(rule), key)
        return nil if value.nil?

        text = value.to_s
        text.empty? ? nil : text
      end

      # Collect indexed RavenDB / legacy colon-prefixed parameter values.
      #
      # @param rule [Hash]
      # @param prefixes [Array<String>]
      # @return [Array<String>]
      def collect_indexed_values(rule, *prefixes)
        params = parameters(rule)
        out = []
        params.each do |key, value|
          next if value.nil?

          key_s = key.to_s
          prefixes.each do |prefix|
            next unless key_s.start_with?("#{prefix}:")

            text = value.to_s
            out << text unless text.empty?
            break
          end
        end
        out
      end

      # @param haystack [String, nil]
      # @param needle [String, nil]
      # @return [Boolean]
      def contains_ignore_case?(haystack, needle)
        return false if haystack.nil? || needle.nil?

        haystack.downcase.include?(needle.downcase)
      end

      # @param left [String, nil]
      # @param right [String, nil]
      # @return [Boolean]
      def equals_ignore_case?(left, right)
        return false if left.nil? || right.nil?

        left.casecmp?(right)
      end

      def lookup(params, key)
        return nil unless params.is_a?(Hash)

        params[key] || params[key.to_s] || params[key.to_sym] ||
          params.find { |k, _| k.to_s.casecmp?(key.to_s) }&.last
      end
      module_function :lookup
    end
  end
end
