# frozen_string_literal: true

module Toggly
  class Client
    # Durable snapshot load/save helpers for Client. Dual-rail: `definitions`
    # is always persisted/restored (sole source of truth for `enabled?`).
    # `variant_defs` is an additive rail, persisted/restored independently
    # only when `config.enable_variants` is true — it never replaces the
    # definitions snapshot.
    module SnapshotSupport
      private

      # @return [Boolean] true when any durable snapshot rail was applied
      #   into memory (definitions and/or evaluated variants)
      def load_snapshot
        return false unless @config.snapshot_provider

        definitions_loaded = load_definitions_snapshot
        variants_loaded = @config.enable_variants && load_variants_snapshot

        definitions_loaded || variants_loaded
      rescue StandardError => e
        log_warn("Failed to load snapshot: #{e.message}")
        false
      end

      # Persist the definitions rail. Always available regardless of
      # `config.enable_variants` — definitions remain authoritative for
      # `enabled?`.
      def save_definitions_snapshot
        return unless @config.snapshot_provider

        @config.snapshot_provider.save(@definitions)
        log_debug("Saved snapshot with #{@definitions.size} features")
      rescue StandardError => e
        log_warn("Failed to save snapshot: #{e.message}")
      end

      # Persist the evaluated-variants rail. Additive only; called only when
      # `config.enable_variants` is true.
      def save_variants_snapshot
        return unless @config.snapshot_provider

        @config.snapshot_provider.save_variants(@variant_defs)
        log_debug("Saved variants snapshot with #{@variant_defs.size} features")
      rescue StandardError => e
        log_warn("Failed to save variants snapshot: #{e.message}")
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
        end

        log_debug("Loaded #{@variant_defs.size} evaluated variants from snapshot")
        true
      end
    end
  end
end
