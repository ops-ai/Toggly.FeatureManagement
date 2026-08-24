# frozen_string_literal: true

OrderFixture = Struct.new(:id, :color, keyword_init: true)

RSpec.describe "Toggly entity context registry" do
  it "maps a domain object through register_context" do
    schema = Toggly::EntityContextSchemaRegistration.new(
      kind: nil,
      key_property: "id",
      display_name: nil,
      properties: [Toggly::EntityContextPropertySchema.new(name: "color", type: "string")]
    )
    Toggly.register_context("Order", schema: schema) do |order|
      Toggly::EntityContext.new(kind: "Order", key: order.id, attributes: { "color" => order.color })
    end

    mapped = Toggly.map_entity("Order", OrderFixture.new(id: "1", color: "red"))
    expect(mapped.kind).to eq("Order")
    expect(mapped.key).to eq("1")
    expect(mapped.attributes["color"]).to eq("red")
    expect(Toggly.entity_schemas.first.key_property).to eq("id")
    expect(Toggly.map_entity("Missing", OrderFixture.new(id: "1", color: "red"))).to be_nil
  end

  it "swallows transport errors on startup catalog PUT" do
    Toggly.register_context(
      "Order",
      schema: Toggly::EntityContextSchemaRegistration.new(kind: "Order", key_property: "id", properties: [])
    )
    config = Toggly::Config.new
    config.app_key = "app"
    config.base_url = "https://example.test/"
    stub_request(:put, "https://example.test/sdk/app/contexts").to_timeout
    expect { Toggly.register_entity_contexts_at_startup(config) }.not_to raise_error
  end
end
