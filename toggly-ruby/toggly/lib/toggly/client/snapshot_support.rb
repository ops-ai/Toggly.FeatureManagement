# frozen_string_literal: true

module Toggly
  class Client
    # Durable snapshot load/save helpers for Client.
    module SnapshotSupport
      private

      # @return [Boolean] true when a durable snapshot was applied into memory
      def load_snapshot
        return false unless @config.snapshot_provider

        data = @config.snapshot_provider.load
        return false unless data

        @mutex.synchronize do
          @definitions = data[:definitions]
          @definitions_loaded = true
        end

        log_debug("Loaded #{@definitions.size} features from snapshot")
        true
      rescue StandardError => e
        log_warn("Failed to load snapshot: #{e.message}")
        false
      end

      def save_snapshot
        return unless @config.snapshot_provider

        @config.snapshot_provider.save(@definitions)
        log_debug("Saved snapshot with #{@definitions.size} features")
      rescue StandardError => e
        log_warn("Failed to save snapshot: #{e.message}")
      end
    end
  end
end
