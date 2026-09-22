# frozen_string_literal: true

module Toggly
  module SnapshotProviders
    # Base class for snapshot providers.
    #
    # Snapshot providers persist feature definitions for
    # offline access and faster startup.
    class Base
      # Save definitions snapshot
      #
      # @param definitions [Hash<String, FeatureDefinition>] Definitions to save
      # @param metadata [Hash] Optional metadata (e.g., version, timestamp)
      # @raise [NotImplementedError]
      def save(definitions, metadata = {})
        raise NotImplementedError, "Subclass must implement #save"
      end

      # Load definitions snapshot
      #
      # @return [Hash, nil] Hash with :definitions and :metadata, or nil if not found
      # @raise [NotImplementedError]
      def load
        raise NotImplementedError, "Subclass must implement #load"
      end

      # Clear the snapshot
      #
      # @raise [NotImplementedError]
      def clear
        raise NotImplementedError, "Subclass must implement #clear"
      end

      # Check if a snapshot exists
      #
      # @return [Boolean]
      def exists?
        !load.nil?
      rescue StandardError
        false
      end

      # Save evaluated variants snapshot (dual-rail, used when
      # `config.enable_variants` is true). Default: no-op. Override in
      # subclasses to persist variants across restarts.
      #
      # @param variants [Hash<String, EvaluatedVariantDef>] Variants to save
      # @param metadata [Hash] Optional metadata
      def save_variants(_variants, _metadata = {}); end

      # Load evaluated variants snapshot (dual-rail).
      #
      # @return [Hash, nil] Hash with :variants and :metadata, or nil if not available
      def load_variants
        nil
      end

      protected

      # Serialize definitions to a storable format
      #
      # @param definitions [Hash<String, FeatureDefinition>] Definitions
      # @return [Array<Hash>]
      def serialize_definitions(definitions)
        definitions.values.map(&:to_h)
      end

      # Deserialize definitions from stored format
      #
      # @param data [Array<Hash>] Serialized definitions
      # @return [Hash<String, FeatureDefinition>]
      def deserialize_definitions(data)
        return {} unless data.is_a?(Array)

        data.each_with_object({}) do |item, hash|
          definition = FeatureDefinition.from_hash(item)
          hash[definition.feature_key] = definition
        end
      end

      # Serialize evaluated variants to a storable format
      #
      # @param variants [Hash<String, EvaluatedVariantDef>] Variants
      # @return [Hash<String, Hash>]
      def serialize_variants(variants)
        variants.transform_values(&:to_h)
      end

      # Deserialize evaluated variants from stored format
      #
      # @param data [Hash<String, Hash>] Serialized variants
      # @return [Hash<String, EvaluatedVariantDef>]
      def deserialize_variants(data)
        return {} unless data.is_a?(Hash)

        data.each_with_object({}) do |(key, value), hash|
          hash[key.to_s] = EvaluatedVariantDef.from_hash(value)
        end
      end
    end
  end
end
