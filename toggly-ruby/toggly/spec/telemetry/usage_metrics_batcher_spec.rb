# frozen_string_literal: true

RSpec.describe Toggly::Telemetry do
  describe ".hash_identity" do
    it "matches Go/Node FNV-1a UTF-8 signed int32 golden vectors" do
      alice = described_class.hash_identity("alice")
      expect(alice).to be_a(Integer)
      expect(alice).to eq(described_class.hash_identity("alice"))
      expect(alice).not_to eq(described_class.hash_identity("bob"))

      expect(alice).to eq(-2_027_809_817)
      expect(described_class.hash_identity("café")).to eq(-1_473_556_407)
      expect(described_class.hash_identity("🚀")).to eq(2_141_686_490)
    end

    it "differs from UTF-16 / code-unit style hashing for multi-byte strings" do
      value = "café"
      utf16_style = 2_166_136_261
      value.each_char do |ch|
        utf16_style ^= ch.ord
        utf16_style = (utf16_style * 16_777_619) & 0xFFFFFFFF
      end
      utf16_signed = utf16_style > 0x7FFFFFFF ? utf16_style - 0x100000000 : utf16_style
      expect(described_class.hash_identity(value)).not_to eq(utf16_signed)
    end
  end
end

RSpec.describe Toggly::Telemetry::UsageBatcher do
  it "aggregates checks into variantStats" do
    batcher = described_class.new(
      "app",
      "Production",
      instance_name: "host-1",
      app_version: "1.2.3"
    )

    batcher.record_check("FeatureA", true, "user-1")
    batcher.record_check("FeatureA", true, "user-1")
    batcher.record_check("FeatureA", false, "user-2")
    batcher.record_usage("FeatureA", "user-1")
    batcher.record_view("FeatureA", "user-3")

    payload = batcher.build_and_reset
    expect(payload).not_to be_nil
    expect(payload[:appKey]).to eq("app")
    expect(payload[:environment]).to eq("Production")
    expect(payload[:instanceName]).to eq("host-1")
    expect(payload[:appVersion]).to eq("1.2.3")
    expect(payload[:processStartTime]).not_to be_nil
    expect(payload[:stats].size).to eq(1)

    stat = payload[:stats][0]
    expect(stat[:feature]).to eq("FeatureA")
    expect(stat[:variantStats]["enabled"][:checkCount]).to eq(2)
    expect(stat[:variantStats]["enabled"][:requestCount]).to eq(0)
    expect(stat[:variantStats]["enabled"][:usedCount]).to eq(1)
    expect(stat[:variantStats]["enabled"][:viewedCount]).to eq(1)
    expect(stat[:variantStats]["disabled"][:checkCount]).to eq(1)
    expect(stat[:uniqueContextIdentifierEnabledCount]).to eq(1)
    expect(stat[:uniqueContextIdentifierDisabledCount]).to eq(1)
    expect(stat[:uniqueUsersUsedCount]).to eq(1)
    expect(stat[:uniqueUserHashes]).to include(Toggly::Telemetry.hash_identity("user-1"))
    expect(stat[:uniqueViewedUserHashes]).to include(Toggly::Telemetry.hash_identity("user-3"))
    expect(payload[:uniqueUserHashes]).to contain_exactly(
      Toggly::Telemetry.hash_identity("user-1"),
      Toggly::Telemetry.hash_identity("user-2"),
      Toggly::Telemetry.hash_identity("user-3")
    )

    expect(batcher.build_and_reset).to be_nil
  end

  it "increments requestCount only when unique_request is true" do
    batcher = described_class.new("app", "Production")
    batcher.record_check("FeatureA", true, "user-1", unique_request: true)
    batcher.record_check("FeatureA", true, "user-1", unique_request: false)
    batcher.record_check("FeatureA", false, "user-2", unique_request: true)

    payload = batcher.build_and_reset
    expect(payload[:stats][0][:variantStats]["enabled"][:checkCount]).to eq(2)
    expect(payload[:stats][0][:variantStats]["enabled"][:requestCount]).to eq(1)
    expect(payload[:stats][0][:variantStats]["disabled"][:checkCount]).to eq(1)
    expect(payload[:stats][0][:variantStats]["disabled"][:requestCount]).to eq(1)
  end

  it "supports custom variant names" do
    batcher = described_class.new("app", "Production")
    batcher.record_check("FeatureA", true, variant: "control")
    payload = batcher.build_and_reset
    expect(payload[:stats][0][:variantStats]["control"][:checkCount]).to eq(1)
    expect(payload[:stats][0][:variantStats]).not_to have_key("enabled")
  end
end

RSpec.describe Toggly::Telemetry::MetricsBatcher do
  it "aggregates measure, increment, and observe into variantValues" do
    batcher = described_class.new("app", "Production", instance_name: "host-1")

    batcher.measure("revenue", 10)
    batcher.measure("revenue", 5, Toggly::Telemetry::MetricsFeatureOptions.new(feature: "Checkout", variant: "enabled"))
    batcher.measure("revenue", 2, Toggly::Telemetry::MetricsFeatureOptions.new(feature: "Checkout", variant: "disabled"))
    batcher.increment_counter("clicks", 3)
    batcher.increment_counter("clicks", 1, Toggly::Telemetry::MetricsFeatureOptions.new(feature: "Banner"))
    batcher.observe("latency_ms", 12.5)
    batcher.observe(
      "latency_ms",
      8,
      Toggly::Telemetry::MetricsFeatureOptions.new(feature: "Checkout", variant: "control")
    )

    payload = batcher.build_and_reset
    expect(payload).not_to be_nil
    expect(payload[:appKey]).to eq("app")
    expect(payload[:instanceName]).to eq("host-1")

    global_revenue = payload[:stats].find { |s| s[:metric] == "revenue" && !s.key?(:feature) }
    expect(global_revenue[:variantValues]["enabled"]).to eq(10)

    checkout_revenue = payload[:stats].find { |s| s[:metric] == "revenue" && s[:feature] == "Checkout" }
    expect(checkout_revenue[:variantValues]["enabled"]).to eq(5)
    expect(checkout_revenue[:variantValues]["disabled"]).to eq(2)

    clicks = payload[:counters].find { |c| c[:metric] == "clicks" && !c.key?(:feature) }
    expect(clicks[:variantValues]["enabled"]).to eq(3)

    banner_clicks = payload[:counters].find { |c| c[:metric] == "clicks" && c[:feature] == "Banner" }
    expect(banner_clicks[:variantValues]["enabled"]).to eq(1)

    expect(payload[:observations].size).to be >= 2
    global_obs = payload[:observations].find { |o| o[:metric] == "latency_ms" && !o.key?(:feature) }
    expect(global_obs[:variantValues]["enabled"]).to eq(12.5)
    checkout_obs = payload[:observations].find { |o| o[:metric] == "latency_ms" && o[:feature] == "Checkout" }
    expect(checkout_obs[:variantValues]["control"]).to eq(8)

    expect(batcher.build_and_reset).to be_nil
  end
end
