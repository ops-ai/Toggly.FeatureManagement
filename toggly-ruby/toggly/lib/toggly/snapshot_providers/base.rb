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
    end
  end
end
