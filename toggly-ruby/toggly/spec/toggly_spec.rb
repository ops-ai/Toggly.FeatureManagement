# frozen_string_literal: true

RSpec.describe Toggly do
  it "has a version number" do
    expect(Toggly::VERSION).not_to be_nil
  end

  describe ".configure" do
    it "creates a global client" do
      stub_definitions_api(
        app_key: "test-key",
        environment: "Production",
        features: [{ "featureKey" => "test", "enabled" => true }]
      )

      Toggly.configure do |config|
        config.app_key = "test-key"
        config.environment = "Production"
        config.disable_background_refresh = true
      end

      expect(Toggly.client).to be_a(Toggly::Client)
    end
  end

  describe ".enabled?" do
    before do
      stub_definitions_api(
        app_key: "test-key",
        environment: "Production",
        features: [
          { "featureKey" => "enabled-feature", "enabled" => true },
          { "featureKey" => "disabled-feature", "enabled" => false }
        ]
      )

      Toggly.configure do |config|
        config.app_key = "test-key"
        config.environment = "Production"
        config.disable_background_refresh = true
      end
    end

    it "returns true for enabled features" do
      expect(Toggly.enabled?("enabled-feature")).to be true
    end

    it "returns false for disabled features" do
      expect(Toggly.enabled?("disabled-feature")).to be false
    end

    it "raises error when not configured" do
      Toggly.reset!
      expect { Toggly.enabled?("test") }.to raise_error(Toggly::Error)
    end
  end

  describe ".disabled?" do
    before do
      stub_definitions_api(
        app_key: "test-key",
        environment: "Production",
        features: [
          { "featureKey" => "enabled-feature", "enabled" => true }
        ]
      )

      Toggly.configure do |config|
        config.app_key = "test-key"
        config.environment = "Production"
        config.disable_background_refresh = true
      end
    end

    it "returns false for enabled features" do
      expect(Toggly.disabled?("enabled-feature")).to be false
    end
  end

  describe ".reset!" do
    it "clears the global client" do
      stub_definitions_api(
        app_key: "test-key",
        environment: "Production",
        features: []
      )

      Toggly.configure do |config|
        config.app_key = "test-key"
        config.disable_background_refresh = true
      end

      Toggly.reset!
      expect(Toggly.client).to be_nil
    end
  end
end
