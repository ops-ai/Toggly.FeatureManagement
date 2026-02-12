# frozen_string_literal: true

require "toggly"
require_relative "toggly/rails/version"
require_relative "toggly/rails/configuration"
require_relative "toggly/rails/context_builder"
require_relative "toggly/rails/middleware"
require_relative "toggly/rails/controller_concern"
require_relative "toggly/rails/view_helpers"
require_relative "toggly/rails/railtie" if defined?(::Rails::Railtie)

module Toggly
  # Rails integration for Toggly feature flags.
  #
  # @example Basic Rails setup (config/initializers/toggly.rb)
  #   Toggly::Rails.configure do |config|
  #     config.app_key = Rails.application.credentials.toggly_app_key
  #     config.environment = Rails.env.production? ? "Production" : "Staging"
  #   end
  #
  # @example Controller usage
  #   class ApplicationController < ActionController::Base
  #     include Toggly::Rails::ControllerConcern
  #
  #     def show
  #       if feature_enabled?(:new_dashboard)
  #         render :new_dashboard
  #       else
  #         render :dashboard
  #       end
  #     end
  #   end
  #
  # @example View usage
  #   <% if feature_enabled?(:new_header) %>
  #     <%= render "new_header" %>
  #   <% else %>
  #     <%= render "header" %>
  #   <% end %>
  module Rails
    class << self
      # @return [Configuration] Rails-specific configuration
      attr_accessor :configuration

      # Configure Toggly for Rails
      #
      # @yield [Configuration] Configuration block
      # @return [void]
      def configure
        self.configuration ||= Configuration.new
        yield(configuration) if block_given?

        # Create the Toggly client from Rails configuration
        Toggly.configure do |config|
          configuration.apply_to(config)
        end
      end

      # Reset configuration (mainly for testing)
      def reset!
        self.configuration = nil
        Toggly.reset!
      end

      # Get the current Toggly client
      #
      # @return [Toggly::Client]
      def client
        Toggly.client
      end
    end
  end
end
