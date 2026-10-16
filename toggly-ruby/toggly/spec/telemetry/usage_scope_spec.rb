# frozen_string_literal: true

require "spec_helper"

RSpec.describe "Toggly::VERSION" do
  it "exposes the package version string" do
    expect(Toggly::VERSION).to match(/\A\d+\.\d+\.\d+\z/)
  end
end

RSpec.describe Toggly::Telemetry::UsageScopeRunner do
  let(:batcher) { Toggly::Telemetry::UsageBatcher.new("app", "Production") }

  def handlers(feature)
    [
      -> { batcher.record_usage(feature) },
      ->(ms) { batcher.record_usage_duration(feature, ms) },
      lambda { |ms|
        batcher.record_usage_error(feature)
        batcher.record_usage_duration(feature, ms, failed: true)
      }
    ]
  end

  it "records duration on success" do
    result = described_class.run(handlers("Feat")) { |_scope| :ok }
    expect(result).to eq(:ok)
    stat = batcher.build_and_reset[:stats].first
    vs = stat[:variantStats]["enabled"]
    expect(vs[:usedCount]).to eq(1)
    expect(vs[:errorCount]).to eq(0)
    expect(vs[:durationSumMs]).to be >= 0
  end

  it "records error on failure" do
    expect do
      described_class.run(handlers("Fail")) { |_scope| raise "boom" }
    end.to raise_error(RuntimeError)
    vs = batcher.build_and_reset[:stats].first[:variantStats]["enabled"]
    expect(vs[:errorCount]).to eq(1)
  end

  it "records error on explicit fail" do
    described_class.run(handlers("Soft"), &:fail)
    vs = batcher.build_and_reset[:stats].first[:variantStats]["enabled"]
    expect(vs[:errorCount]).to eq(1)
  end

  it "records error for Exception subclasses that bypass StandardError" do
    fatal = Class.new(Exception)
    expect do
      described_class.run(handlers("Fatal")) { |_scope| raise fatal, "fatal" }
    end.to raise_error(fatal)
    vs = batcher.build_and_reset[:stats].first[:variantStats]["enabled"]
    expect(vs[:errorCount]).to eq(1)
    expect(vs[:usedCount]).to eq(1)
  end
end
