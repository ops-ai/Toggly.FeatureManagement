# frozen_string_literal: true

require "spec_helper"

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
    described_class.run(handlers("Feat")) { |_scope| :ok }
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
end
