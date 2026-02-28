# frozen_string_literal: true

module Toggly
  module Rails
    # Controller concern for feature flag checks.
    #
    # Include this module in your ApplicationController to add
    # feature flag helpers.
    #
    # @example
    #   class ApplicationController < ActionController::Base
    #     include Toggly::Rails::ControllerConcern
    #
    #     # Optional: customize how the current user is identified
    #     def toggly_current_user
    #       current_user
    #     end
    #   end
    module ControllerConcern
      extend ActiveSupport::Concern

      included do
        helper_method :feature_enabled?, :feature_disabled? if respond_to?(:helper_method)

        # Set up user in middleware on each request
        before_action :set_toggly_context, if: -> { Toggly::Rails.configuration&.request_context_enabled }
      end

      # Check if a feature is enabled
      #
      # @param feature_key [String, Symbol] Feature key
      # @param context [Toggly::Context, nil] Optional override context
      # @return [Boolean]
      def feature_enabled?(feature_key, context: nil)
        ctx = context || toggly_context
        Toggly.enabled?(feature_key, context: ctx)
      end

      # Check if a feature is disabled
      #
      # @param feature_key [String, Symbol] Feature key
      # @param context [Toggly::Context, nil] Optional override context
      # @return [Boolean]
      def feature_disabled?(feature_key, context: nil)
        !feature_enabled?(feature_key, context: context)
      end

      # Require a feature to be enabled, otherwise render not found
      #
      # @param feature_key [String, Symbol] Feature key
      # @param context [Toggly::Context, nil] Optional override context
      # @return [void]
      def require_feature!(feature_key, context: nil)
        return if feature_enabled?(feature_key, context: context)

        respond_to do |format|
          format.html { render file: "public/404.html", status: :not_found, layout: false }
          format.json { render json: { error: "Not found" }, status: :not_found }
          format.any { head :not_found }
        end
      end

      # Get the current evaluation context
      #
      # @return [Toggly::Context]
      def toggly_context
        @toggly_context ||= build_toggly_context
      end

      # Set a custom context for this request
      #
      # @param context [Toggly::Context] Context to use
      # @return [void]
      def toggly_context=(context)
        @toggly_context = context
        Middleware.set_context(request.env, context) if request
      end

      protected

      # Override this method to provide the current user
      #
      # @return [Object, nil]
      def toggly_current_user
        return current_user if respond_to?(:current_user, true)

        nil
      end

      private

      def set_toggly_context
        return unless request

        Middleware.set_user(request.env, toggly_current_user)
        Middleware.set_context(request.env, toggly_context)
      end

      def build_toggly_context
        config = Toggly::Rails.configuration
        return Toggly::Context.anonymous unless config

        # Use custom context builder if provided
        return config.context_builder.call(request, toggly_current_user) if config.context_builder

        # Use default context builder
        builder = ContextBuilder.new(config)
        builder.build(request: request, user: toggly_current_user)
      end
    end
  end
end
