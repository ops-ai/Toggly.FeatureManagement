# frozen_string_literal: true

module Toggly
  module Telemetry
    # Optional feature/variant correlation for a metric sample.
    MetricsFeatureOptions = Struct.new(:feature, :variant, keyword_init: true)

    # In-memory business metrics aggregator (Metrics.SendMetrics payload shape).
    class MetricsBatcher
      def initialize(app_key, environment, instance_name: nil)
        @app_key = app_key
        @environment = environment
        @instance_name = instance_name
        @measures = {}
        @counters = {}
        @observations = []
        @mutex = Mutex.new
      end

      def measure(metric, value, options = nil)
        @mutex.synchronize { add_to_map(@measures, metric, value.to_f, options) }
      end

      def increment_counter(metric, value = 1.0, options = nil)
        @mutex.synchronize { add_to_map(@counters, metric, value.to_f, options) }
      end

      def observe(metric, value, options = nil)
        @mutex.synchronize do
          opts = normalize_options(options)
          variant = opts&.variant && !opts.variant.to_s.empty? ? opts.variant.to_s : "enabled"
          feature = opts&.feature
          @observations << {
            time: Time.now.utc,
            metric: metric.to_s,
            feature: feature,
            variant: variant,
            value: value.to_f
          }
        end
      end

      def empty?
        @mutex.synchronize { @measures.empty? && @counters.empty? && @observations.empty? }
      end

      def build_and_reset
        @mutex.synchronize do
          return nil if @measures.empty? && @counters.empty? && @observations.empty?

          payload = {
            appKey: @app_key,
            environment: @environment,
            time: GrpcClients.to_protobuf_timestamp,
            stats: drain_map(@measures),
            counters: drain_map(@counters),
            observations: drain_observations
          }
          payload[:instanceName] = @instance_name if @instance_name
          payload
        end
      end

      def self.options_from_hash(options)
        return nil if options.nil?
        return options if options.is_a?(MetricsFeatureOptions)

        MetricsFeatureOptions.new(
          feature: options[:feature] || options["feature"],
          variant: options[:variant] || options["variant"]
        )
      end

      private

      def normalize_options(options)
        self.class.options_from_hash(options)
      end

      def metric_key(metric, feature)
        [metric.to_s, feature.to_s]
      end

      def add_to_map(store, metric, value, options)
        opts = normalize_options(options)
        variant = "enabled"
        feature = nil
        if opts
          variant = opts.variant.to_s unless opts.variant.nil? || opts.variant.to_s.empty?
          feature = opts.feature
        end
        key = metric_key(metric, feature)
        variants = store[key] ||= {}
        variants[variant] = variants.fetch(variant, 0.0) + value
      end

      def drain_map(store)
        out = []
        store.each do |(metric, feature), variants|
          variant_values = variants.reject { |_n, v| v.zero? }
          next if variant_values.empty?

          item = { metric: metric, variantValues: variant_values }
          item[:feature] = feature unless feature.empty?
          out << item
        end
        store.clear
        out
      end

      def drain_observations
        observation_messages = []
        groups = {}
        @observations.each do |obs|
          when_t = obs[:time]
          group_key = "#{when_t.to_f}\0#{obs[:metric]}\0#{obs[:feature] || ""}"
          group = groups[group_key]
          if group.nil? || group[:variantValues].key?(obs[:variant])
            group = new_observation_group(when_t, obs)
            groups[group_key] = group
            observation_messages << group
          end
          group[:variantValues][obs[:variant]] = obs[:value]
        end
        @observations = []
        observation_messages
      end

      def new_observation_group(when_t, obs)
        group = {
          time: GrpcClients.to_protobuf_timestamp(when_t),
          metric: obs[:metric],
          variantValues: {}
        }
        group[:feature] = obs[:feature] if obs[:feature] && !obs[:feature].to_s.empty?
        group
      end
    end
  end
end
