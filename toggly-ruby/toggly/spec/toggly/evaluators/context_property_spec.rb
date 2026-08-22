# frozen_string_literal: true

RSpec.describe Toggly::Evaluators::ContextProperty do
  let(:engine) { Toggly::EvaluationEngine.new }

  def definition(filters:, requirement: "Any", context_req: nil)
    Toggly::FeatureDefinition.new(
      feature_key: "f",
      enabled: true,
      rules: filters,
      requirement_type: requirement,
      context_requirement_type: context_req
    )
  end

  def ctx_filter(property, op, value, value_type = "string")
    {
      "name" => "ContextProperty",
      "parameters" => {
        "Property" => property,
        "Operator" => op,
        "Value" => value,
        "ValueType" => value_type
      }
    }
  end

  it "ands entity filters with user filters and fails closed without entity" do
    defn = definition(
      filters: [
        ctx_filter("Color", "eq", "red"),
        ctx_filter("Age", "gte", "2", "number"),
        { "type" => "always_on" }
      ],
      requirement: "Any",
      context_req: "All"
    )
    entity = Toggly::EntityContext.new(kind: "Puppy", key: "1", attributes: { "color" => "red", "Age" => 3 })
    expect(engine.evaluate(defn, Toggly::Context.new(entity: entity))).to be true
    expect(engine.evaluate(defn, Toggly::Context.new)).to be false
  end

  it "fails closed on missing attribute and unknown operator" do
    defn = definition(filters: [ctx_filter("Color", "neq", "red")], requirement: "All")
    expect(engine.evaluate(defn, Toggly::Context.new(entity: Toggly::EntityContext.new(kind: "P", key: "1", attributes: {})))).to be false
    unknown = definition(filters: [ctx_filter("Color", "matches", "red")])
    expect(engine.evaluate(unknown, Toggly::Context.new(entity: Toggly::EntityContext.new(kind: "P", key: "1", attributes: { "Color" => "red" })))).to be false
  end

  it "supports in and contains" do
    defn = definition(filters: [ctx_filter("Color", "in", "red, blue")], requirement: "All")
    entity = Toggly::EntityContext.new(kind: "P", key: "1", attributes: { "Color" => "BLUE" })
    expect(engine.evaluate(defn, Toggly::Context.new(entity: entity))).to be true
  end
end
