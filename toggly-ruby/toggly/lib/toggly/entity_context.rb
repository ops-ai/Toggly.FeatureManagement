# frozen_string_literal: true

require "json"
require "net/http"
require "uri"

module Toggly
  EntityContext = Struct.new(:kind, :key, :attributes, keyword_init: true) do
    def attribute(name)
      return nil unless attributes.is_a?(Hash)

      return attributes[name] if attributes.key?(name)
      return attributes[name.to_s] if attributes.key?(name.to_s)

      attributes.each { |k, v| return v if k.to_s.casecmp?(name.to_s) }
      nil
    end

    def attribute?(name)
      return false unless attributes.is_a?(Hash)

      attributes.key?(name) || attributes.key?(name.to_s) ||
        attributes.keys.any? { |k| k.to_s.casecmp?(name.to_s) }
    end
  end

  EntityContextPropertySchema = Struct.new(:name, :type, keyword_init: true)
  EntityContextSchemaRegistration = Struct.new(:kind, :key_property, :display_name, :properties, keyword_init: true)

  @entity_mappers = {}
  @entity_schemas = {}
  @entity_mutex = Mutex.new

  class << self
    def register_context(kind, schema: nil, &mapper)
      @entity_mutex.synchronize do
        @entity_mappers[kind] = mapper if mapper
        if schema
          schema.kind = kind
          schema.display_name ||= kind
          @entity_schemas[kind] = schema
        end
      end
    end

    def map_entity(kind, entity)
      mapper = @entity_mutex.synchronize { @entity_mappers[kind] }
      return nil unless mapper

      mapper.call(entity)
    end

    def entity_schemas
      @entity_mutex.synchronize { @entity_schemas.values.dup }
    end

    def clear_entity_context_registrations
      @entity_mutex.synchronize do
        @entity_mappers.clear
        @entity_schemas.clear
      end
    end

    def register_entity_contexts_at_startup(config)
      return if config.respond_to?(:disable_entity_context_registration) && config.disable_entity_context_registration
      return if config.app_key.nil? || config.app_key.empty?

      regs = entity_schemas
      return if regs.empty?

      payload = {
        contexts: regs.map do |r|
          {
            kind: r.kind,
            keyProperty: r.key_property,
            displayName: r.display_name || r.kind,
            properties: Array(r.properties).map { |p| { name: p.name, type: p.type } }
          }
        end
      }
      uri = URI.join(config.base_url.end_with?("/") ? config.base_url : "#{config.base_url}/", "sdk/#{config.app_key}/contexts")
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = uri.scheme == "https"
      http.open_timeout = config.http_timeout || 10
      http.read_timeout = config.http_timeout || 10
      req = Net::HTTP::Put.new(uri)
      req["Content-Type"] = "application/json"
      req.body = JSON.generate(payload)
      http.request(req)
    rescue StandardError
      nil
    end
  end
end
