# frozen_string_literal: true

module Toggly
  module Telemetry
    # Owns usage + metrics batchers, flush timers, and process-exit handlers.
    class Runtime
      def initialize(
        app_key:,
        environment:,
        metrics_base_url: nil,
        enable_usage_tracking: nil,
        enable_metrics: nil,
        usage_flush_interval: nil,
        metrics_flush_interval: nil,
        instance_name: nil,
        app_version: nil,
        usage_client: nil,
        metrics_client: nil,
        usage_client_provided: false,
        metrics_client_provided: false,
        logger: nil
      )
        has_app_key = !app_key.nil? && !app_key.to_s.empty?
        telemetry_env_disabled = ENV["TOGGLY_DISABLE_TELEMETRY"] == "1"
        default_on = has_app_key && !telemetry_env_disabled

        @app_key = app_key
        @environment = environment
        @metrics_base_url = normalize_url(metrics_base_url || GrpcClients::DEFAULT_METRICS_BASE_URL)
        @enable_usage = enable_usage_tracking.nil? ? default_on : !!enable_usage_tracking
        @enable_metrics = enable_metrics.nil? ? default_on : !!enable_metrics
        @usage_flush_interval = usage_flush_interval.nil? ? GrpcClients::DEFAULT_TELEMETRY_FLUSH_SECONDS : usage_flush_interval.to_f
        @metrics_flush_interval = metrics_flush_interval.nil? ? GrpcClients::DEFAULT_TELEMETRY_FLUSH_SECONDS : metrics_flush_interval.to_f
        @instance_name = instance_name
        @app_version = app_version
        @injected_usage = usage_client
        @injected_metrics = metrics_client
        @usage_client_provided = usage_client_provided
        @metrics_client_provided = metrics_client_provided
        @logger = logger

        @usage_batcher = nil
        @metrics_batcher = nil
        @clients = nil
        @usage_timer = nil
        @metrics_timer = nil
        @sending_usage = false
        @sending_metrics = false
        @closed = false
        @mutex = Mutex.new
        @process_start_time = Time.now.utc
        @atexit_registered = false
        @warned_missing_grpc = false
      end

      def usage_enabled?
        @enable_usage && !@closed
      end

      def metrics_enabled?
        @enable_metrics && !@closed
      end

      def start
        return if @closed
        return unless @enable_usage || @enable_metrics

        if @usage_client_provided || @metrics_client_provided
          @clients = GrpcClients::Clients.new(usage: @injected_usage, metrics: @injected_metrics)
        elsif !GrpcClients.grpc_available?
          warn_missing_grpc
        end

        if @enable_usage
          @usage_batcher = UsageBatcher.new(
            @app_key,
            @environment,
            instance_name: @instance_name,
            app_version: @app_version,
            process_start_time: @process_start_time
          )
          schedule_usage_flush if @usage_flush_interval.positive?
        end

        if @enable_metrics
          @metrics_batcher = MetricsBatcher.new(
            @app_key,
            @environment,
            instance_name: @instance_name
          )
          schedule_metrics_flush if @metrics_flush_interval.positive?
        end

        attach_exit_handlers
      end

      def record_check(feature, enabled, identity = nil, variant: nil, unique_request: false)
        batcher = @mutex.synchronize { @usage_batcher }
        batcher&.record_check(feature, enabled, identity, variant: variant, unique_request: unique_request)
      end

      def record_usage(feature, identity = nil, variant: "enabled")
        batcher = @mutex.synchronize { @usage_batcher }
        batcher&.record_usage(feature, identity, variant: variant)
      end

      def record_view(feature, identity = nil, variant: "enabled")
        batcher = @mutex.synchronize { @usage_batcher }
        batcher&.record_view(feature, identity, variant: variant)
      end

      def measure(metric, value, options = nil)
        batcher = @mutex.synchronize { @metrics_batcher }
        batcher&.measure(metric, value, options)
      end

      def increment_counter(metric, value = 1.0, options = nil)
        batcher = @mutex.synchronize { @metrics_batcher }
        batcher&.increment_counter(metric, value, options)
      end

      def observe(metric, value, options = nil)
        batcher = @mutex.synchronize { @metrics_batcher }
        batcher&.observe(metric, value, options)
      end

      def flush_usage
        client = nil
        payload = nil
        @mutex.synchronize do
          return if @usage_batcher.nil? || @sending_usage
          return if @usage_batcher.empty?

          ensure_native_clients
          client = @clients&.usage
          return if client.nil? || !client.respond_to?(:send_stats)

          payload = @usage_batcher.build_and_reset
          return if payload.nil?

          @sending_usage = true
        end

        begin
          client.send_stats(payload)
        rescue StandardError => e
          log_error("Failed to send usage stats: #{e.message}")
        ensure
          @mutex.synchronize { @sending_usage = false }
        end
      end

      def flush_metrics
        client = nil
        payload = nil
        @mutex.synchronize do
          return if @metrics_batcher.nil? || @sending_metrics
          return if @metrics_batcher.empty?

          ensure_native_clients
          client = @clients&.metrics
          return if client.nil? || !client.respond_to?(:send_metrics)

          payload = @metrics_batcher.build_and_reset
          return if payload.nil?

          @sending_metrics = true
        end

        begin
          client.send_metrics(payload)
        rescue StandardError => e
          log_error("Failed to send metrics: #{e.message}")
        ensure
          @mutex.synchronize { @sending_metrics = false }
        end
      end

      def flush_all
        flush_usage
        flush_metrics
      end

      def close
        @mutex.synchronize do
          return if @closed

          @closed = true
          @usage_timer&.kill
          @usage_timer = nil
          @metrics_timer&.kill
          @metrics_timer = nil
        end

        begin
          flush_all
        ensure
          clients = @clients
          @clients = nil
          @usage_batcher = nil
          @metrics_batcher = nil
          [clients&.usage, clients&.metrics].compact.uniq.each do |side|
            side.close if side.respond_to?(:close)
          rescue StandardError
            # best-effort
          end
        end
      end

      private

      def normalize_url(url)
        u = url.to_s
        u.end_with?("/") ? u : "#{u}/"
      end

      def warn_missing_grpc
        return if @warned_missing_grpc

        @warned_missing_grpc = true
        log_warn(
          "Usage/metrics enabled but the optional grpc gem is not installed. " \
          "Install `grpc` (and google-protobuf) to send telemetry."
        )
      end

      def ensure_native_clients
        return if @clients
        return if @usage_client_provided || @metrics_client_provided
        return unless GrpcClients.grpc_available?

        @clients = GrpcClients.create(@metrics_base_url)
        return if @clients

        log_warn("Failed to create Toggly gRPC clients; telemetry send disabled")
      end

      def schedule_usage_flush
        return if @closed || @usage_flush_interval <= 0

        @usage_timer = Thread.new do
          loop do
            sleep(@usage_flush_interval)
            break if @closed

            flush_usage
          end
        end
        @usage_timer.abort_on_exception = false
      end

      def schedule_metrics_flush
        return if @closed || @metrics_flush_interval <= 0

        @metrics_timer = Thread.new do
          loop do
            sleep(@metrics_flush_interval)
            break if @closed

            flush_metrics
          end
        end
        @metrics_timer.abort_on_exception = false
      end

      def attach_exit_handlers
        return if @atexit_registered

        at_exit do
          close
        rescue StandardError
          # best-effort flush on exit
        end
        @atexit_registered = true
      end

      def log_warn(message)
        @logger&.warn("[Toggly] #{message}")
      end

      def log_error(message)
        @logger&.error("[Toggly] #{message}")
      end
    end
  end
end
