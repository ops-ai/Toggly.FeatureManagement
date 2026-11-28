# frozen_string_literal: true

RSpec.describe "Typed flag value getters (OPS-2102)" do
  let(:app_key) { "test-app-key" }
  let(:environment) { "Production" }

  def build_client(features)
    stub_definitions_api(app_key: app_key, environment: environment, features: features)
    Toggly::Client.new(
      app_key: app_key,
      environment: environment,
      disable_background_refresh: true,
      enable_live_updates: false
    )
  end

  describe "Client#get_string_value" do
    it "decodes when the declared valueType matches" do
      client = build_client(
        [{ "featureKey" => "greeting", "filters" => [{ "name" => "AlwaysOn" }],
           "valueType" => "string", "value" => "hello" }]
      )
      expect(client.get_string_value("greeting")).to eq("hello")
      client.close
    end

    it "soft-nulls on a declared mismatch" do
      client = build_client(
        [{ "featureKey" => "limit", "filters" => [{ "name" => "AlwaysOn" }],
           "valueType" => "number", "value" => 42 }]
      )
      expect(client.get_string_value("limit")).to be_nil
      client.close
    end
  end

  describe "Client#get_number_value" do
    it "decodes numeric values when the declared type matches" do
      client = build_client(
        [{ "featureKey" => "limit", "filters" => [{ "name" => "AlwaysOn" }],
           "valueType" => "number", "value" => 42 }]
      )
      expect(client.get_number_value("limit")).to eq(42.0)
      client.close
    end
  end

  describe "Client#get_json_value" do
    it "decodes object values when the declared type matches" do
      client = build_client(
        [{ "featureKey" => "config", "filters" => [{ "name" => "AlwaysOn" }],
           "valueType" => "json", "value" => { "nested" => { "flag" => true } } }]
      )
      expect(client.get_json_value("config")).to eq({ "nested" => { "flag" => true } })
      client.close
    end
  end

  describe "Client#get_datetime_value" do
    it "parses ISO-8601 into a Time" do
      client = build_client(
        [{ "featureKey" => "launch-at", "filters" => [{ "name" => "AlwaysOn" }],
           "valueType" => "datetime", "value" => "2026-06-01T00:00:00Z" }]
      )
      decoded = client.get_datetime_value("launch-at")
      expect(decoded).not_to be_nil
      expect(decoded.year).to eq(2026)
      expect(decoded.month).to eq(6)
      client.close
    end

    it "soft-nulls on an unparsable value" do
      client = build_client(
        [{ "featureKey" => "launch-at", "filters" => [{ "name" => "AlwaysOn" }],
           "valueType" => "datetime", "value" => "not-a-date" }]
      )
      expect(client.get_datetime_value("launch-at")).to be_nil
      client.close
    end
  end

  it "soft-nulls every typed getter on a disabled flag" do
    client = build_client(
      [{ "featureKey" => "greeting", "filters" => [{ "name" => "AlwaysOff" }],
         "valueType" => "string", "value" => "hello" }]
    )
    expect(client.get_string_value("greeting")).to be_nil
    client.close
  end

  it "soft-nulls every typed getter on an unknown feature" do
    client = build_client([])
    expect(client.get_string_value("unknown")).to be_nil
    expect(client.get_number_value("unknown")).to be_nil
    expect(client.get_json_value("unknown")).to be_nil
    expect(client.get_datetime_value("unknown")).to be_nil
    client.close
  end

  it "still decodes legacy catalogs that predate valueType" do
    client = build_client(
      [{ "featureKey" => "greeting", "filters" => [{ "name" => "AlwaysOn" }], "value" => "hello" }]
    )
    expect(client.get_string_value("greeting")).to eq("hello")
    client.close
  end

  describe "Toggly module (global client)" do
    before do
      stub_definitions_api(
        app_key: app_key,
        environment: environment,
        features: [{ "featureKey" => "greeting", "filters" => [{ "name" => "AlwaysOn" }],
                     "valueType" => "string", "value" => "hello" }]
      )
      Toggly.configure do |config|
        config.app_key = app_key
        config.environment = environment
        config.disable_background_refresh = true
      end
    end

    it "delegates typed getters to the configured client" do
      expect(Toggly.get_string_value("greeting")).to eq("hello")
      expect(Toggly.get_number_value("greeting")).to be_nil
    end

    it "raises the standard not-configured error when unset" do
      Toggly.reset!
      message = "Toggly not configured. Call Toggly.configure first."
      expect { Toggly.get_string_value("greeting") }.to raise_error(Toggly::Error, message)
    end
  end
end
