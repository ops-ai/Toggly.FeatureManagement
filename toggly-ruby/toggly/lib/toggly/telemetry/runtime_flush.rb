# frozen_string_literal: true

module Toggly
  module Telemetry
    # Usage/metrics flush + native gRPC client bootstrap for Runtime.
    module RuntimeFlush
      def flush_usage
        client = nil
        batcher = nil
        snapshot = nil
        payload = nil
        @mutex.synchronize do
          return if @usage_batcher.nil? || @sending_usage
          return if @usage_batcher.empty?

          ensure_native_clients
          client = @clients&.usage
          return if client.nil? || !client.respond_to?(:send_stats)

          # Hold a local reference: close() may null @usage_batcher during send.
          batcher = @usage_batcher
          drained = batcher.export_and_reset
          return if drained.nil?

          payload = drained.payload
          snapshot = drained.snapshot
          @sending_usage = true
        end

        begin
          client.send_stats(payload)
        rescue StandardError => e
          log_error("Failed to send usage stats: #{e.message}")
          begin
            batcher&.restore(snapshot)
          rescue StandardError => restore_error
            log_error("Failed to restore usage batch after send failure: #{restore_error.message}")
          end
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

      private

      def ensure_native_clients
        return if @clients
        return if @usage_client_provided || @metrics_client_provided
        return unless GrpcClients.grpc_available?

        @clients = GrpcClients.create(@metrics_base_url)
        return if @clients

        log_warn("Failed to create Toggly gRPC clients; telemetry send disabled")
      end
    end
  end
end
