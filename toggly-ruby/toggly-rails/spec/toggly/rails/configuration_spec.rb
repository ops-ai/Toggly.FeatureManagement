# frozen_string_literal: true

RSpec.describe Toggly::Rails::Configuration do
  describe "#initialize" do
    it "sets default values" do
      config = described_class.new

      expect(config.refresh_interval).to eq(300)
      expect(config.http_timeout).to eq(10)
      expect(config.request_context_enabled).to be true
      expect(config.identity_method).to eq(:id)
    end
  end

  describe "#apply_to" do
    it "applies configuration to Toggly::Config" do
      rails_config = described_class.new
      rails_config.app_key = "test-key"
      rails_config.environment = "Staging"
      rails_config.refresh_interval = 60

      toggly_config = Toggly::Config.new
      rails_config.apply_to(toggly_config)

      expect(toggly_config.app_key).to eq("test-key")
      expect(toggly_config.environment).to eq("Staging")
      expect(toggly_config.refresh_interval).to eq(60)
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

    it "enables usage with the core flush default when app_key is set" do
      with_telemetry_env do
        rails_config = described_class.new
        rails_config.app_key = "test-key"

        toggly_config = Toggly::Config.new
        rails_config.apply_to(toggly_config)

        expect(toggly_config.enable_usage_tracking).to be true
        expect(toggly_config.enable_metrics).to be true
        expect(toggly_config.usage_flush_interval).to eq(Toggly::Config::DEFAULT_TELEMETRY_FLUSH_SECONDS)
        expect(toggly_config.metrics_flush_interval).to eq(Toggly::Config::DEFAULT_TELEMETRY_FLUSH_SECONDS)
      end
    end

    it "forwards explicit telemetry options" do
      with_telemetry_env do
        rails_config = described_class.new
        rails_config.app_key = "test-key"
        rails_config.enable_usage_tracking = false
        rails_config.enable_metrics = false
        rails_config.usage_flush_interval = 15
        rails_config.metrics_flush_interval = 20

        toggly_config = Toggly::Config.new
        rails_config.apply_to(toggly_config)

        expect(toggly_config.enable_usage_tracking).to be false
        expect(toggly_config.enable_metrics).to be false
        expect(toggly_config.usage_flush_interval).to eq(15)
        expect(toggly_config.metrics_flush_interval).to eq(20)
      end
    end

    it "keeps usage off when TOGGLY_DISABLE_TELEMETRY=1" do
      with_telemetry_env(disabled: true) do
        rails_config = described_class.new
        rails_config.app_key = "test-key"

        toggly_config = Toggly::Config.new
        rails_config.apply_to(toggly_config)

        expect(toggly_config.enable_usage_tracking).to be false
        expect(toggly_config.enable_metrics).to be false
      end
    end

    it "keeps usage off when app_key is empty" do
      with_telemetry_env do
        rails_config = described_class.new
        rails_config.app_key = ""

        toggly_config = Toggly::Config.new
        rails_config.apply_to(toggly_config)

        expect(toggly_config.enable_usage_tracking).to be false
        expect(toggly_config.enable_metrics).to be false
      end
    end
  end

  describe "#add_trait" do
    it "adds custom trait extractor" do
      config = described_class.new
      config.add_trait(:custom) { |_req, user| user&.custom_value }

      expect(config.trait_extractors).to have_key(:custom)
    end
  end
end
