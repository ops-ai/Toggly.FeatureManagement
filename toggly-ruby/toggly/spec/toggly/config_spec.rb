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

  describe "#to_h" do
    it "returns hash representation" do
      config = described_class.new(app_key: "test", environment: "Staging")
      hash = config.to_h

      expect(hash[:app_key]).to eq("test")
      expect(hash[:environment]).to eq("Staging")
    end
  end
end
