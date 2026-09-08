# frozen_string_literal: true

module Toggly
  class Client
    # Definition-refresh cache hit/miss recording for usage telemetry.
    module CacheTelemetry
      private

      def record_refresh_cache_outcome(outcome)
        if outcome == :miss
          record_definition_cache_miss
        else
          record_definition_cache_hit
        end
      end

      def record_definition_cache_hit
        return unless @telemetry&.usage_enabled?

        @telemetry.record_definition_cache_hit
      end

      def record_definition_cache_miss
        return unless @telemetry&.usage_enabled?

        @telemetry.record_definition_cache_miss
      end

      def definitions_cached?
        @mutex.synchronize { !@definitions.empty? }
      end
    end
  end
end
