# frozen_string_literal: true

module Toggly
  module Telemetry
    # In-memory feature usage aggregator (Usage.SendStats payload shape).
    class UsageBatcher
      VariantStatsAgg = Struct.new(:check_count, :request_count, :used_count, :viewed_count, keyword_init: true) do
        def initialize(check_count: 0, request_count: 0, used_count: 0, viewed_count: 0)
          super
        end

        def to_wire
          {
            checkCount: check_count,
            requestCount: request_count,
            usedCount: used_count,
            viewedCount: viewed_count
          }
        end
      end

      FeatureUsageAgg = Struct.new(
        :variant_stats,
        :unique_users_enabled,
        :unique_users_disabled,
        :unique_users_used,
        :unique_user_hashes,
        :unique_viewed_user_hashes,
        keyword_init: true
      ) do
        def initialize(
          variant_stats: {},
          unique_users_enabled: Set.new,
          unique_users_disabled: Set.new,
          unique_users_used: Set.new,
          unique_user_hashes: Set.new,
          unique_viewed_user_hashes: Set.new
        )
          super
        end
      end

      def initialize(app_key, environment, instance_name: nil, app_version: nil, process_start_time: nil)
        @app_key = app_key
        @environment = environment
        @instance_name = instance_name
        @app_version = app_version
        @process_start_time = process_start_time || Time.now.utc
        @per_feature = {}
        @app_unique = Set.new
        @mutex = Mutex.new
      end

      def record_check(feature, enabled, identity = nil, variant: nil, unique_request: false)
        @mutex.synchronize do
          agg = get_feature(feature)
          name = if variant.nil?
                   enabled ? "enabled" : "disabled"
                 else
                   variant.to_s
                 end
          stats = get_variant(agg, name)
          stats.check_count += 1
          stats.request_count += 1 if unique_request

          if identity && !identity.to_s.empty?
            hashed = GrpcClients.hash_identity(identity)
            @app_unique.add(hashed)
            if enabled
              agg.unique_users_enabled.add(hashed)
            else
              agg.unique_users_disabled.add(hashed)
            end
          end
        end
      end

      def record_usage(feature, identity = nil, variant: "enabled")
        @mutex.synchronize do
          agg = get_feature(feature)
          get_variant(agg, variant.to_s).used_count += 1
          track_identity(identity, agg.unique_users_used)
          agg.unique_user_hashes.add(GrpcClients.hash_identity(identity)) if identity && !identity.to_s.empty?
        end
      end

      def record_view(feature, identity = nil, variant: "enabled")
        @mutex.synchronize do
          agg = get_feature(feature)
          get_variant(agg, variant.to_s).viewed_count += 1
          if identity && !identity.to_s.empty?
            hashed = GrpcClients.hash_identity(identity)
            @app_unique.add(hashed)
            agg.unique_viewed_user_hashes.add(hashed)
          end
        end
      end

      def empty?
        @mutex.synchronize { @per_feature.empty? && @app_unique.empty? }
      end

      def build_and_reset
        @mutex.synchronize do
          return nil if @per_feature.empty? && @app_unique.empty?

          payload = base_payload
          payload[:stats] = drain_feature_stats
          @per_feature = {}
          @app_unique = Set.new
          payload
        end
      end

      private

      def base_payload
        payload = {
          appKey: @app_key,
          environment: @environment,
          time: GrpcClients.to_protobuf_timestamp,
          stats: [],
          totalUniqueUsers: @app_unique.size,
          uniqueUserHashes: @app_unique.to_a,
          processStartTime: GrpcClients.to_protobuf_timestamp(@process_start_time)
        }
        payload[:instanceName] = @instance_name if @instance_name
        payload[:appVersion] = @app_version if @app_version
        payload
      end

      def drain_feature_stats
        @per_feature.map do |feature, agg|
          {
            feature: feature,
            uniqueContextIdentifierEnabledCount: agg.unique_users_enabled.size,
            uniqueContextIdentifierDisabledCount: agg.unique_users_disabled.size,
            uniqueUsersUsedCount: agg.unique_users_used.size,
            uniqueUserHashes: agg.unique_user_hashes.to_a,
            uniqueViewedUserHashes: agg.unique_viewed_user_hashes.to_a,
            variantStats: wire_variant_stats(agg)
          }
        end
      end

      def wire_variant_stats(agg)
        variant_stats = {}
        agg.variant_stats.each do |name, vs|
          next unless vs.check_count.positive? || vs.request_count.positive? ||
                      vs.used_count.positive? || vs.viewed_count.positive?

          variant_stats[name] = vs.to_wire
        end
        variant_stats
      end

      def get_feature(feature)
        @per_feature[feature] ||= FeatureUsageAgg.new
      end

      def get_variant(agg, variant)
        agg.variant_stats[variant] ||= VariantStatsAgg.new
      end

      def track_identity(identity, into)
        return if identity.nil? || identity.to_s.empty?

        hashed = GrpcClients.hash_identity(identity)
        @app_unique.add(hashed)
        into.add(hashed)
      end
    end
  end
end
