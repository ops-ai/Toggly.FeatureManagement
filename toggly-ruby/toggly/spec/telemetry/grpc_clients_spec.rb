# frozen_string_literal: true

RSpec.describe "Native gRPC conversion path" do
  before(:all) do
    skip "optional grpc/google-protobuf not installed" unless Toggly::Telemetry.grpc_available?
  end

  let(:ua_key) { Toggly::Telemetry::GRPC_USER_AGENT_METADATA_KEY }

  describe "feature_stat_from_payload" do
    it "builds FeatureStat with timestamps and variantStats without nil mutation" do
      payload = {
        appKey: "app",
        environment: "Production",
        time: { seconds: 1_700_000_000, nanos: 0 },
        processStartTime: { seconds: 1_699_999_000, nanos: 500_000_000 },
        totalUniqueUsers: 1,
        uniqueUserHashes: [42],
        instanceName: "worker-1",
        appVersion: "1.2.3",
        stats: [
          {
            feature: "FeatureA",
            uniqueContextIdentifierEnabledCount: 1,
            uniqueContextIdentifierDisabledCount: 0,
            uniqueUsersUsedCount: 1,
            uniqueUserHashes: [42],
            uniqueViewedUserHashes: [],
            variantStats: {
              "enabled" => {
                checkCount: 2,
                requestCount: 1,
                usedCount: 1,
                viewedCount: 0
              }
            }
          }
        ]
      }

      msg = Toggly::Telemetry::GrpcClients.feature_stat_from_payload(payload)
      raw = msg.to_proto
      expect(raw).to be_a(String)
      expect(raw.bytesize).to be_positive
      expect(msg.appKey).to eq("app")
      expect(msg.time).not_to be_nil
      expect(msg.time.seconds).to eq(1_700_000_000)
      expect(msg.processStartTime).not_to be_nil
      expect(msg.processStartTime.seconds).to eq(1_699_999_000)
      expect(msg.stats[0].feature).to eq("FeatureA")
      expect(msg.stats[0].variantStats["enabled"].checkCount).to eq(2)
      expect(msg.stats[0].variantStats["enabled"].requestCount).to eq(1)
    end

    it "maps definitionCacheHits and definitionCacheMisses" do
      payload = {
        appKey: "app",
        environment: "Production",
        time: { seconds: 1_700_000_000, nanos: 0 },
        totalUniqueUsers: 0,
        uniqueUserHashes: [],
        definitionCacheHits: 3,
        definitionCacheMisses: 1,
        stats: []
      }

      msg = Toggly::Telemetry::GrpcClients.feature_stat_from_payload(payload)
      expect(msg.definitionCacheHits).to eq(3)
      expect(msg.definitionCacheMisses).to eq(1)
    end
  end

  describe "metric_stat_from_payload" do
    it "builds MetricStat with variantValues and observation timestamps" do
      payload = {
        appKey: "app",
        environment: "Production",
        time: { seconds: 1_700_000_000, nanos: 0 },
        stats: [
          {
            metric: "revenue",
            feature: "FeatureA",
            variantValues: { "enabled" => 9.5 }
          }
        ],
        counters: [{ metric: "clicks", variantValues: { "enabled" => 3.0 } }],
        observations: [
          {
            time: { seconds: 1_700_000_001, nanos: 0 },
            metric: "depth",
            variantValues: { "enabled" => 2.0 }
          }
        ]
      }

      msg = Toggly::Telemetry::GrpcClients.metric_stat_from_payload(payload)
      raw = msg.to_proto
      expect(raw).to be_a(String)
      expect(raw.bytesize).to be_positive
      expect(msg.time).not_to be_nil
      expect(msg.time.seconds).to eq(1_700_000_000)
      expect(msg.stats[0].metric).to eq("revenue")
      expect(msg.stats[0].variantValues["enabled"]).to eq(9.5)
      expect(msg.counters[0].metric).to eq("clicks")
      expect(msg.observations[0].metric).to eq("depth")
      expect(msg.observations[0].time).not_to be_nil
      expect(msg.observations[0].time.seconds).to eq(1_700_000_001)
      expect(msg.observations[0].variantValues["enabled"]).to eq(2.0)
    end
  end

  describe "native clients metadata" do
    let(:shared) do
      Toggly::Telemetry::GrpcClients::SharedChannel.new(
        Class.new do
          def close; end
        end.new
      )
    end

    it "attaches lowercase ua metadata on usage send_stats" do
      stub = Class.new do
        attr_reader :calls

        def initialize
          @calls = []
        end

        def send_stats(request, metadata: nil, deadline: nil)
          @calls << { request: request, metadata: metadata, deadline: deadline }
          nil
        end
      end.new

      ua = Toggly::Telemetry.resolve_user_agent
      client = Toggly::Telemetry::GrpcClients::NativeUsageClient.new(
        stub,
        shared,
        { ua_key => ua },
        5.0
      )
      client.send_stats(
        {
          appKey: "app",
          environment: "Production",
          time: { seconds: 1, nanos: 0 },
          stats: [
            {
              feature: "FeatureA",
              variantStats: {
                "enabled" => { checkCount: 1, requestCount: 0, usedCount: 0, viewedCount: 0 }
              }
            }
          ]
        }
      )

      expect(stub.calls.size).to eq(1)
      meta = stub.calls[0][:metadata]
      expect(meta).to include([ua_key, ua])
      expect(ua_key).to eq("ua")
      expect(ua).to eq("toggly-ruby/#{Toggly::VERSION}")
      expect(stub.calls[0][:request].to_proto.bytesize).to be_positive
      expect(stub.calls[0][:request].stats[0].feature).to eq("FeatureA")
      assert_grpc_accepts_metadata(meta)
    end

    it "attaches lowercase ua metadata on metrics send_metrics" do
      stub = Class.new do
        attr_reader :calls

        def initialize
          @calls = []
        end

        def send_metrics(request, metadata: nil, deadline: nil)
          @calls << { request: request, metadata: metadata, deadline: deadline }
          nil
        end
      end.new

      ua = "custom-ua/1.0"
      client = Toggly::Telemetry::GrpcClients::NativeMetricsClient.new(
        stub,
        shared,
        { ua_key => ua },
        5.0
      )
      client.send_metrics(
        {
          appKey: "app",
          environment: "Production",
          time: { seconds: 1, nanos: 0 },
          stats: [{ metric: "revenue", variantValues: { "enabled" => 1.0 } }],
          counters: [],
          observations: []
        }
      )

      expect(stub.calls.size).to eq(1)
      meta = stub.calls[0][:metadata]
      expect(meta).to eq([["ua", ua]])
      assert_grpc_accepts_metadata(meta)
      expect(stub.calls[0][:request].to_proto.bytesize).to be_positive
    end

    it "rejects uppercase UA metadata key (grpc regression)" do
      expect do
        invoke_with_metadata([["UA", Toggly::Telemetry.resolve_user_agent]])
      end.to raise_error(StandardError) { |err|
        message = err.message.downcase
        expect(message).to match(/metadata|illegal header|invalid|ascii/)
      }
    end
  end

  describe "Runtime cooperative timer stop" do
    it "joins flush threads without Thread#kill on close" do
      usage = Class.new do
        attr_reader :payloads

        def initialize
          @payloads = []
        end

        def send_stats(payload)
          @payloads << payload
        end

        def close; end
      end.new
      metrics = Class.new do
        def send_metrics(_payload); end

        def close; end
      end.new

      runtime = Toggly::Telemetry::Runtime.new(
        app_key: "app",
        environment: "Production",
        enable_usage_tracking: true,
        enable_metrics: true,
        usage_flush_interval: 60,
        metrics_flush_interval: 60,
        usage_client: usage,
        metrics_client: metrics,
        usage_client_provided: true,
        metrics_client_provided: true
      )
      runtime.start
      runtime.record_check("FeatureA", true, "user-1")
      expect { runtime.close }.not_to raise_error
      expect(usage.payloads.size).to eq(1)
    end
  end

  def invoke_with_metadata(metadata)
    require "grpc"
    channel = GRPC::Core::Channel.new("localhost:1", {}, :this_channel_is_insecure)
    begin
      stub = GRPC::ClientStub.new("localhost:1", :this_channel_is_insecure, channel_override: channel)
      stub.request_response(
        "/test.Service/Method",
        "",
        ->(x) { x },
        ->(x) { x },
        metadata: metadata.to_h,
        deadline: Time.now + 0.01
      )
    ensure
      channel.close
    end
  end

  def assert_grpc_accepts_metadata(metadata)
    invoke_with_metadata(metadata)
  rescue GRPC::BadStatus, GRPC::Core::CallError
    # Connection failure is expected; metadata already passed client validation.
  rescue ArgumentError, TypeError => e
    # Some Ruby grpc versions validate keys eagerly.
    raise e if e.message.match?(/metadata|header|illegal|invalid|ascii/i)
  end
end
