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

  describe "catalog-local feature variants (MF-parity)" do
    let(:client) do
      described_class.new(
        app_key: app_key,
        environment: environment,
        disable_background_refresh: true
      )
    end

    before do
      # Variants / allocation travel on the same `definitions` wire as
      # `filters` — there is no separate variants fetch/cache rail.
      stub_definitions_api(
        app_key: app_key,
        environment: environment,
        features: [
          { "featureKey" => "enabled-feature", "enabled" => true },
          { "featureKey" => "disabled-feature", "enabled" => false },
          {
            "featureKey" => "checkout-flow",
            "enabled" => true,
            "variants" => [
              { "name" => "A", "configurationValue" => { "cta" => "Buy now" }, "statusOverride" => "None" },
              { "name" => "B", "configurationValue" => { "cta" => "Purchase" }, "statusOverride" => "None" }
            ],
            "allocation" => {
              "defaultWhenEnabled" => "B",
              "user" => [{ "variant" => "A", "users" => ["alice"] }]
            }
          },
          {
            "featureKey" => "no-variants-feature",
            "enabled" => true
          },
          {
            "featureKey" => "string-variant",
            "enabled" => true,
            "variants" => [
              { "name" => "A", "configurationValue" => "hello", "statusOverride" => "None" }
            ],
            "allocation" => { "defaultWhenEnabled" => "A" }
          },
          {
            "featureKey" => "killswitch-feature",
            "enabled" => false,
            "variants" => [
              { "name" => "Off", "configurationValue" => { "killSwitch" => true }, "statusOverride" => "Enabled" }
            ],
            "allocation" => { "defaultWhenDisabled" => "Off" }
          }
        ]
      )
    end

    describe "#enabled?" do
      it "stays filter-based and is not affected by variant allocation" do
        expect(client.enabled?("checkout-flow")).to be true
        expect(client.enabled?("disabled-feature")).to be false
      end
    end

    describe "#get_variant" do
      it "assigns the user-matched variant locally, with no network call" do
        WebMock.reset_executed_requests!

        variant = client.get_variant("checkout-flow", context: Toggly::Context.new(identity: "alice"))

        expect(variant).to be_a(Toggly::VariantResult)
        expect(variant.name).to eq("A")
        expect(variant.configuration_value).to eq({ "cta" => "Buy now" })
        expect(variant.reason).to eq("User")
        expect(WebMock).not_to have_requested(:get, /evaluated-variants-signed/)
      end

      it "falls back to defaultWhenEnabled when no allocation rule matches" do
        variant = client.get_variant("checkout-flow", context: Toggly::Context.new(identity: "carol"))

        expect(variant.name).to eq("B")
        expect(variant.reason).to eq("DefaultWhenEnabled")
      end

      it "returns nil when the feature has no variants configured" do
        expect(client.get_variant("no-variants-feature")).to be_nil
      end

      it "returns nil for an unknown feature key" do
        expect(client.get_variant("unknown-feature")).to be_nil
      end

      it "accepts symbol keys" do
        expect(client.get_variant(:"checkout-flow", context: Toggly::Context.new(identity: "alice"))&.name).to eq("A")
      end

      it "applies StatusOverride to the returned enabled flag (MF-identical effective enabled)" do
        # Feature is globally disabled, but its DefaultWhenDisabled variant
        # carries StatusOverride: Enabled, so the effective enabled flips —
        # `Client#enabled?` (filter-based) still reports the feature as off.
        variant = client.get_variant("killswitch-feature")

        expect(variant.name).to eq("Off")
        expect(variant.enabled).to be true
        expect(variant.reason).to eq("DefaultWhenDisabled")
        expect(client.enabled?("killswitch-feature")).to be false
      end
    end

    describe "#get_variant_value" do
      it "returns the configuration value for the assigned variant" do
        expect(client.get_variant_value("checkout-flow", context: Toggly::Context.new(identity: "alice")))
          .to eq({ "cta" => "Buy now" })
      end

      it "returns nil when there is no assigned variant" do
        expect(client.get_variant_value("no-variants-feature")).to be_nil
      end

      it "soft-binds an object when as: is a class" do
        checkout_config = Class.new do
          attr_reader :cta

          def initialize(cta:)
            @cta = cta
          end
        end

        bound = client.get_variant_value(
          "checkout-flow",
          context: Toggly::Context.new(identity: "alice"),
          as: checkout_config
        )
        expect(bound).to be_a(checkout_config)
        expect(bound.cta).to eq("Buy now")
      end

      it "soft-binds a scalar when as: matches" do
        expect(client.get_variant_value("string-variant", as: String)).to eq("hello")
      end

      it "returns nil on typed mismatch" do
        expect(
          client.get_variant_value(
            "checkout-flow",
            context: Toggly::Context.new(identity: "alice"),
            as: String
          )
        ).to be_nil
      end

      it "soft-binds :boolean without raising on is_a?" do
        seeded = described_class.new(
          app_key: app_key,
          environment: environment,
          disable_background_refresh: true
        )
        allow(seeded).to receive(:get_variant).and_return(
          Toggly::VariantResult.new(name: "A", configuration_value: true, enabled: true, reason: "DefaultWhenEnabled")
        )
        expect(seeded.get_variant_value("flag", as: :boolean)).to eq(true)
        allow(seeded).to receive(:get_variant).and_return(
          Toggly::VariantResult.new(name: "A", configuration_value: "nope", enabled: true, reason: "DefaultWhenEnabled")
        )
        expect(seeded.get_variant_value("flag", as: :boolean)).to be_nil
      end

      it "returns nil on typed missing assignment" do
        expect(client.get_variant_value("no-variants-feature", as: String)).to be_nil
      end
    end

    describe "identity precedence for get_variant" do
      it "uses Config#identity when context is nil" do
        seeded = described_class.new(
          app_key: app_key,
          environment: environment,
          disable_background_refresh: true,
          identity: "alice"
        )

        expect(seeded.get_variant("checkout-flow")&.name).to eq("A")
        expect(seeded.get_variant("checkout-flow")&.reason).to eq("User")
      end

      it "does not pick up Config#identity= after Client initialization" do
        seeded = described_class.new(
          app_key: app_key,
          environment: environment,
          disable_background_refresh: true,
          identity: "carol"
        )

        seeded.config.identity = "alice"
        expect(seeded.identity).to eq("carol")
        expect(seeded.get_variant("checkout-flow")&.name).to eq("B")

        seeded.set_identity("alice")
        expect(seeded.get_variant("checkout-flow")&.name).to eq("A")
      end

      it "uses Client#set_identity when context identity is blank" do
        client.set_identity("alice")

        expect(client.get_variant("checkout-flow", context: Toggly::Context.new(identity: ""))&.name)
          .to eq("A")
        expect(client.get_variant("checkout-flow", context: Toggly::Context.new)&.name).to eq("A")
      end

      it "lets a non-blank per-call context identity override client identity" do
        client.set_identity("alice")

        variant = client.get_variant(
          "checkout-flow",
          context: Toggly::Context.new(identity: "carol")
        )

        expect(variant.name).to eq("B")
        expect(variant.reason).to eq("DefaultWhenEnabled")
      end

      it "keeps groups from the per-call context while filling identity from the client" do
        stub_definitions_api(
          app_key: app_key,
          environment: environment,
          features: [
            {
              "featureKey" => "group-checkout",
              "enabled" => true,
              "variants" => [
                { "name" => "VIP", "configurationValue" => { "tier" => "vip" }, "statusOverride" => "None" },
                { "name" => "Default", "configurationValue" => { "tier" => "std" }, "statusOverride" => "None" }
              ],
              "allocation" => {
                "group" => [{ "variant" => "VIP", "groups" => ["beta"] }],
                "defaultWhenEnabled" => "Default"
              }
            }
          ]
        )
        grouped = described_class.new(
          app_key: app_key,
          environment: environment,
          disable_background_refresh: true,
          identity: "anyone"
        )

        vip = grouped.get_variant(
          "group-checkout",
          context: Toggly::Context.new(identity: nil, groups: ["beta"])
        )
        expect(vip.name).to eq("VIP")
        expect(vip.reason).to eq("Group")

        default = grouped.get_variant("group-checkout")
        expect(default.name).to eq("Default")
        expect(default.reason).to eq("DefaultWhenEnabled")
      end

      it "falls through to empty/anonymous when neither context nor client has identity" do
        expect(client.identity).to be_nil
        variant = client.get_variant("checkout-flow")

        expect(variant.name).to eq("B")
        expect(variant.reason).to eq("DefaultWhenEnabled")
      end

      it "applies the same precedence for get_variant_value" do
        client.set_identity("alice")
        expect(client.get_variant_value("checkout-flow")).to eq({ "cta" => "Buy now" })

        expect(
          client.get_variant_value("checkout-flow", context: Toggly::Context.new(identity: "carol"))
        ).to eq({ "cta" => "Purchase" })
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

    it "persists variants/allocation as part of the definitions snapshot" do
      stub_definitions_api(
        app_key: app_key,
        environment: environment,
        features: [
          {
            "featureKey" => "checkout-flow",
            "enabled" => true,
            "variants" => [{ "name" => "A", "configurationValue" => { "cta" => "Buy" }, "statusOverride" => "None" }],
            "allocation" => { "defaultWhenEnabled" => "A" }
          }
        ]
      )
      memory_provider = Toggly::SnapshotProviders::Memory.new

      _client = described_class.new(
        app_key: app_key,
        environment: environment,
        disable_background_refresh: true,
        snapshot_provider: memory_provider
      )

      # New client falls back to the definitions snapshot (with variants) when the network fails.
      stub_definitions_api(app_key: app_key, environment: environment, features: [], status: 500)

      client2 = described_class.new(
        app_key: app_key,
        environment: environment,
        disable_background_refresh: true,
        snapshot_provider: memory_provider
      )

      expect(client2.get_variant("checkout-flow")&.name).to eq("A")
    end
  end
end
