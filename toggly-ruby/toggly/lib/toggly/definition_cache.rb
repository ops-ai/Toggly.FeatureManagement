# frozen_string_literal: true

module Toggly
  # Shared definition-refresh cache helpers (hit/miss classification).
  module DefinitionCache
    module_function

    # Normalize an ETag/revision for comparison (strip weak prefix + quotes).
    #
    # @param etag [String, nil]
    # @return [String, nil]
    def normalize_etag(etag)
      return nil if etag.nil?

      trimmed = etag.to_s.strip
      return nil if trimmed.empty?

      trimmed = trimmed[2..].to_s.strip if trimmed.length >= 2 && %w[W w].include?(trimmed[0]) && trimmed[1] == "/"
      return trimmed[1...-1] if trimmed.length >= 2 && trimmed.start_with?('"') && trimmed.end_with?('"')

      trimmed
    end

    # @param left [String, nil]
    # @param right [String, nil]
    # @return [Boolean]
    def etags_match?(left, right)
      a = normalize_etag(left)
      b = normalize_etag(right)
      !a.nil? && !b.nil? && a == b
    end

    # @param left [String, nil]
    # @param right [String, nil]
    # @return [Boolean]
    def last_modified_match?(left, right)
      a = left&.to_s&.strip
      b = right&.to_s&.strip
      !a.nil? && !b.nil? && !a.empty? && a == b
    end

    # Match Go isCachedRevision: currentTS > 0 && incomingTS <= currentTS → hit.
    #
    # @param current_ts [Integer, nil]
    # @param incoming_ts [Integer, nil]
    # @return [Boolean]
    def cached_signed_timestamp?(current_ts, incoming_ts)
      return false if incoming_ts.nil?

      current = current_ts.to_i
      incoming = incoming_ts.to_i
      current.positive? && incoming <= current
    end

    # Classify an HTTP definitions response for cache telemetry.
    #
    # @param status_code [Integer]
    # @param existing_etag [String, nil]
    # @param response_etag [String, nil]
    # @param existing_last_modified [String, nil]
    # @param response_last_modified [String, nil]
    # @return [Symbol] :not_modified, :same_revision, :new_content, or :error_status
    def classify_http(
      status_code,
      existing_etag,
      response_etag,
      existing_last_modified: nil,
      response_last_modified: nil
    )
      return :not_modified if status_code == 304
      return :error_status if status_code != 200
      return :same_revision if etags_match?(existing_etag, response_etag)
      return :same_revision if last_modified_match?(existing_last_modified, response_last_modified)

      :new_content
    end
  end
end
