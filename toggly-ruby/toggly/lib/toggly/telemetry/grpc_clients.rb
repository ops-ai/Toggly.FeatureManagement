# frozen_string_literal: true

require "uri"

module Toggly
  module Telemetry
    # Optional gRPC transport helpers for usage and metrics telemetry.
    module GrpcClients
      DEFAULT_METRICS_BASE_URL = "https://app.toggly.io/"
      DEFAULT_TELEMETRY_FLUSH_SECONDS = 60.0

      # HTTP/2 metadata is case-insensitive; .NET/Go/Node send ``UA``.
      # The Ruby grpc gem lowercases keys, so we send ``ua`` with the same
      # user-agent semantics.
      GRPC_USER_AGENT_METADATA_KEY = "ua"

      module_function

      # FNV-1a 32-bit as signed int32 (UTF-8 bytes; matches Go/Node/Python).
      #
      # @param identity [String]
      # @return [Integer] signed int32
      def hash_identity(identity)
        h = 2_166_136_261
        identity.to_s.encode("UTF-8").bytes.each do |byte|
          h ^= byte
          h = (h * 16_777_619) & 0xFFFFFFFF
        end
        h > 0x7FFFFFFF ? h - 0x100000000 : h
      end

      # @param time [Time, nil]
      # @return [Hash{Symbol => Integer}] protobuf Timestamp shape
      def to_protobuf_timestamp(time = nil)
        t = time || Time.now.utc
        t = t.utc
        ms = (t.to_f * 1000).to_i
        {
          seconds: ms / 1000,
          nanos: (ms % 1000) * 1_000_000
        }
      end

      # @param base_url [String]
      # @return [String] host:port for a gRPC channel
      def grpc_target(base_url)
        raw = base_url.to_s.strip
        raw = "https://#{raw}" unless raw.include?("://")
        uri = begin
          URI.parse(raw)
        rescue URI::InvalidURIError
          nil
        end
        host = if uri
                 uri.host || uri.path
               else
                 raw.sub(%r{\Ahttps?://}i, "").delete_suffix("/")
               end
        host = host.to_s.delete_suffix("/")
        host = "app.toggly.io:443" if host.empty?
        host = "#{host}:443" unless host.include?(":")
        host
      end

      # @param override [String, nil]
      # @return [String]
      def resolve_user_agent(override = nil)
        override || "toggly-ruby/#{Toggly::VERSION}"
      end

      # @return [Boolean]
      def grpc_available?
        return @grpc_available unless @grpc_available.nil?

        require "grpc"
        require_relative "pb/usage_services_pb"
        require_relative "pb/metrics_services_pb"
        @grpc_available = true
      rescue LoadError
        @grpc_available = false
      end

      # @param metrics_base_url [String]
      # @param user_agent [String, nil]
      # @param timeout [Numeric]
      # @return [Clients, nil]
      def create(metrics_base_url, user_agent: nil, timeout: 10.0)
        return nil unless grpc_available?

        require "grpc"

        target = grpc_target(metrics_base_url)
        channel = GRPC::Core::Channel.new(target, {}, GRPC::Core::ChannelCredentials.new)
        shared = SharedChannel.new(channel)
        ua = resolve_user_agent(user_agent)
        default_meta = { GRPC_USER_AGENT_METADATA_KEY => ua }

        usage_stub = Pb::Usage::Usage::Stub.new(target, GRPC::Core::ChannelCredentials.new,
                                                channel_override: channel)
        metrics_stub = Pb::Metrics::Metrics::Stub.new(target, GRPC::Core::ChannelCredentials.new,
                                                      channel_override: channel)

        Clients.new(
          usage: NativeUsageClient.new(usage_stub, shared, default_meta, timeout),
          metrics: NativeMetricsClient.new(metrics_stub, shared, default_meta, timeout)
        )
      end

      # Paired usage + metrics clients.
      Clients = Struct.new(:usage, :metrics, keyword_init: true)

      # Shared channel closer (close once).
      class SharedChannel
        def initialize(channel)
          @channel = channel
          @closed = false
          @mutex = Mutex.new
        end

        def close
          @mutex.synchronize do
            return if @closed

            @closed = true
            @channel.close
          end
        end
      end

      # Converts batcher hashes into Usage.FeatureStat and sends via stub.
      class NativeUsageClient
        def initialize(stub, shared, default_metadata, timeout)
          @stub = stub
          @shared = shared
          @default_metadata = default_metadata.transform_keys(&:to_s)
          @timeout = timeout
        end

        def send_stats(request, metadata: nil)
          meta = @default_metadata.merge((metadata || {}).transform_keys(&:to_s))
          msg = feature_stat_from_payload(request)
          @stub.send_stats(msg, metadata: meta.to_a, deadline: Time.now + @timeout)
        end

        def close
          @shared.close
        end

        private

        def feature_stat_from_payload(payload)
          msg = Pb::Usage::FeatureStat.new(
            appKey: payload[:appKey].to_s,
            environment: payload[:environment].to_s,
            totalUniqueUsers: payload[:totalUniqueUsers].to_i,
            uniqueUserHashes: Array(payload[:uniqueUserHashes]).map(&:to_i)
          )
          apply_timestamp(msg.time, payload[:time])
          msg.instanceName = payload[:instanceName].to_s if payload[:instanceName]
          msg.appVersion = payload[:appVersion].to_s if payload[:appVersion]
          apply_timestamp(msg.processStartTime, payload[:processStartTime]) if payload[:processStartTime]

          Array(payload[:stats]).each do |stat|
            next unless stat.is_a?(Hash)

            sm = Pb::Usage::StatMessage.new(
              feature: stat[:feature].to_s,
              uniqueContextIdentifierEnabledCount: stat[:uniqueContextIdentifierEnabledCount].to_i,
              uniqueContextIdentifierDisabledCount: stat[:uniqueContextIdentifierDisabledCount].to_i,
              uniqueUsersUsedCount: stat[:uniqueUsersUsedCount].to_i,
              uniqueUserHashes: Array(stat[:uniqueUserHashes]).map(&:to_i),
              uniqueViewedUserHashes: Array(stat[:uniqueViewedUserHashes]).map(&:to_i)
            )
            (stat[:variantStats] || {}).each do |name, vs|
              next unless vs.is_a?(Hash)

              sm.variantStats[name.to_s] = Pb::Usage::VariantStats.new(
                checkCount: vs[:checkCount].to_i,
                requestCount: vs[:requestCount].to_i,
                usedCount: vs[:usedCount].to_i,
                viewedCount: vs[:viewedCount].to_i
              )
            end
            msg.stats << sm
          end
          msg
        end

        def apply_timestamp(field, ts)
          return unless ts.is_a?(Hash)

          field.seconds = ts[:seconds].to_i
          field.nanos = ts[:nanos].to_i
        end
      end

      # Converts batcher hashes into Metrics.MetricStat and sends via stub.
      class NativeMetricsClient
        def initialize(stub, shared, default_metadata, timeout)
          @stub = stub
          @shared = shared
          @default_metadata = default_metadata.transform_keys(&:to_s)
          @timeout = timeout
        end

        def send_metrics(request, metadata: nil)
          meta = @default_metadata.merge((metadata || {}).transform_keys(&:to_s))
          msg = metric_stat_from_payload(request)
          @stub.send_metrics(msg, metadata: meta.to_a, deadline: Time.now + @timeout)
        end

        def close
          @shared.close
        end

        private

        def metric_stat_from_payload(payload)
          msg = Pb::Metrics::MetricStat.new(
            appKey: payload[:appKey].to_s,
            environment: payload[:environment].to_s
          )
          apply_timestamp(msg.time, payload[:time])
          msg.instanceName = payload[:instanceName].to_s if payload[:instanceName]

          Array(payload[:stats]).each do |item|
            next unless item.is_a?(Hash)

            sm = Pb::Metrics::MetricStatMessage.new(metric: item[:metric].to_s)
            sm.feature = item[:feature].to_s if item[:feature]
            fill_variant_values(sm, item[:variantValues])
            msg.stats << sm
          end

          Array(payload[:counters]).each do |item|
            next unless item.is_a?(Hash)

            cm = Pb::Metrics::MetricCounterMessage.new(metric: item[:metric].to_s)
            cm.feature = item[:feature].to_s if item[:feature]
            fill_variant_values(cm, item[:variantValues])
            msg.counters << cm
          end

          Array(payload[:observations]).each do |item|
            next unless item.is_a?(Hash)

            om = Pb::Metrics::MetricObservationMessage.new(metric: item[:metric].to_s)
            apply_timestamp(om.time, item[:time])
            om.feature = item[:feature].to_s if item[:feature]
            fill_variant_values(om, item[:variantValues])
            msg.observations << om
          end
          msg
        end

        def fill_variant_values(target, variant_values)
          return unless variant_values.is_a?(Hash)

          variant_values.each do |name, value|
            target.variantValues[name.to_s] = value.to_f
          end
        end

        def apply_timestamp(field, ts)
          return unless ts.is_a?(Hash)

          field.seconds = ts[:seconds].to_i
          field.nanos = ts[:nanos].to_i
        end
      end
    end
  end
end
