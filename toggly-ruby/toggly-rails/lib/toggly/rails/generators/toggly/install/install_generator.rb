# frozen_string_literal: true

require "rails/generators/base"

module Toggly
  module Generators
    # Generator for Toggly Rails initializer.
    #
    # @example
    #   rails generate toggly:install
    class InstallGenerator < ::Rails::Generators::Base
      source_root File.expand_path("templates", __dir__)

      desc "Creates a Toggly initializer file"

      class_option :app_key, type: :string, desc: "Your Toggly app key"
      class_option :environment, type: :string, desc: "Environment name"

      def create_initializer_file
        template "toggly.rb.erb", "config/initializers/toggly.rb"
      end

      def show_post_install_message
        say ""
        say "Toggly has been installed! 🎉", :green
        say ""
        say "Next steps:"
        say "  1. Update config/initializers/toggly.rb with your app key"
        say "  2. Or add to your credentials: rails credentials:edit"
        say "     toggly:"
        say "       app_key: your-app-key"
        say "       environment: Production"
        say ""
        say "Usage in controllers:"
        say "  if feature_enabled?(:my_feature)"
        say "    # feature is on"
        say "  end"
        say ""
        say "Usage in views:"
        say "  <% if feature_enabled?(:my_feature) %>"
        say "    Feature content"
        say "  <% end %>"
        say ""
      end

      private

      def app_key
        options[:app_key] || "ENV.fetch('TOGGLY_APP_KEY', nil)"
      end

      def environment_name
        options[:environment] || "Rails.env.production? ? 'Production' : 'Staging'"
      end
    end
  end
end
