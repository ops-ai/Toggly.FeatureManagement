# frozen_string_literal: true

module Toggly
  class Client
    # Durable snapshot load/save helpers for Client. Dual-rail: persists
    # `definitions` or `variant_defs` depending on `config.enable_variants`,
    # each rail using its own on-disk/provider-side storage.
    module SnapshotSupport
      private

      # @return [Boolean] true when a durable snapshot was applied into memory
      def load_snapshot
        return false unless @config.snapshot_provider

        if @config.enable_variants
          load_variants_snapshot
        else
          load_definitions_snapshot
        end
      rescue StandardError => e
        log_warn("Failed to load snapshot: #{e.message}")
        false
      end

      def save_snapshot
        return unless @config.snapshot_provider

        if @config.enable_variants
          @config.snapshot_provider.save_variants(@variant_defs)
          log_debug("Saved variants snapshot with #{@variant_defs.size} features")
        else
          @config.snapshot_provider.save(@definitions)
          log_debug("Saved snapshot with #{@definitions.size} features")
        end
      rescue StandardError => e
        log_warn("Failed to save snapshot: #{e.message}")
      end

      def load_definitions_snapshot
        data = @config.snapshot_provider.load
        return false unless data

        @mutex.synchronize do
          @definitions = data[:definitions]
          @definitions_loaded = true
        end

        log_debug("Loaded #{@definitions.size} features from snapshot")
        true
      end

      def load_variants_snapshot
        return false unless @config.snapshot_provider.respond_to?(:load_variants)

        data = @config.snapshot_provider.load_variants
        return false unless data

        @mutex.synchronize do
          @variant_defs = data[:variants] || {}
          @definitions_loaded = true
        end

        log_debug("Loaded #{@variant_defs.size} evaluated variants from snapshot")
        true
      end
    end
  end
end
