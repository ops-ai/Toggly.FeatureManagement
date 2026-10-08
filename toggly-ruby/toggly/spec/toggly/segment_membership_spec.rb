# frozen_string_literal: true

require "spec_helper"

RSpec.describe Toggly::SegmentMembership do
  it "posts identifiers with the Backend application key" do
    stub_request(:post, "https://app.toggly.io/api/v2/segments/Beta%20Testers/items")
      .with(
        headers: { "Authorization" => "backend-key", "Content-Type" => "application/json" },
        body: { identifiers: ["user-1"] }.to_json
      )
      .to_return(status: 200, body: { id: "list-1", itemCount: 1 }.to_json, headers: { "Content-Type" => "application/json" })

    summary = described_class.new(app_key: "backend-key").add_segment_members("Beta Testers", ["user-1"])
    expect(summary).to eq("id" => "list-1", "itemCount" => 1)
  end

  it "returns nil for empty success bodies" do
    stub_request(:delete, "https://app.toggly.io/api/v2/segments/Beta%20Testers/items")
      .to_return(status: 204, body: "")

    expect(described_class.new(app_key: "backend-key").remove_segment_members("Beta Testers", ["user-1"])).to be_nil
  end

  it "requires an app key" do
    expect { described_class.new(app_key: "") }.to raise_error(ArgumentError)
  end
end
