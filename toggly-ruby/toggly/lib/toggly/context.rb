# frozen_string_literal: true

module Toggly
  # Evaluation context containing user identity, groups, claims, request, and traits.
  #
  # @example
  #   context = Toggly::Context.new(
  #     identity: "user-123",
  #     groups: ["beta-testers", "premium"],
  #     claims: { "role" => "admin" },
  #     request: Toggly::RequestContext.new(country: "US"),
  #     traits: { plan: "enterprise" }
  #   )
  class Context
    # @return [String, nil] User identity for percentage rollouts and targeting
    # @return [Array<String>] Audience groups
    # @return [Hash{String => Object}] Legacy/custom traits
    # @return [Hash{String => String}] Principal claims for UserClaims filters
    # @return [RequestContext, nil] HTTP request fields for segment filters
    # @return [EntityContext, nil] Optional entity for ContextProperty filters
    attr_reader :identity, :groups, :traits, :claims, :request, :entity

    def initialize(identity: nil, groups: [], traits: {}, claims: {}, request: nil, entity: nil)
      @identity = identity&.to_s
      @groups = Array(groups).map(&:to_s)
      @traits = normalize_traits(traits)
      @claims = normalize_claims(claims)
      @request = coerce_request(request)
      @entity = entity
    end

    # Create a context with just an identity
    #
    # @param identity [String] User identity
    # @return [Context]
    def self.with_identity(identity)
      new(identity: identity)
    end

    # Create an empty/anonymous context
    #
    # @return [Context]
    def self.anonymous
      new
    end

    # Create from a hash (EvalContext / fixture style).
    #
    # @param data [Hash]
    # @return [Context]
    def self.from_hash(data)
      return anonymous unless data.is_a?(Hash)

      entity_data = data["entity"] || data[:entity]
      entity = nil
      if entity_data.is_a?(Hash)
        entity = EntityContext.new(
          kind: entity_data["kind"] || entity_data[:kind],
          key: entity_data["key"] || entity_data[:key],
          attributes: entity_data["attributes"] || entity_data[:attributes] || {}
        )
      end

      new(
        identity: data["identity"] || data[:identity],
        groups: data["groups"] || data[:groups] || [],
        traits: data["traits"] || data[:traits] || {},
        claims: data["claims"] || data[:claims] || {},
        request: RequestContext.from_hash(data["request"] || data[:request]),
        entity: entity
      )
    end

    # Check if context has an identity
    #
    # @return [Boolean]
    def identity?
      !@identity.nil? && !@identity.empty?
    end

    # Check if user is in a specific group
    #
    # @param group [String, Symbol] Group name
    # @return [Boolean]
    def in_group?(group)
      @groups.include?(group.to_s)
    end

    # Get a trait value
    #
    # @param key [String, Symbol] Trait key
    # @return [Object, nil]
    def trait(key)
      @traits[key.to_s]
    end
    alias [] trait

    # Check if a trait exists
    #
    # @param key [String, Symbol] Trait key
    # @return [Boolean]
    def trait?(key)
      @traits.key?(key.to_s)
    end

    # Create a new context with additional traits
    #
    # @param new_traits [Hash] Traits to add
    # @return [Context]
    def with_traits(new_traits)
      Context.new(
        identity: @identity,
        groups: @groups,
        traits: @traits.merge(normalize_traits(new_traits)),
        claims: @claims,
        request: @request,
        entity: @entity
      )
    end

    # Create a new context with additional groups
    #
    # @param new_groups [Array<String>] Groups to add
    # @return [Context]
    def with_groups(*new_groups)
      Context.new(
        identity: @identity,
        groups: @groups + new_groups.flatten.map(&:to_s),
        traits: @traits,
        claims: @claims,
        request: @request,
        entity: @entity
      )
    end

    # Create a new context with the specified claims map.
    #
    # @param new_claims [Hash]
    # @return [Context]
    def with_claims(new_claims)
      Context.new(
        identity: @identity,
        groups: @groups,
        traits: @traits,
        claims: new_claims,
        request: @request,
        entity: @entity
      )
    end

    # Create a new context with the specified request fields.
    #
    # @param new_request [RequestContext, Hash, nil]
    # @return [Context]
    def with_request(new_request)
      Context.new(
        identity: @identity,
        groups: @groups,
        traits: @traits,
        claims: @claims,
        request: new_request,
        entity: @entity
      )
    end

    # Create a new context with the specified entity.
    #
    # @param new_entity [EntityContext, nil]
    # @return [Context]
    def with_entity(new_entity)
      Context.new(
        identity: @identity,
        groups: @groups,
        traits: @traits,
        claims: @claims,
        request: @request,
        entity: new_entity
      )
    end

    # Convert to hash for serialization
    #
    # @return [Hash]
    def to_h
      entity_hash =
        if @entity.nil?
          nil
        else
          {
            kind: @entity.kind,
            key: @entity.key,
            attributes: @entity.attributes
          }
        end

      {
        identity: @identity,
        groups: @groups,
        traits: @traits,
        claims: @claims,
        request: @request&.to_h,
        entity: entity_hash
      }
    end

    # Check equality
    #
    # @param other [Context]
    # @return [Boolean]
    def ==(other)
      return false unless other.is_a?(Context)

      @identity == other.identity &&
        @groups.sort == other.groups.sort &&
        @traits == other.traits &&
        @claims == other.claims &&
        @request == other.request &&
        @entity == other.entity
    end
    alias eql? ==

    # Hash code for use in collections
    #
    # @return [Integer]
    def hash
      [@identity, @groups.sort, @traits, @claims, @request, @entity].hash
    end

    # Generate cache key
    #
    # @return [String]
    def cache_key
      "#{@identity}:#{@groups.sort.join(",")}:#{traits_cache_key}:#{claims_cache_key}:#{request_cache_key}"
    end

    private

    def normalize_traits(traits)
      return {} unless traits.is_a?(Hash)

      traits.transform_keys(&:to_s)
    end

    def normalize_claims(claims)
      return {} unless claims.is_a?(Hash)

      claims.each_with_object({}) do |(key, value), memo|
        memo[key.to_s] = value.to_s
      end
    end

    def coerce_request(request)
      return nil if request.nil?
      return request if request.is_a?(RequestContext)

      RequestContext.from_hash(request)
    end

    def traits_cache_key
      @traits.sort.map { |k, v| "#{k}=#{v}" }.join(",")
    end

    def claims_cache_key
      @claims.sort.map { |k, v| "#{k}=#{v}" }.join(",")
    end

    def request_cache_key
      return "" unless @request

      "#{@request.user_agent}|#{@request.accept_language}|#{@request.country}"
    end
  end
end
