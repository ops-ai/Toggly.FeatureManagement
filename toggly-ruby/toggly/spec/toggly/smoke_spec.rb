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
