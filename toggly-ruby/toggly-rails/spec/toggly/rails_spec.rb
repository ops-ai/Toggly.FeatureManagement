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

    def with_telemetry_env(disabled: false)
      previous = ENV.fetch("TOGGLY_DISABLE_TELEMETRY", nil)
      if disabled
        ENV["TOGGLY_DISABLE_TELEMETRY"] = "1"
      else
        ENV.delete("TOGGLY_DISABLE_TELEMETRY")
      end
      yield
    ensure
      if previous.nil?
        ENV.delete("TOGGLY_DISABLE_TELEMETRY")
      else
        ENV["TOGGLY_DISABLE_TELEMETRY"] = previous
      end
    end

    it "enables usage when configured with an app_key" do
      with_telemetry_env do
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

        expect(Toggly.client.config.enable_usage_tracking).to be true
        expect(Toggly.client.config.enable_metrics).to be true
        expect(Toggly.client.config.usage_flush_interval).to eq(Toggly::Config::DEFAULT_TELEMETRY_FLUSH_SECONDS)
      end
    end

    it "keeps usage off when TOGGLY_DISABLE_TELEMETRY=1" do
      with_telemetry_env(disabled: true) do
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

        expect(Toggly.client.config.enable_usage_tracking).to be false
        expect(Toggly.client.config.enable_metrics).to be false
      end
    end

    it "keeps usage off when explicitly disabled" do
      with_telemetry_env do
        stub_definitions_api(
          app_key: "test-key",
          environment: "Production",
          features: []
        )

        described_class.configure do |config|
          config.app_key = "test-key"
          config.environment = "Production"
          config.disable_background_refresh = true
          config.enable_usage_tracking = false
          config.enable_metrics = false
        end

        expect(Toggly.client.config.enable_usage_tracking).to be false
        expect(Toggly.client.config.enable_metrics).to be false
      end
    end

    it "keeps usage off when app_key is empty" do
      with_telemetry_env do
        described_class.configure do |config|
          config.app_key = ""
          config.defaults = { "offline-feature" => true }
          config.disable_background_refresh = true
        end

        expect(Toggly.client.config.enable_usage_tracking).to be false
        expect(Toggly.client.config.enable_metrics).to be false
      end
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
