# frozen_string_literal: true

require "json"
require "fileutils"

module Toggly
  module SnapshotProviders
    # File-based snapshot provider.
    #
    # Persists feature definitions to a JSON file.
    class File < Base
      # @return [String] Path to the snapshot file
      attr_reader :path

      # @param path [String] Path to the snapshot file
      def initialize(path:)
        @path = path
        @mutex = Mutex.new
      end

      # Save definitions to file
      #
      # @param definitions [Hash<String, FeatureDefinition>] Definitions
      # @param metadata [Hash] Optional metadata
      def save(definitions, metadata = {})
        @mutex.synchronize do
          ensure_directory_exists

          data = {
            "definitions" => serialize_definitions(definitions),
            "metadata" => metadata.merge("saved_at" => Time.now.utc.iso8601)
          }

          # Write to temp file first, then rename (atomic operation)
          temp_path = "#{@path}.tmp"
          ::File.write(temp_path, JSON.pretty_generate(data))
          ::File.rename(temp_path, @path)
        end
      rescue StandardError => e
        raise SnapshotError, "Failed to save snapshot: #{e.message}"
      end

      # Load definitions from file
      #
      # @return [Hash, nil] Hash with :definitions and :metadata
      def load
        @mutex.synchronize do
          return nil unless ::File.exist?(@path)

          content = ::File.read(@path)
          data = JSON.parse(content)

          {
            definitions: deserialize_definitions(data["definitions"]),
            metadata: symbolize_keys(data["metadata"] || {})
          }
        end
      rescue JSON::ParserError => e
        raise SnapshotError, "Failed to parse snapshot: #{e.message}"
      rescue StandardError => e
        raise SnapshotError, "Failed to load snapshot: #{e.message}"
      end

      # Clear the snapshot file
      def clear
        @mutex.synchronize do
          ::File.delete(@path) if ::File.exist?(@path)
        end
      rescue StandardError => e
        raise SnapshotError, "Failed to clear snapshot: #{e.message}"
      end

      # Check if snapshot file exists
      #
      # @return [Boolean]
      def exists?
        ::File.exist?(@path)
      end

      private

      def ensure_directory_exists
        dir = ::File.dirname(@path)
        FileUtils.mkdir_p(dir) unless ::File.directory?(dir)
      end

      def symbolize_keys(hash)
        return {} unless hash.is_a?(Hash)

        hash.transform_keys(&:to_sym)
      end
    end
  end
end
