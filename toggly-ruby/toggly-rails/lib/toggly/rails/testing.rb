# frozen_string_literal: true

module Toggly
  module Rails
    # Testing helpers for RSpec and Minitest.
    #
    # @example RSpec
    #   RSpec.configure do |config|
    #     config.include Toggly::Rails::Testing::RSpecHelpers
    #   end
    #
    #   describe "my feature" do
    #     it "shows new UI when enabled" do
    #       with_feature(:new_ui, enabled: true) do
    #         visit dashboard_path
    #         expect(page).to have_content("New Dashboard")
    #       end
    #     end
    #   end
    #
    # @example Minitest
    #   class MyTest < ActionDispatch::IntegrationTest
    #     include Toggly::Rails::Testing::MinitestHelpers
    #
    #     test "shows new UI when enabled" do
    #       with_feature(:new_ui, enabled: true) do
    #         get dashboard_path
    #         assert_includes response.body, "New Dashboard"
    #       end
    #     end
    #   end
    module Testing
      # Stub a feature to return a specific value
      #
      # @param feature_key [String, Symbol] Feature key
      # @param enabled [Boolean] Whether the feature should be enabled
      # @yield Block during which the feature is stubbed
      def with_feature(feature_key, enabled: true)
        key = feature_key.to_s
        original_definitions = Toggly.client&.definitions&.dup || {}

        # Add or update the feature definition
        Toggly.client.instance_variable_get(:@mutex).synchronize do
          Toggly.client.definitions[key] = Toggly::FeatureDefinition.new(
            feature_key: key,
            enabled: enabled
          )
        end

        yield
      ensure
        # Restore original definitions
        if Toggly.client
          Toggly.client.instance_variable_get(:@mutex).synchronize do
            Toggly.client.instance_variable_set(:@definitions, original_definitions)
          end
        end
      end

      # Stub multiple features at once
      #
      # @param features [Hash<String, Boolean>] Hash of feature keys to enabled states
      # @yield Block during which the features are stubbed
      def with_features(features)
        original_definitions = Toggly.client&.definitions&.dup || {}

        features.each do |key, enabled|
          Toggly.client.instance_variable_get(:@mutex).synchronize do
            Toggly.client.definitions[key.to_s] = Toggly::FeatureDefinition.new(
              feature_key: key.to_s,
              enabled: enabled
            )
          end
        end

        yield
      ensure
        if Toggly.client
          Toggly.client.instance_variable_get(:@mutex).synchronize do
            Toggly.client.instance_variable_set(:@definitions, original_definitions)
          end
        end
      end

      # Enable a feature for the duration of a block
      #
      # @param feature_key [String, Symbol] Feature key
      # @yield Block during which the feature is enabled
      def enable_feature(feature_key, &block)
        with_feature(feature_key, enabled: true, &block)
      end

      # Disable a feature for the duration of a block
      #
      # @param feature_key [String, Symbol] Feature key
      # @yield Block during which the feature is disabled
      def disable_feature(feature_key, &block)
        with_feature(feature_key, enabled: false, &block)
      end

      # RSpec helpers
      module RSpecHelpers
        include Testing

        # RSpec matcher for checking if a feature is enabled
        #
        # @example
        #   expect(:new_feature).to be_feature_enabled
        RSpec::Matchers.define :be_feature_enabled do
          match do |feature_key|
            Toggly.enabled?(feature_key)
          end

          failure_message do |feature_key|
            "expected feature '#{feature_key}' to be enabled"
          end

          failure_message_when_negated do |feature_key|
            "expected feature '#{feature_key}' to be disabled"
          end
        end if defined?(RSpec::Matchers)
      end

      # Minitest helpers
      module MinitestHelpers
        include Testing

        # Assert that a feature is enabled
        #
        # @param feature_key [String, Symbol] Feature key
        # @param msg [String, nil] Custom failure message
        def assert_feature_enabled(feature_key, msg = nil)
          msg ||= "Expected feature '#{feature_key}' to be enabled"
          assert Toggly.enabled?(feature_key), msg
        end

        # Assert that a feature is disabled
        #
        # @param feature_key [String, Symbol] Feature key
        # @param msg [String, nil] Custom failure message
        def assert_feature_disabled(feature_key, msg = nil)
          msg ||= "Expected feature '#{feature_key}' to be disabled"
          assert Toggly.disabled?(feature_key), msg
        end
      end
    end
  end
end
