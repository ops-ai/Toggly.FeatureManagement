# frozen_string_literal: true

RSpec.describe "Toggly smoke tests" do
  let(:app_key) { ENV["TOGGLY_SMOKE_APP_KEY_BACKEND"] }

  before do
    skip "TOGGLY_SMOKE_APP_KEY_BACKEND is not set" if app_key.nil? || app_key.empty?
    WebMock.allow_net_connect!
  end

  after do
    WebMock.disable_net_connect!(allow_localhost: true)
  end

  it "validates unsigned definitions for FlagOn and FlagOff" do
    client = Toggly::Client.new(
      app_key: app_key,
      environment: "Production",
      base_url: "https://definitions.toggly.io/",
      use_signed_definitions: false,
      disable_background_refresh: true
    )

    begin
      expect(client.wait_for_ready(timeout: 30)).to be(true)
      expect(client.enabled?("FlagOn")).to be(true)
      expect(client.enabled?("FlagOff")).to be(false)
    ensure
      client.close
    end
  end

  it "connects via WebSocket and receives definitions" do
    require "websocket-client-simple"
    require "json"

    received = nil
    error = nil
    ws = WebSocket::Client::Simple.connect("wss://definitions.toggly.io/#{app_key}/ws")

    ws.on :message do |msg|
      received = msg.data
      ws.close
    end

    ws.on :error do |e|
      error = e
      ws.close
    end

    10.times do
      break if received || error
      sleep 1
    end

    expect(error).to be_nil
    expect(received).not_to be_nil
    parsed = JSON.parse(received)
    expect(%w[definitions evaluated]).to include(parsed["type"])
    expect(parsed).to have_key("timestamp")
  end

  it "validates signed definitions for FlagOn and FlagOff" do
    client = Toggly::Client.new(
      app_key: app_key,
      environment: "Production",
      base_url: "https://definitions.toggly.io/",
      use_signed_definitions: true,
      disable_background_refresh: true
    )

    begin
      expect(client.wait_for_ready(timeout: 30)).to be(true)
      expect(client.enabled?("FlagOn")).to be(true)
      expect(client.enabled?("FlagOff")).to be(false)
    ensure
      client.close
    end
  end
end
