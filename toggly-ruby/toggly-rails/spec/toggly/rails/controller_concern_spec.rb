# frozen_string_literal: true

require "action_controller"
require "action_dispatch"

RSpec.describe Toggly::Rails::ControllerConcern do
  before do
    stub_definitions_api(
      app_key: "test-key",
      environment: "Production",
      features: [
        { "featureKey" => "test_feature", "enabled" => true },
        { "featureKey" => "disabled_feature", "enabled" => false }
      ]
    )

    Toggly::Rails.configure do |config|
      config.app_key = "test-key"
      config.environment = "Production"
      config.disable_background_refresh = true
    end
  end

  let(:controller) do
    Class.new(ActionController::Base) do
      include Toggly::Rails::ControllerConcern

      def current_user
        OpenStruct.new(id: 123, name: "Test")
      end
    end.new
  end

  describe "#feature_enabled?" do
    before do
      # Set up a mock request
      controller.instance_variable_set(:@request, ActionDispatch::Request.new({}))
    end

    it "returns true for enabled features" do
      expect(controller.feature_enabled?(:test_feature)).to be true
    end

    it "returns false for disabled features" do
      expect(controller.feature_enabled?(:disabled_feature)).to be false
    end
  end

  describe "#feature_disabled?" do
    before do
      controller.instance_variable_set(:@request, ActionDispatch::Request.new({}))
    end

    it "returns false for enabled features" do
      expect(controller.feature_disabled?(:test_feature)).to be false
    end

    it "returns true for disabled features" do
      expect(controller.feature_disabled?(:disabled_feature)).to be true
    end
  end

  describe "#feature_variant" do
    before do
      stub_definitions_api(
        app_key: "test-key",
        environment: "Production",
        features: [
          {
            "featureKey" => "checkout_flow",
            "enabled" => true,
            "variants" => [
              { "name" => "A", "configurationValue" => { "cta" => "Buy" }, "statusOverride" => "None" },
              { "name" => "B", "configurationValue" => { "cta" => "Later" }, "statusOverride" => "None" }
            ],
            "allocation" => {
              "defaultWhenEnabled" => "B",
              "user" => [{ "variant" => "A", "users" => ["123"] }]
            }
          }
        ]
      )
      Toggly::Rails.configure do |config|
        config.app_key = "test-key"
        config.environment = "Production"
        config.disable_background_refresh = true
      end
      controller.instance_variable_set(:@request, ActionDispatch::Request.new({}))
    end

    it "uses toggly_context identity without requiring an explicit context" do
      variant = controller.feature_variant(:checkout_flow)

      expect(variant).to be_a(Toggly::VariantResult)
      expect(variant.name).to eq("A")
      expect(controller.feature_variant_value(:checkout_flow)).to eq({ "cta" => "Buy" })
    end

    it "lets an explicit context override ambient toggly_context" do
      override = Toggly::Context.new(identity: "other-user")
      variant = controller.feature_variant(:checkout_flow, context: override)

      expect(variant.name).to eq("B")
      expect(controller.feature_variant_value(:checkout_flow, context: override)).to eq({ "cta" => "Later" })
    end
  end

  describe "#toggly_context" do
    before do
      controller.instance_variable_set(:@request, ActionDispatch::Request.new({}))
    end

    it "builds context with user identity" do
      context = controller.toggly_context

      expect(context.identity).to eq("123")
    end

    it "memoizes the context" do
      context1 = controller.toggly_context
      context2 = controller.toggly_context

      expect(context1).to equal(context2)
    end
  end
end
