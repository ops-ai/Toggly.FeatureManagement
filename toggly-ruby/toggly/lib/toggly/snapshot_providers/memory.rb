# frozen_string_literal: true

module Toggly
  module SnapshotProviders
    # In-memory snapshot provider.
    #
    # Useful for testing or when persistence is not needed.
    class Memory < Base
      def initialize
        super
        @data = nil
        @variants_data = nil
        @mutex = Mutex.new
      end

      # Save definitions to memory
      #
      # @param definitions [Hash<String, FeatureDefinition>] Definitions
      # @param metadata [Hash] Optional metadata
      def save(definitions, metadata = {})
        @mutex.synchronize do
          @data = {
            definitions: serialize_definitions(definitions),
            metadata: metadata.merge(saved_at: Time.now.utc.iso8601)
          }
        end
      end

      # Load definitions from memory
      #
      # @return [Hash, nil] Hash with :definitions and :metadata
      def load
        @mutex.synchronize do
          return nil unless @data

          {
            definitions: deserialize_definitions(@data[:definitions]),
            metadata: @data[:metadata]
          }
        end
      end

      # Clear the snapshot
      def clear
        @mutex.synchronize do
          @data = nil
          @variants_data = nil
        end
      end

      # Check if snapshot exists
      #
      # @return [Boolean]
      def exists?
        @mutex.synchronize do
          !@data.nil?
        end
      end

      # Save evaluated variants to memory (dual-rail)
      #
      # @param variants [Hash<String, EvaluatedVariantDef>] Variants
      # @param metadata [Hash] Optional metadata
      def save_variants(variants, metadata = {})
        @mutex.synchronize do
          @variants_data = {
            variants: serialize_variants(variants),
            metadata: metadata.merge(saved_at: Time.now.utc.iso8601)
          }
        end
      end

      # Load evaluated variants from memory (dual-rail)
      #
      # @return [Hash, nil] Hash with :variants and :metadata
      def load_variants
        @mutex.synchronize do
          return nil unless @variants_data

          {
            variants: deserialize_variants(@variants_data[:variants]),
            metadata: @variants_data[:metadata]
          }
        end
      end
    end
  end
end
