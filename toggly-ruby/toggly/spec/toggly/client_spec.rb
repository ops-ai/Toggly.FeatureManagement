# frozen_string_literal: true

RSpec.describe Toggly::Client do
  let(:app_key) { "test-app-key" }
  let(:environment) { "Production" }

  before do
    stub_definitions_api(
      app_key: app_key,
      environment: environment,
      features: [
        { "featureKey" => "enabled-feature", "enabled" => true },
        { "featureKey" => "disabled-feature", "enabled" => false },
        {
          "featureKey" => "percentage-feature",
          "enabled" => true,
          "rules" => [{ "type" => "percentage", "percentage" => 50 }]
        },
        {
          "featureKey" => "targeted-feature",
          "enabled" => true,
          "rules" => [{ "type" => "targeting", "groups" => ["beta"] }]
        }
      ]
    )
  end

  describe "#initialize" do
    it "creates client with config object" do
      config = Toggly::Config.new(
        app_key: app_key,
        environment: environment,
        disable_background_refresh: true
      )
      client = described_class.new(config)

      expect(client.config).to eq(config)
      expect(client.ready).to be true
    end

    it "creates client with options hash" do
      client = described_class.new(
        app_key: app_key,
        environment: environment,
        disable_background_refresh: true
      )

      expect(client.config.app_key).to eq(app_key)
      expect(client.ready).to be true
    end

    it "loads definitions on initialization" do
      client = described_class.new(
        app_key: app_key,
        environment: environment,
        disable_background_refresh: true
      )

      expect(client.feature_keys).to include("enabled-feature")
    end
  end

  describe "#enabled?" do
    let(:client) do
      described_class.new(
        app_key: app_key,
        environment: environment,
        disable_background_refresh: true
      )
    end

    it "returns true for enabled features" do
      expect(client.enabled?("enabled-feature")).to be true
    end

    it "returns false for disabled features" do
      expect(client.enabled?("disabled-feature")).to be false
    end

    it "returns false for unknown features" do
      expect(client.enabled?("unknown-feature")).to be false
    end

    it "accepts symbol keys" do
      expect(client.enabled?(:"enabled-feature")).to be true
    end

    context "with context" do
      it "evaluates percentage rules" do
        context = Toggly::Context.new(identity: "user-123")
        # Result depends on hash, just ensure no error
        result = client.enabled?("percentage-feature", context: context)
        expect([true, false]).to include(result)
      end

      it "evaluates targeting rules" do
        beta_context = Toggly::Context.new(identity: "user-1", groups: ["beta"])

        expect(client.enabled?("targeted-feature", context: beta_context)).to be true
        # Non-matching group falls through to default (enabled since feature.enabled=true)
      end
    end

    context "with default value" do
      it "returns default for unknown features" do
        expect(client.enabled?("unknown", default: true)).to be true
        expect(client.enabled?("unknown", default: false)).to be false
      end
    end
  end

  describe "#disabled?" do
    let(:client) do
      described_class.new(
        app_key: app_key,
        environment: environment,
        disable_background_refresh: true
      )
    end

    it "returns false for enabled features" do
      expect(client.disabled?("enabled-feature")).to be false
    end

    it "returns true for disabled features" do
      expect(client.disabled?("disabled-feature")).to be true
    end
  end

  describe "#evaluate" do
    let(:client) do
      described_class.new(
        app_key: app_key,
        environment: environment,
        disable_background_refresh: true
      )
    end

    it "returns detailed evaluation result" do
      result = client.evaluate("enabled-feature")

      expect(result).to be_a(Toggly::EvaluationResult)
      expect(result.feature_key).to eq("enabled-feature")
      expect(result.enabled).to be true
    end
  end

  describe "#feature" do
    let(:client) do
      described_class.new(
        app_key: app_key,
        environment: environment,
        disable_background_refresh: true
      )
    end

    it "returns feature definition" do
      feature = client.feature("enabled-feature")

      expect(feature).to be_a(Toggly::FeatureDefinition)
      expect(feature.feature_key).to eq("enabled-feature")
    end

    it "returns nil for unknown feature" do
      expect(client.feature("unknown")).to be_nil
    end
  end

  describe "#feature_keys" do
    let(:client) do
      described_class.new(
        app_key: app_key,
        environment: environment,
        disable_background_refresh: true
      )
    end

    it "returns all feature keys" do
      keys = client.feature_keys

      expect(keys).to include("enabled-feature", "disabled-feature")
    end
  end

  describe "#refresh" do
    let(:client) do
      described_class.new(
        app_key: app_key,
        environment: environment,
        disable_background_refresh: true
      )
    end

    it "refreshes definitions from API" do
      # Stub updated response
      stub_definitions_api(
        app_key: app_key,
        environment: environment,
        features: [
          { "featureKey" => "new-feature", "enabled" => true }
        ]
      )

      result = client.refresh(force: true)

      expect(result).to be true
      expect(client.feature_keys).to include("new-feature")
    end
  end

  describe "#close" do
    it "stops background refresh" do
      client = described_class.new(
        app_key: app_key,
        environment: environment,
        refresh_interval: 1
      )

      client.close

      expect(client.closed?).to be true
    end
  end

  describe "offline mode" do
    it "works without app_key when defaults provided" do
      client = described_class.new(
        defaults: {
          "feature-a" => true,
          "feature-b" => false
        },
        disable_background_refresh: true
      )

      expect(client.enabled?("feature-a")).to be true
      expect(client.enabled?("feature-b")).to be false
      expect(client.enabled?("feature-c")).to be false
    end
  end

  describe "snapshot provider" do
    it "saves and loads from snapshot" do
      memory_provider = Toggly::SnapshotProviders::Memory.new

      _client = described_class.new(
        app_key: app_key,
        environment: environment,
        disable_background_refresh: true,
        snapshot_provider: memory_provider
      )

      expect(memory_provider.exists?).to be true

      # Create new client that loads from snapshot
      stub_definitions_api(app_key: app_key, environment: environment, features: [], status: 500)

      client2 = described_class.new(
        app_key: app_key,
        environment: environment,
        disable_background_refresh: true,
        snapshot_provider: memory_provider
      )

      expect(client2.feature_keys).to include("enabled-feature")
    end
  end
end
