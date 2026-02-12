# frozen_string_literal: true

module Toggly
  module Rails
    # Rack middleware for request-scoped Toggly context.
    #
    # Stores the evaluation context in the request environment
    # for access throughout the request lifecycle.
    class Middleware
      # Environment key for storing the context
      CONTEXT_KEY = "toggly.context"
      USER_KEY = "toggly.current_user"

      def initialize(app)
        @app = app
      end

      def call(env)
        # Clear any existing context at the start of the request
        env.delete(CONTEXT_KEY)
        env.delete(USER_KEY)

        @app.call(env)
      ensure
        # Clean up after request
        env.delete(CONTEXT_KEY)
        env.delete(USER_KEY)
      end

      class << self
        # Get the current context from the request environment
        #
        # @param env [Hash] Rack environment
        # @return [Toggly::Context, nil]
        def context(env)
          env[CONTEXT_KEY]
        end

        # Set the current context in the request environment
        #
        # @param env [Hash] Rack environment
        # @param context [Toggly::Context] Context to set
        # @return [Toggly::Context]
        def set_context(env, context)
          env[CONTEXT_KEY] = context
        end

        # Set the current user for context building
        #
        # @param env [Hash] Rack environment
        # @param user [Object] Current user
        # @return [Object]
        def set_user(env, user)
          env[USER_KEY] = user
        end

        # Get the current user from the request environment
        #
        # @param env [Hash] Rack environment
        # @return [Object, nil]
        def user(env)
          env[USER_KEY]
        end
      end
    end
  end
end
