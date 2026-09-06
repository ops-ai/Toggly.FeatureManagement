# frozen_string_literal: true

require_relative "telemetry/grpc_clients"
require_relative "telemetry/usage_batcher"
require_relative "telemetry/metrics_batcher"
require_relative "telemetry/runtime"

module Toggly
  # Usage and business-metrics telemetry (optional gRPC transport).
  module Telemetry
    DEFAULT_METRICS_BASE_URL = GrpcClients::DEFAULT_METRICS_BASE_URL
    DEFAULT_TELEMETRY_FLUSH_SECONDS = GrpcClients::DEFAULT_TELEMETRY_FLUSH_SECONDS
    GRPC_USER_AGENT_METADATA_KEY = GrpcClients::GRPC_USER_AGENT_METADATA_KEY

    module_function

    def hash_identity(identity)
      GrpcClients.hash_identity(identity)
    end

    def feature_stat_from_payload(payload)
      GrpcClients.feature_stat_from_payload(payload)
    end

    def metric_stat_from_payload(payload)
      GrpcClients.metric_stat_from_payload(payload)
    end

    def grpc_available?
      GrpcClients.grpc_available?
    end

    def resolve_user_agent(override = nil)
      GrpcClients.resolve_user_agent(override)
    end
  end
end
