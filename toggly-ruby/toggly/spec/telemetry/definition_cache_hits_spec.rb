# frozen_string_literal: true

RSpec.describe "Definition cache hit telemetry" do
  let(:app_key) { "cache-app" }
  let(:environment) { "Production" }
  let(:features_v1) { [{ "featureKey" => "feat-a", "enabled" => true }] }
  let(:features_v2) { [{ "featureKey" => "feat-b", "enabled" => true }] }
  let(:usage_client) do
    Class.new do
      attr_reader :payloads
      attr_accessor :fail_next

      def initialize
        @payloads = []
        @fail_next = false
      end

      def send_stats(payload)
        if @fail_next
          @fail_next = false
          raise StandardError, "send failed"
        end
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

  def build_client(**overrides)
    Toggly::Client.new(
      {
        app_key: app_key,
        environment: environment,
        disable_background_refresh: true,
        enable_live_updates: false,
        enable_usage_tracking: true,
        enable_metrics: false,
        usage_flush_interval: 0,
        metrics_flush_interval: 0,
        usage_client: usage_client
      }.merge(overrides)
    )
  end

  def flush_and_clear(client)
    client.flush_telemetry
    usage_client.payloads.clear
  end

  def cache_counts(client)
    client.flush_telemetry
    payload = usage_client.payloads.last || {}
    [payload[:definitionCacheHits].to_i, payload[:definitionCacheMisses].to_i]
  end

  it "counts HTTP 304 as a hit and new 200 as a miss" do
    stub_definitions_api(app_key: app_key, environment: environment, features: features_v1, etag: '"1"')
    client = build_client
    # Initial force refresh applied new revision → miss
    expect(cache_counts(client)).to eq([0, 1])

    stub_definitions_api(app_key: app_key, environment: environment, features: features_v1, status: 304, etag: '"1"')
    client.refresh
    expect(cache_counts(client)).to eq([1, 0])

    stub_definitions_api(app_key: app_key, environment: environment, features: features_v2, etag: '"2"')
    client.refresh(force: true)
    expect(cache_counts(client)).to eq([0, 1])
    expect(client.feature_keys).to include("feat-b")
    client.close
  end

  it "counts equal revision ETag as a hit" do
    stub_definitions_api(app_key: app_key, environment: environment, features: features_v1, etag: '"abc"')
    client = build_client
    flush_and_clear(client)

    stub_definitions_api(
      app_key: app_key,
      environment: environment,
      features: features_v1,
      etag: 'W/"abc"'
    )
    client.refresh(force: true)
    expect(cache_counts(client)).to eq([1, 0])
    client.close
  end

  it "counts equal Last-Modified as a hit" do
    lm = "Mon, 01 Jan 2024 00:00:00 GMT"
    stub_definitions_api(
      app_key: app_key,
      environment: environment,
      features: features_v1,
      etag: '"1"',
      headers: { "Last-Modified" => lm }
    )
    client = build_client
    flush_and_clear(client)

    stub_definitions_api(
      app_key: app_key,
      environment: environment,
      features: features_v1,
      etag: '"different"',
      headers: { "Last-Modified" => lm }
    )
    client.refresh(force: true)
    expect(cache_counts(client)).to eq([1, 0])
    client.close
  end

  it "counts equal or older signed timestamp as a hit" do
    stub_definitions_api(app_key: app_key, environment: environment, features: features_v1, etag: '"1"')
    client = build_client
    flush_and_clear(client)

    provider = client.instance_variable_get(:@provider)
    provider.instance_variable_set(:@last_ts, 1_700_000_000)

    body = {
      "defs" => features_v1,
      "signature" => "unused",
      "timestamp" => 1_700_000_000,
      "kid" => "k1"
    }.to_json
    stub_request(:get, "https://definitions.toggly.io/definitions/#{app_key}/#{environment}")
      .to_return(
        status: 200,
        body: body,
        headers: { "Content-Type" => "application/json", "ETag" => '"replay"' }
      )
    client.refresh(force: true)
    expect(cache_counts(client)).to eq([1, 0])
    client.close
  end

  it "counts startup durable snapshot before network as a hit" do
    memory = Toggly::SnapshotProviders::Memory.new
    memory.save(
      {
        "feat-snap" => Toggly::FeatureDefinition.new(feature_key: "feat-snap", enabled: true)
      }
    )

    stub_definitions_api(app_key: app_key, environment: environment, features: features_v1, status: 304, etag: '"snap"')
    client = build_client(snapshot_provider: memory)
    # Snapshot load hit + 304 refresh hit (two attempts; no double-count in one refresh).
    expect(cache_counts(client)).to eq([2, 0])
    expect(client.feature_keys).to include("feat-snap")
    client.close
  end

  it "counts network errors that keep last good defs as a hit" do
    stub_definitions_api(app_key: app_key, environment: environment, features: features_v1, etag: '"1"')
    client = build_client
    flush_and_clear(client)

    stub_definitions_api(app_key: app_key, environment: environment, features: [], status: 500)
    client.refresh
    expect(client.feature_keys).to include("feat-a")
    expect(cache_counts(client)).to eq([1, 0])
    client.close
  end

  it "does not count initial network failure with empty cache as a hit" do
    stub_definitions_api(app_key: app_key, environment: environment, features: [], status: 500)
    client = build_client
    expect(client.feature_keys).to be_empty
    expect(cache_counts(client)).to eq([0, 0])
    client.close
  end

  it "counts skipped poll as a hit and does not suppress WS-forced refresh" do
    stub_definitions_api(app_key: app_key, environment: environment, features: features_v1, etag: '"1"')
    client = build_client
    flush_and_clear(client)

    provider = client.instance_variable_get(:@provider)
    provider.instance_variable_set(:@ws_connected, true)
    provider.instance_variable_set(:@last_fallback_refresh, Time.now)

    expect(provider.should_skip_refresh?).to be true
    client.send(:record_definition_cache_hit)
    expect(cache_counts(client)).to eq([1, 0])

    stub_definitions_api(app_key: app_key, environment: environment, features: features_v2, etag: '"2"')
    client.refresh(force: true, from_websocket: true)
    expect(cache_counts(client)).to eq([0, 1])
    expect(client.feature_keys).to include("feat-b")
    client.close
  end

  it "does not count concurrent in-flight refresh skips" do
    stub_definitions_api(app_key: app_key, environment: environment, features: features_v1, etag: '"1"')
    client = build_client
    flush_and_clear(client)

    client.instance_variable_set(:@refresh_in_flight, true)
    expect(client.refresh(force: true)).to be false
    expect(client.refresh(force: true, from_websocket: true)).to be false
    expect(cache_counts(client)).to eq([0, 0])
    # Leave pending flag set; clear before close so ensure drain is harmless
    client.instance_variable_set(:@pending_ws_refresh, false)
    client.instance_variable_set(:@refresh_in_flight, false)
    client.close
  end

  it "does not increment cache counters from enabled?" do
    stub_definitions_api(app_key: app_key, environment: environment, features: features_v1, etag: '"1"')
    client = build_client
    flush_and_clear(client)

    5.times { client.enabled?("feat-a") }
    client.flush_telemetry
    payload = usage_client.payloads.last
    expect(payload[:definitionCacheHits]).to be_nil
    expect(payload[:definitionCacheMisses]).to be_nil
    expect(payload[:stats]).not_to be_empty
    client.close
  end

  it "restores usage batch including cache counters when SendStats fails" do
    stub_definitions_api(app_key: app_key, environment: environment, features: features_v1, etag: '"1"')
    client = build_client
    flush_and_clear(client)

    telemetry = client.instance_variable_get(:@telemetry)
    telemetry.record_definition_cache_hit
    usage_client.fail_next = true
    client.flush_telemetry
    expect(usage_client.payloads).to be_empty

    telemetry.record_definition_cache_miss
    client.flush_telemetry
    payload = usage_client.payloads.last
    expect(payload[:definitionCacheHits]).to eq(1)
    expect(payload[:definitionCacheMisses]).to eq(1)
    client.close
  end

  it "flushes cache-only batches" do
    stub_definitions_api(app_key: app_key, environment: environment, features: features_v1, etag: '"1"')
    client = build_client
    flush_and_clear(client)

    client.instance_variable_get(:@telemetry).record_definition_cache_hit
    client.flush_telemetry
    expect(usage_client.payloads.size).to eq(1)
    expect(usage_client.payloads.last[:definitionCacheHits]).to eq(1)
    expect(usage_client.payloads.last[:stats]).to eq([])
    client.close
  end
end

RSpec.describe Toggly::DefinitionCache do
  it "matches weak and strong ETags" do
    expect(described_class.etags_match?('"1"', 'W/"1"')).to be true
    expect(described_class.etags_match?('"1"', '"2"')).to be false
    expect(described_class.etags_match?(nil, '"1"')).to be false
  end

  it "matches Last-Modified and signed revision timestamps" do
    lm = "Mon, 01 Jan 2024 00:00:00 GMT"
    expect(described_class.last_modified_match?(lm, lm)).to be true
    expect(described_class.last_modified_match?(lm, nil)).to be false
    expect(described_class.cached_signed_timestamp?(100, 100)).to be true
    expect(described_class.cached_signed_timestamp?(100, 50)).to be true
    expect(described_class.cached_signed_timestamp?(100, 101)).to be false
    expect(described_class.cached_signed_timestamp?(0, 50)).to be false
    expect(described_class.cached_signed_timestamp?(100, nil)).to be false
  end

  it "classifies HTTP responses for cache outcomes" do
    expect(described_class.classify_http(304, '"1"', nil)).to eq(:not_modified)
    expect(described_class.classify_http(200, '"1"', '"1"')).to eq(:same_revision)
    expect(described_class.classify_http(200, '"1"', '"2"')).to eq(:new_content)
    expect(described_class.classify_http(500, '"1"', nil)).to eq(:error_status)
    lm = "Mon, 01 Jan 2024 00:00:00 GMT"
    expect(
      described_class.classify_http(
        200, '"1"', '"2"',
        existing_last_modified: lm,
        response_last_modified: lm
      )
    ).to eq(:same_revision)
  end
end
