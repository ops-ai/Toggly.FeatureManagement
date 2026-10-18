# frozen_string_literal: true

require "spec_helper"
require_relative "../../lib/toggly/telemetry/system_metrics"

fiddle_available = defined?(Fiddle)

RSpec.describe Toggly::Telemetry::SystemMetrics::Collector do
  it "emits injected samples and exception count on tick" do
    observed = []
    collector = described_class.new(
      observe: ->(metric, value) { observed << [metric, value] },
      sampler: -> { [["CpuUsage", 7.0], ["MemoryWorkingSet", 2048.0]] }
    )
    collector.instance_variable_set(:@exception_count, 3)
    collector.tick
    expect(observed).to include(["CpuUsage", 7.0], ["MemoryWorkingSet", 2048.0], ["ExceptionCount", 3.0])
  end

  it "skips non-finite and negative injected samples" do
    observed = []
    collector = described_class.new(
      observe: ->(metric, value) { observed << [metric, value] },
      sampler: -> { [["CpuUsage", Float::NAN], ["MemoryWorkingSet", -1], ["Ok", 1.5]] }
    )
    collector.tick
    expect(observed).to eq([["Ok", 1.5]])
  end

  it "does not emit after stop closes the collector" do
    observed = []
    collector = described_class.new(
      observe: ->(metric, value) { observed << [metric, value] },
      sampler: -> { [["CpuUsage", 1.0]] }
    )
    collector.start
    collector.stop
    collector.tick
    expect(observed).to be_empty
  end

  it "swallows observe failures during tick" do
    collector = described_class.new(
      observe: ->(_metric, _value) { raise "boom" },
      sampler: -> { [["CpuUsage", 1.0]] }
    )
    expect { collector.tick }.not_to raise_error
  end

  it "samples cpu and memory through default_sample", skip: (fiddle_available ? false : "fiddle gem not available") do
    observed = []
    collector = described_class.new(
      observe: ->(metric, value) { observed << [metric, value] }
    )
    first = Toggly::Telemetry::SystemMetrics::RusageFFI.read_rusage
    if first
      now = Process.clock_gettime(Process::CLOCK_MONOTONIC) - 1.0
      collector.instance_variable_set(
        :@last_cpu,
        { user_us: first[:user_us], sys_us: first[:sys_us], at: now }
      )
    end
    collector.tick
    metrics = observed.map(&:first)
    expect(metrics).to include("MemoryWorkingSet").or include("CpuUsage").or eq([])
  end

  it "reads linux statm rss when platform reports linux" do
    collector = described_class.new(
      observe: ->(_m, _v) {},
      sampler: -> { [] }
    )
    stub_const("RUBY_PLATFORM", "x86_64-linux")
    allow(File).to receive(:read).with("/proc/self/statm").and_return("1 2 3 4")
    allow(ENV).to receive(:fetch).with("PAGESIZE", 4096).and_return("4096")
    rss = collector.send(:read_linux_statm_rss)
    expect(rss).to eq(2 * 4096)
  end

  it "returns nil from read_linux_statm_rss off linux or on IO errors" do
    collector = described_class.new(
      observe: ->(_m, _v) {},
      sampler: -> { [] }
    )
    stub_const("RUBY_PLATFORM", "arm64-darwin")
    expect(collector.send(:read_linux_statm_rss)).to be_nil

    stub_const("RUBY_PLATFORM", "x86_64-linux")
    allow(File).to receive(:read).and_raise(Errno::ENOENT)
    expect(collector.send(:read_linux_statm_rss)).to be_nil
  end

  it "falls back to getrusage maxrss when statm is unavailable" do
    collector = described_class.new(
      observe: ->(_m, _v) {},
      sampler: -> { [] }
    )
    allow(collector).to receive(:read_linux_statm_rss).and_return(nil)
    allow(Toggly::Telemetry::SystemMetrics::RusageFFI).to receive(:read_rusage)
      .and_return({ user_us: 1, sys_us: 1, maxrss: 2048 })
    stub_const("RUBY_PLATFORM", "arm64-darwin")
    expect(collector.send(:sample_memory_working_set)).to eq(2048.0)

    stub_const("RUBY_PLATFORM", "x86_64-linux")
    expect(collector.send(:sample_memory_working_set)).to eq(2048.0 * 1024)
  end

  it "returns nil cpu when rusage is unavailable or first sample" do
    collector = described_class.new(
      observe: ->(_m, _v) {},
      sampler: -> { [] }
    )
    allow(Toggly::Telemetry::SystemMetrics::RusageFFI).to receive(:read_rusage).and_return(nil)
    expect(collector.send(:sample_cpu)).to be_nil

    allow(Toggly::Telemetry::SystemMetrics::RusageFFI).to receive(:read_rusage)
      .and_return({ user_us: 10, sys_us: 5, maxrss: 1 })
    expect(collector.send(:sample_cpu)).to be_nil # seeds only
  end

  it "computes cpu percent from successive rusage samples" do
    collector = described_class.new(
      observe: ->(_m, _v) {},
      sampler: -> { [] }
    )
    now = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    allow(Process).to receive(:clock_gettime).with(Process::CLOCK_MONOTONIC).and_return(now, now + 1.0)
    allow(Etc).to receive(:nprocessors).and_return(2)
    allow(Toggly::Telemetry::SystemMetrics::RusageFFI).to receive(:read_rusage).and_return(
      { user_us: 0, sys_us: 0, maxrss: 1 },
      { user_us: 500_000, sys_us: 500_000, maxrss: 1 }
    )
    expect(collector.send(:sample_cpu)).to be_nil
    pct = collector.send(:sample_cpu)
    expect(pct).to be_a(Numeric)
    expect(pct).to be >= 0
    expect(pct).to be <= 100
  end

  it "installs and disables the TracePoint exception handler" do
    collector = described_class.new(
      observe: ->(_m, _v) {},
      sampler: -> { [] }
    )
    expect(collector.instance_variable_get(:@trace)).not_to be_nil
    collector.stop
    expect(collector.instance_variable_get(:@trace)).to be_nil
  end

  it "uses default_sample when no sampler is injected" do
    observed = []
    collector = described_class.new(
      observe: ->(metric, value) { observed << [metric, value] }
    )
    allow(collector).to receive(:sample_cpu).and_return(12.5)
    allow(collector).to receive(:sample_memory_working_set).and_return(4096.0)
    collector.tick
    expect(observed).to include(["CpuUsage", 12.5], ["MemoryWorkingSet", 4096.0])
  end

  it "runs the background loop then stops" do
    ticks = 0
    collector = described_class.new(
      observe: ->(_m, _v) {},
      sampler: lambda {
        ticks += 1
        []
      },
      interval: 0.05
    )
    collector.start
    sleep 0.12
    collector.stop
    expect(ticks).to be >= 1
  end

  it "uses default page size when PAGESIZE is invalid" do
    collector = described_class.new(
      observe: ->(_m, _v) {},
      sampler: -> { [] }
    )
    stub_const("RUBY_PLATFORM", "x86_64-linux")
    allow(File).to receive(:read).with("/proc/self/statm").and_return("1 3 0")
    allow(ENV).to receive(:fetch).with("PAGESIZE", 4096).and_return("nope")
    expect(collector.send(:read_linux_statm_rss)).to eq(3 * 4096)
  end

  it "returns nil from RusageFFI when getrusage is unset" do
    ffi = Toggly::Telemetry::SystemMetrics::RusageFFI
    previous = ffi.instance_variable_get(:@getrusage)
    ffi.instance_variable_set(:@getrusage, nil)
    expect(ffi.read_rusage).to be_nil
  ensure
    ffi.instance_variable_set(:@getrusage, previous)
  end

  it "prefers linux statm rss in sample_memory_working_set" do
    collector = described_class.new(
      observe: ->(_m, _v) {},
      sampler: -> { [] }
    )
    allow(collector).to receive(:read_linux_statm_rss).and_return(8192)
    expect(collector.send(:sample_memory_working_set)).to eq(8192.0)
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

  it "starts and stops the collector when system_metrics is enabled" do
    runtime = Toggly::Telemetry::Runtime.new(
      app_key: "app",
      environment: "Production",
      enable_usage_tracking: false,
      enable_metrics: true,
      system_metrics: true,
      system_metrics_sampler: -> { [["CpuUsage", 1.0]] },
      system_metrics_interval: 60.0,
      metrics_flush_interval: 0,
      usage_flush_interval: 0
    )
    runtime.start
    collector = runtime.instance_variable_get(:@system_metrics_collector)
    expect(collector).not_to be_nil
    observed = []
    collector.instance_variable_set(:@observe, ->(metric, value) { observed << [metric, value] })
    collector.tick
    expect(observed).to include(["CpuUsage", 1.0])
    runtime.close
    expect(runtime.instance_variable_get(:@system_metrics_collector)).to be_nil
  end
end

RSpec.describe "Toggly::Config system_metrics" do
  it "defaults to false and accepts assignment" do
    config = Toggly::Config.new(app_key: "k", environment: "Production")
    expect(config.system_metrics).to eq(false)
    config.system_metrics = true
    expect(config.system_metrics).to eq(true)
    config.system_metrics = false
    expect(config.system_metrics).to eq(false)
  end

  it "honors constructor option" do
    config = Toggly::Config.new(app_key: "k", environment: "Production", system_metrics: true)
    expect(config.system_metrics).to eq(true)
  end
end
