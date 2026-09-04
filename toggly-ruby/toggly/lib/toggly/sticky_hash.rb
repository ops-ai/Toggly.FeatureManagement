# frozen_string_literal: true

require "digest"
require "securerandom"

module Toggly
  # Sticky percentage bucketing aligned with Definitions / toggly-eval.
  module StickyHash
    module_function

    # Sticky bucket in [0, 100) matching Definitions / toggly-eval SHA-256.
    #
    # Hash input is +feature_key+ + "\n" + +user_id+; little-endian uint32 from
    # the first 4 digest bytes, then +(value / 0xFFFFFFFF) * 100+.
    #
    # @param user_id [String]
    # @param feature_key [String]
    # @return [Float]
    def compute_percentile(user_id, feature_key)
      digest = Digest::SHA256.digest("#{feature_key}\n#{user_id}")
      value = digest.byteslice(0, 4).unpack1("V")
      (value.to_f / 0xFFFFFFFF) * 100.0
    end

    # Percentage gate for segment filters; missing or ≤0 fails closed.
    #
    # @param percentage [Numeric, nil]
    # @param feature_key [String]
    # @param identity [String, nil]
    # @return [Boolean]
    def segment_percentage_passes?(percentage, feature_key, identity)
      return false if percentage.nil? || percentage <= 0
      return true if percentage >= 100
      return compute_percentile(identity, feature_key) < percentage if identity && !identity.empty?

      SecureRandom.random_number * 100 < percentage
    end
  end
end
