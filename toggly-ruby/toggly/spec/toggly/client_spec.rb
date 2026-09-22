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

  describe "evaluated variants (dual-rail)" do
    let(:client) do
      described_class.new(
        app_key: app_key,
        environment: environment,
        enable_variants: true,
        disable_background_refresh: true
      )
    end

    before do
      # Local definitions rail — remains the sole source of truth for
      # enabled?, even with enable_variants: true.
      stub_definitions_api(
        app_key: app_key,
        environment: environment,
        features: [
          { "featureKey" => "checkout-flow", "enabled" => true },
          { "featureKey" => "disabled-experiment", "enabled" => false },
          { "featureKey" => "no-variant-assigned", "enabled" => true },
          { "featureKey" => "variant-disagrees-with-definition", "enabled" => true }
        ]
      )
      # Additive evaluated-variants rail — only feeds get_variant /
      # get_variant_value, never enabled?.
      stub_variants_api(
        app_key: app_key,
        environment: environment,
        defs: {
          "checkout-flow" => { "enabled" => true, "variant" => "treatment", "configurationValue" => { "cta" => "Buy now" } },
          "disabled-experiment" => { "enabled" => false, "variant" => "control" },
          "no-variant-assigned" => { "enabled" => true },
          # Server-evaluated assignment disagrees with the local definition
          # (enabled: false vs. the definition's enabled: true) — enabled?
          # must still follow the definition.
          "variant-disagrees-with-definition" => { "enabled" => false, "variant" => "treatment" }
        }
      )
    end

    describe "#enabled?" do
      it "evaluates from local definitions, not the evaluated-variant enabled flag" do
        expect(client.enabled?("checkout-flow")).to be true
        expect(client.enabled?("disabled-experiment")).to be false
      end

      it "is not overridden by a conflicting evaluated-variant assignment (regression)" do
        # The evaluated-variants-signed rail says this feature is OFF for the
        # assigned variant, but the definitions rail says it is ON.
        # Definitions must remain authoritative for enabled? even when
        # enable_variants is true.
        expect(client.enabled?("variant-disagrees-with-definition")).to be true
      end

      it "falls through to defaults for unknown features" do
        expect(client.enabled?("unknown-feature")).to be false
        expect(client.enabled?("unknown-feature", default: true)).to be true
      end
    end

    describe "#get_variant" do
      it "returns the assigned variant name and configuration value" do
        variant = client.get_variant("checkout-flow")

        expect(variant).to be_a(Toggly::VariantResult)
        expect(variant.name).to eq("treatment")
        expect(variant.configuration_value).to eq({ "cta" => "Buy now" })
      end

      it "returns nil when the feature has no assigned variant" do
        expect(client.get_variant("no-variant-assigned")).to be_nil
      end

      it "returns nil for an unknown feature key" do
        expect(client.get_variant("unknown-feature")).to be_nil
      end

      it "accepts symbol keys" do
        expect(client.get_variant(:"checkout-flow")&.name).to eq("treatment")
      end
    end

    describe "#get_variant_value" do
      it "returns the configuration value for the assigned variant" do
        expect(client.get_variant_value("checkout-flow")).to eq({ "cta" => "Buy now" })
      end

      it "returns nil when there is no assigned variant" do
        expect(client.get_variant_value("no-variant-assigned")).to be_nil
      end
    end

    context "when enable_variants is false (default)" do
      let(:default_client) do
        described_class.new(
          app_key: app_key,
          environment: environment,
          disable_background_refresh: true
        )
      end

      it "get_variant always returns nil" do
        expect(default_client.get_variant("enabled-feature")).to be_nil
      end

      it "get_variant_value always returns nil" do
        expect(default_client.get_variant_value("enabled-feature")).to be_nil
      end

      it "does not call evaluated-variants-signed" do
        default_client
        expect(WebMock).not_to have_requested(:get, "https://definitions.toggly.io/evaluated-variants-signed/#{app_key}/#{environment}")
      end
    end

    describe "#set_variant_identity" do
      it "clears cached variants and refreshes with the new userId" do
        client # trigger initial load

        stub_request(:get, "https://definitions.toggly.io/evaluated-variants-signed/#{app_key}/#{environment}")
          .with(query: { "userId" => "user-42" })
          .to_return(
            status: 200,
            body: build_variants_response({ "checkout-flow" => { "enabled" => false, "variant" => "control" } }, timestamp: 2),
            headers: { "Content-Type" => "application/json" }
          )

        changed = client.set_variant_identity("user-42")

        expect(changed).to be true
        expect(client.get_variant("checkout-flow").name).to eq("control")
      end

      it "returns false when identity is unchanged" do
        client
        expect(client.set_variant_identity(nil)).to be false
      end
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

    it "persists and restores evaluated variants independently (dual-rail)" do
      stub_variants_api(
        app_key: app_key,
        environment: environment,
        defs: { "checkout-flow" => { "enabled" => true, "variant" => "treatment" } }
      )
      memory_provider = Toggly::SnapshotProviders::Memory.new

      _client = described_class.new(
        app_key: app_key,
        environment: environment,
        enable_variants: true,
        disable_background_refresh: true,
        snapshot_provider: memory_provider
      )

      expect(memory_provider.load_variants).not_to be_nil

      # New client falls back to the variants snapshot when the network fails.
      stub_request(:get, "https://definitions.toggly.io/evaluated-variants-signed/#{app_key}/#{environment}")
        .to_return(status: 500)

      client2 = described_class.new(
        app_key: app_key,
        environment: environment,
        enable_variants: true,
        disable_background_refresh: true,
        snapshot_provider: memory_provider
      )

      expect(client2.get_variant("checkout-flow")&.name).to eq("treatment")
    end
  end
end
