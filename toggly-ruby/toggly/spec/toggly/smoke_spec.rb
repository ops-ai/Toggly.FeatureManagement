# frozen_string_literal: true

RSpec.describe "Toggly smoke tests" do
  let(:app_key) { ENV.fetch("TOGGLY_SMOKE_APP_KEY_BACKEND", nil) }

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

  it "connects via the SDK's built-in WebSocket and receives definitions" do
    client = Toggly::Client.new(
      app_key: app_key,
      environment: "Production",
      base_url: "https://definitions.toggly.io/",
      use_signed_definitions: false,
      enable_live_updates: true,
      disable_background_refresh: false
    )

    expect(client.wait_for_ready(timeout: 30)).to be(true)
    expect(client.enabled?("FlagOn")).to be(true)
    expect(client.enabled?("FlagOff")).to be(false)

    # Wait for the SDK's built-in WebSocket to connect
    provider = client.instance_variable_get(:@provider)
    connected = false
    30.times do
      if provider.ws_connected
        connected = true
        break
      end
      sleep 0.5
    end

    expect(connected).to be(true), "SDK WebSocket should be connected within 15 seconds"

    # Verify flags still work after WebSocket is connected
    expect(client.enabled?("FlagOn")).to be(true)
    expect(client.enabled?("FlagOff")).to be(false)

    client.close
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
