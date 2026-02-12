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
  end

  describe "#add_trait" do
    it "adds custom trait extractor" do
      config = described_class.new
      config.add_trait(:custom) { |_req, user| user&.custom_value }

      expect(config.trait_extractors).to have_key(:custom)
    end
  end
end
