# frozen_string_literal: true

module Toggly
  # Evaluation context containing user identity, groups, and traits.
  #
  # @example
  #   context = Toggly::Context.new(
  #     identity: "user-123",
  #     groups: ["beta-testers", "premium"],
  #     traits: { country: "US", plan: "enterprise" }
  #   )
  class Context
    # @return [String, nil] User identity for percentage rollouts and targeting
    # identity, groups, traits, and optional entity for ContextProperty filters
    attr_reader :identity, :groups, :traits, :entity

    def initialize(identity: nil, groups: [], traits: {}, entity: nil)
      @identity = identity&.to_s
      @groups = Array(groups).map(&:to_s)
      @traits = normalize_traits(traits)
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
        entity: @entity
      )
    end

    # Convert to hash for serialization
    #
    # @return [Hash]
    def to_h
      {
        identity: @identity,
        groups: @groups,
        traits: @traits
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
        @traits == other.traits
    end
    alias eql? ==

    # Hash code for use in collections
    #
    # @return [Integer]
    def hash
      [@identity, @groups.sort, @traits].hash
    end

    # Generate cache key
    #
    # @return [String]
    def cache_key
      "#{@identity}:#{@groups.sort.join(",")}:#{traits_cache_key}"
    end

    private

    def normalize_traits(traits)
      return {} unless traits.is_a?(Hash)

      traits.transform_keys(&:to_s)
    end

    def traits_cache_key
      @traits.sort.map { |k, v| "#{k}=#{v}" }.join(",")
    end
  end
end
