# frozen_string_literal: true

require "spec_helper"

fiddle_available = begin
  require "fiddle"
  require_relative "../../lib/toggly/telemetry/system_metrics"
  true
rescue LoadError
  false
end

RSpec.describe "Toggly::Telemetry::SystemMetrics::Collector", skip: (fiddle_available ? false : "fiddle gem not available") do
  it "emits injected samples and exception count on tick" do
    observed = []
    collector = Toggly::Telemetry::SystemMetrics::Collector.new(
      observe: ->(metric, value) { observed << [metric, value] },
      sampler: -> { [["CpuUsage", 7.0], ["MemoryWorkingSet", 2048.0]] }
    )
    collector.instance_variable_set(:@exception_count, 3)
    collector.tick
    expect(observed).to include(["CpuUsage", 7.0], ["MemoryWorkingSet", 2048.0], ["ExceptionCount", 3.0])
  end
end

RSpec.describe "Telemetry runtime system_metrics" do
  it "does not start the collector when system_metrics is false" do
    runtime = Toggly::Telemetry::Runtime.new(
      app_key: "app",
      environment: "Production",
      enable_usage_tracking: false,
      enable_metrics: true,
      system_metrics: false,
      metrics_flush_interval: 0,
      usage_flush_interval: 0
    )
    runtime.start
    expect(runtime.instance_variable_get(:@system_metrics_collector)).to be_nil
    runtime.close
  end
end
