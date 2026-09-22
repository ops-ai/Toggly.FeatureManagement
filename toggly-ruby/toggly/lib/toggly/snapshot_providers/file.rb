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

      # @return [String] Path to the evaluated-variants snapshot file (dual-rail)
      attr_reader :variants_path

      # @param path [String] Path to the snapshot file
      def initialize(path:)
        super()
        @path = path
        @variants_path = derive_variants_path(path)
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
          FileUtils.rm_f(@path)
          FileUtils.rm_f(@variants_path)
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

      # Save evaluated variants to file using atomic write (dual-rail)
      #
      # @param variants [Hash<String, EvaluatedVariantDef>] Variants
      # @param metadata [Hash] Optional metadata
      def save_variants(variants, metadata = {})
        @mutex.synchronize do
          ensure_directory_exists

          data = {
            "variants" => serialize_variants(variants),
            "metadata" => metadata.merge("saved_at" => Time.now.utc.iso8601)
          }

          temp_path = "#{@variants_path}.tmp"
          ::File.write(temp_path, JSON.pretty_generate(data))
          ::File.rename(temp_path, @variants_path)
        end
      rescue StandardError => e
        raise SnapshotError, "Failed to save variants snapshot: #{e.message}"
      end

      # Load evaluated variants from file (dual-rail)
      #
      # @return [Hash, nil] Hash with :variants and :metadata
      def load_variants
        @mutex.synchronize do
          return nil unless ::File.exist?(@variants_path)

          content = ::File.read(@variants_path)
          data = JSON.parse(content)

          {
            variants: deserialize_variants(data["variants"]),
            metadata: symbolize_keys(data["metadata"] || {})
          }
        end
      rescue JSON::ParserError => e
        raise SnapshotError, "Failed to parse variants snapshot: #{e.message}"
      rescue StandardError => e
        raise SnapshotError, "Failed to load variants snapshot: #{e.message}"
      end

      private

      def ensure_directory_exists
        dir = ::File.dirname(@path)
        FileUtils.mkdir_p(dir) unless ::File.directory?(dir)
      end

      def derive_variants_path(path)
        dir = ::File.dirname(path)
        ext = ::File.extname(path)
        base = ::File.basename(path, ext)
        ::File.join(dir, "#{base}_variants#{ext}")
      end

      def symbolize_keys(hash)
        return {} unless hash.is_a?(Hash)

        hash.transform_keys(&:to_sym)
      end
    end
  end
end
