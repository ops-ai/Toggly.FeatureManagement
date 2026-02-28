# frozen_string_literal: true

module Toggly
  module Rails
    # Rails Railtie for automatic integration.
    #
    # Automatically configures:
    # - Middleware for request context
    # - View helpers
    # - Controller helpers
    class Railtie < ::Rails::Railtie
      initializer "toggly.middleware" do |app|
        app.middleware.use Toggly::Rails::Middleware
      end

      initializer "toggly.view_helpers" do
        ActiveSupport.on_load(:action_view) do
          include Toggly::Rails::ViewHelpers
        end
      end

      initializer "toggly.controller_helpers" do
        ActiveSupport.on_load(:action_controller) do
          include Toggly::Rails::ControllerConcern
        end
      end

      # Configure Toggly after Rails initializers have run
      config.after_initialize do
        next unless Toggly::Rails.configuration.nil?
        next unless defined?(::Rails) && ::Rails.application

        credentials = ::Rails.application.credentials
        next unless credentials.respond_to?(:toggly) && credentials.toggly

        Toggly::Rails.configure do |config|
          config.app_key = credentials.toggly[:app_key]
          config.environment = credentials.toggly[:environment] || (::Rails.env.production? ? "Production" : "Staging")
        end
      end

      # Gracefully shutdown on Rails restart
      config.after_initialize do
        at_exit do
          Toggly.client&.close
        end
      end

      # Add rake tasks
      rake_tasks do
        load "toggly/rails/tasks.rake"
      end

      # Add generators
      generators do
        require_relative "generators/toggly/install/install_generator"
      end
    end
  end
end
