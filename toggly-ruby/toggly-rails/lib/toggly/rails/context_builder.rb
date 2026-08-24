# frozen_string_literal: true

module Toggly
  module Rails
    # Builds evaluation context from Rails request and user.
    #
    # Extracts identity, groups, and traits from the current request
    # and authenticated user.
    class ContextBuilder
      # @param config [Configuration] Rails configuration
      def initialize(config)
        @config = config
      end

      # Build context from request and user
      #
      # @param request [ActionDispatch::Request, nil] Current request
      # @param user [Object, nil] Current authenticated user
      # @return [Toggly::Context]
      def build(request: nil, user: nil)
        identity = extract_identity(user)
        groups = extract_groups(user)
        traits = extract_traits(request, user)

        Toggly::Context.new(
          identity: identity,
          groups: groups,
          traits: traits,
          entity: extract_entity(request, user)
        )
      end

      private

      def extract_entity(request, user)
        return request.env["toggly.entity"] if request.respond_to?(:env) && request.env["toggly.entity"]
        return user.toggly_entity if user.respond_to?(:toggly_entity)

        nil
      end

      def extract_identity(user)
        return nil unless user
        return unless @config.identity_method && user.respond_to?(@config.identity_method)

        user.public_send(@config.identity_method)&.to_s
      end

      def extract_groups(user)
        return [] unless user && @config.groups_method
        return [] unless user.respond_to?(@config.groups_method)

        Array(user.public_send(@config.groups_method)).map(&:to_s)
      end

      def extract_traits(request, user)
        traits = {}

        # Add default request traits
        if request
          traits["request_ip"] = request.remote_ip if request.respond_to?(:remote_ip)
          traits["user_agent"] = request.user_agent if request.respond_to?(:user_agent)
          traits["locale"] = I18n.locale.to_s if defined?(I18n)
        end

        # Add custom trait extractors
        @config.trait_extractors.each do |name, extractor|
          value = extractor.call(request, user)
          traits[name.to_s] = value unless value.nil?
        rescue StandardError
          # Ignore errors in trait extraction
        end

        traits
      end
    end
  end
end
