# frozen_string_literal: true

RSpec.describe Toggly::Rails do
  describe ".configure" do
    it "creates configuration" do
      stub_definitions_api(
        app_key: "test-key",
        environment: "Production",
        features: []
      )

      described_class.configure do |config|
        config.app_key = "test-key"
        config.environment = "Production"
        config.disable_background_refresh = true
      end

      expect(described_class.configuration).to be_a(Toggly::Rails::Configuration)
      expect(Toggly.client).to be_a(Toggly::Client)
    end
  end

  describe ".reset!" do
    it "clears configuration and client" do
      stub_definitions_api(
        app_key: "test-key",
        environment: "Production",
        features: []
      )

      described_class.configure do |config|
        config.app_key = "test-key"
        config.environment = "Production"
        config.disable_background_refresh = true
      end

      described_class.reset!

      expect(described_class.configuration).to be_nil
      expect(Toggly.client).to be_nil
    end
  end
end
