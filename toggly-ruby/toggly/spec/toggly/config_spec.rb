# frozen_string_literal: true

RSpec.describe Toggly::Config do
  describe "#initialize" do
    it "sets default values" do
      config = described_class.new(app_key: "test")

      expect(config.app_key).to eq("test")
      expect(config.environment).to eq("Production")
      expect(config.base_url).to eq("https://definitions.toggly.io/")
      expect(config.refresh_interval).to eq(300)
      expect(config.http_timeout).to eq(10)
    end

    it "accepts custom values" do
      config = described_class.new(
        app_key: "custom-key",
        environment: "Staging",
        base_url: "https://custom.example.com",
        refresh_interval: 60,
        http_timeout: 30
      )

      expect(config.app_key).to eq("custom-key")
      expect(config.environment).to eq("Staging")
      expect(config.base_url).to eq("https://custom.example.com/")
      expect(config.refresh_interval).to eq(60)
      expect(config.http_timeout).to eq(30)
    end

    it "accepts an optional identity" do
      config = described_class.new(app_key: "test", identity: "user-1")
      expect(config.identity).to eq("user-1")
    end

    it "normalizes blank identity to nil" do
      config = described_class.new(app_key: "test", identity: "")
      expect(config.identity).to be_nil
    end

    it "normalizes base_url to end with slash" do
      config = described_class.new(app_key: "test", base_url: "https://example.com")
      expect(config.base_url).to eq("https://example.com/")
    end
  end

  describe "#definitions_endpoint" do
    it "builds correct endpoint URL" do
      config = described_class.new(app_key: "my-app", environment: "Production")
      expect(config.definitions_endpoint).to eq("https://definitions.toggly.io/definitions/my-app/Production")
    end

    it "uses definitions_url when set" do
      config = described_class.new(
        app_key: "my-app",
        environment: "Production",
        definitions_url: "https://cdn.example.com"
      )
      expect(config.definitions_endpoint).to eq("https://cdn.example.com/definitions/my-app/Production")
    end
  end

  describe "#validate!" do
    it "raises error when app_key is missing" do
      config = described_class.new
      expect { config.validate! }.to raise_error(Toggly::ConfigError, /app_key is required/)
    end

    it "raises error when environment is empty" do
      config = described_class.new(app_key: "test", environment: "")
      expect { config.validate! }.to raise_error(Toggly::ConfigError, /environment is required/)
    end

    it "does not raise error when valid" do
      config = described_class.new(app_key: "test", environment: "Production")
      expect { config.validate! }.not_to raise_error
    end

    it "does not raise error in offline mode" do
      config = described_class.new(defaults: { "feature" => true })
      expect { config.validate! }.not_to raise_error
    end
  end

  describe "#offline_mode?" do
    it "returns true when app_key is nil and defaults are set" do
      config = described_class.new(defaults: { "feature" => true })
      expect(config.offline_mode?).to be true
    end

    it "returns false when app_key is set" do
      config = described_class.new(app_key: "test")
      expect(config.offline_mode?).to be false
    end

    it "returns false when defaults are empty" do
      config = described_class.new
      expect(config.offline_mode?).to be false
    end
  end

  describe "telemetry defaults" do
    def with_telemetry_env(disabled: false)
      previous = ENV.fetch("TOGGLY_DISABLE_TELEMETRY", nil)
      if disabled
        ENV["TOGGLY_DISABLE_TELEMETRY"] = "1"
      else
        ENV.delete("TOGGLY_DISABLE_TELEMETRY")
      end
      yield
    ensure
      ENV["TOGGLY_DISABLE_TELEMETRY"] = previous.nil? ? "1" : previous
    end

    it "enables usage and metrics when constructed with an app_key" do
      with_telemetry_env do
        config = described_class.new(app_key: "test-key")

        expect(config.enable_usage_tracking).to be true
        expect(config.enable_metrics).to be true
        expect(config.usage_flush_interval).to eq(described_class::DEFAULT_TELEMETRY_FLUSH_SECONDS)
      end
    end

    it "enables usage when app_key is assigned after Config.new" do
      with_telemetry_env do
        config = described_class.new
        expect(config.enable_usage_tracking).to be false

        config.app_key = "test-key"

        expect(config.enable_usage_tracking).to be true
        expect(config.enable_metrics).to be true
      end
    end

    it "keeps usage off when app_key is empty" do
      with_telemetry_env do
        config = described_class.new
        config.app_key = ""

        expect(config.enable_usage_tracking).to be false
        expect(config.enable_metrics).to be false
      end
    end

    it "keeps usage off when TOGGLY_DISABLE_TELEMETRY=1" do
      with_telemetry_env(disabled: true) do
        config = described_class.new
        config.app_key = "test-key"

        expect(config.enable_usage_tracking).to be false
        expect(config.enable_metrics).to be false
      end
    end

    it "keeps explicit false after app_key is assigned" do
      with_telemetry_env do
        config = described_class.new(enable_usage_tracking: false, enable_metrics: false)
        config.app_key = "test-key"

        expect(config.enable_usage_tracking).to be false
        expect(config.enable_metrics).to be false
      end
    end

    it "keeps explicit true without an app_key" do
      with_telemetry_env do
        config = described_class.new(enable_usage_tracking: true, enable_metrics: true)
        config.app_key = ""

        expect(config.enable_usage_tracking).to be true
        expect(config.enable_metrics).to be true
      end
    end
  end

  describe "#to_h" do
    it "returns hash representation" do
      config = described_class.new(app_key: "test", environment: "Staging", identity: "u1")
      hash = config.to_h

      expect(hash[:app_key]).to eq("test")
      expect(hash[:environment]).to eq("Staging")
      expect(hash[:identity]).to eq("u1")
    end
  end
end
