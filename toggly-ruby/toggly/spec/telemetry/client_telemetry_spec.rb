# frozen_string_literal: true

RSpec.describe "Client telemetry wiring" do
  let(:app_key) { "test-app-key" }
  let(:environment) { "Production" }
  let(:usage_client) do
    Class.new do
      attr_reader :payloads

      def initialize
        @payloads = []
      end

      def send_stats(payload)
        @payloads << payload
      end

      def close; end
    end.new
  end
  let(:metrics_client) do
    Class.new do
      attr_reader :payloads

      def initialize
        @payloads = []
      end

      def send_metrics(payload)
        @payloads << payload
      end

      def close; end
    end.new
  end

  around do |example|
    previous = ENV.fetch("TOGGLY_DISABLE_TELEMETRY", nil)
    ENV.delete("TOGGLY_DISABLE_TELEMETRY")
    example.run
  ensure
    ENV["TOGGLY_DISABLE_TELEMETRY"] = previous.nil? ? "1" : previous
  end

  before do
    stub_definitions_api(
      app_key: app_key,
      environment: environment,
      features: [
        { "featureKey" => "enabled-feature", "enabled" => true },
        { "featureKey" => "disabled-feature", "enabled" => false }
      ]
    )
  end

  def build_client(**overrides)
    Toggly::Client.new(
      {
        app_key: app_key,
        environment: environment,
        disable_background_refresh: true,
        enable_live_updates: false,
        usage_flush_interval: 0,
        metrics_flush_interval: 0,
        usage_client: usage_client,
        metrics_client: metrics_client
      }.merge(overrides)
    )
  end

  it "records checks from enabled? and flushes usage + metrics payloads" do
    client = build_client
    context = Toggly::Context.new(identity: "user-1")

    expect(client.enabled?("enabled-feature", context: context)).to be true
    expect(client.enabled?("disabled-feature", context: context)).to be false
    client.record_usage("enabled-feature", identity: "user-1")
    client.measure("revenue", 9.0, feature: "enabled-feature")
    client.flush_telemetry

    expect(usage_client.payloads.size).to eq(1)
    usage = usage_client.payloads.first
    expect(usage[:appKey]).to eq(app_key)
    stat = usage[:stats].find { |s| s[:feature] == "enabled-feature" }
    expect(stat[:variantStats]["enabled"][:checkCount]).to be >= 1
    expect(stat[:variantStats]["enabled"][:usedCount]).to eq(1)

    expect(metrics_client.payloads.size).to eq(1)
    metrics = metrics_client.payloads.first
    revenue = metrics[:stats].find { |s| s[:metric] == "revenue" }
    expect(revenue[:variantValues]["enabled"]).to eq(9.0)

    client.close
  end

  it "skips telemetry when explicitly disabled" do
    client = build_client(enable_usage_tracking: false, enable_metrics: false)
    client.enabled?("enabled-feature")
    client.record_usage("enabled-feature")
    client.measure("revenue", 1)
    client.flush_telemetry
    expect(usage_client.payloads).to be_empty
    expect(metrics_client.payloads).to be_empty
    client.close
  end

  it "includes ua metadata key constant for gRPC parity" do
    expect(Toggly::Telemetry::GRPC_USER_AGENT_METADATA_KEY).to eq("ua")
    expect(Toggly::Telemetry.resolve_user_agent).to eq("toggly-ruby/#{Toggly::VERSION}")
  end
end
