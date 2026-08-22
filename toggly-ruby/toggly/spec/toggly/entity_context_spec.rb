# frozen_string_literal: true

RSpec.describe "Toggly entity context registry" do
  Puppy = Struct.new(:id, :color, keyword_init: true)

  it "maps a domain object through register_context" do
    schema = Toggly::EntityContextSchemaRegistration.new(
      kind: nil,
      key_property: "id",
      display_name: nil,
      properties: [Toggly::EntityContextPropertySchema.new(name: "color", type: "string")]
    )
    Toggly.register_context("Puppy", schema: schema) do |puppy|
      Toggly::EntityContext.new(kind: "Puppy", key: puppy.id, attributes: { "color" => puppy.color })
    end

    mapped = Toggly.map_entity("Puppy", Puppy.new(id: "1", color: "red"))
    expect(mapped.kind).to eq("Puppy")
    expect(mapped.key).to eq("1")
    expect(mapped.attributes["color"]).to eq("red")
    expect(Toggly.entity_schemas.first.key_property).to eq("id")
    expect(Toggly.map_entity("Missing", Puppy.new(id: "1", color: "red"))).to be_nil
  end

  it "swallows transport errors on startup catalog PUT" do
    Toggly.register_context(
      "Puppy",
      schema: Toggly::EntityContextSchemaRegistration.new(kind: "Puppy", key_property: "id", properties: [])
    )
    config = Toggly::Config.new
    config.app_key = "app"
    config.base_url = "https://example.test/"
    stub_request(:put, "https://example.test/sdk/app/contexts").to_timeout
    expect { Toggly.register_entity_contexts_at_startup(config) }.not_to raise_error
  end
end
