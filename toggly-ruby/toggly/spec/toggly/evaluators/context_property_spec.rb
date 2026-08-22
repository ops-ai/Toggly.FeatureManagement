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

  it "fails closed when numeric values cannot be parsed" do
    defn = definition(filters: [ctx_filter("Age", "gte", "0", "number")], requirement: "All")
    entity = Toggly::EntityContext.new(kind: "P", key: "1", attributes: { "Age" => "not-a-number" })
    expect(engine.evaluate(defn, Toggly::Context.new(entity: entity))).to be false

    expected_bad = definition(filters: [ctx_filter("Age", "gt", "abc", "number")], requirement: "All")
    numeric = Toggly::EntityContext.new(kind: "P", key: "1", attributes: { "Age" => 5 })
    expect(engine.evaluate(expected_bad, Toggly::Context.new(entity: numeric))).to be false
  end

  it "compares valid numbers and datetimes" do
    gt = definition(filters: [ctx_filter("Age", "gt", "2", "number")], requirement: "All")
    gte = definition(filters: [ctx_filter("Age", "gte", "3", "number")], requirement: "All")
    lt = definition(filters: [ctx_filter("Age", "lt", "10", "number")], requirement: "All")
    lte = definition(filters: [ctx_filter("Age", "lte", "3", "number")], requirement: "All")
    entity = Toggly::EntityContext.new(kind: "P", key: "1", attributes: { "Age" => 3 })
    ctx = Toggly::Context.new(entity: entity)
    expect(engine.evaluate(gt, ctx)).to be true
    expect(engine.evaluate(gte, ctx)).to be true
    expect(engine.evaluate(lt, ctx)).to be true
    expect(engine.evaluate(lte, ctx)).to be true

    dt = definition(filters: [ctx_filter("Born", "lt", "2020-01-02T00:00:00Z", "datetime")], requirement: "All")
    born = Toggly::EntityContext.new(kind: "P", key: "1", attributes: { "Born" => "2020-01-01T00:00:00Z" })
    expect(engine.evaluate(dt, Toggly::Context.new(entity: born))).to be true
    bad_dt = definition(filters: [ctx_filter("Born", "lt", "not-a-date", "datetime")], requirement: "All")
    expect(engine.evaluate(bad_dt, Toggly::Context.new(entity: born))).to be false
  end

  it "supports eq, neq, string contains, and string[] contains" do
    eq = definition(filters: [ctx_filter("Color", "eq", "RED")], requirement: "All")
    neq = definition(filters: [ctx_filter("Color", "neq", "blue")], requirement: "All")
    contains = definition(filters: [ctx_filter("Color", "contains", "ed")], requirement: "All")
    arr = definition(filters: [ctx_filter("Tags", "contains", "beta", "string[]")], requirement: "All")
    entity = Toggly::EntityContext.new(kind: "P", key: "1", attributes: { "Color" => "red", "Tags" => %w[alpha beta] })
    ctx = Toggly::Context.new(entity: entity)
    expect(engine.evaluate(eq, ctx)).to be true
    expect(engine.evaluate(neq, ctx)).to be true
    expect(engine.evaluate(contains, ctx)).to be true
    expect(engine.evaluate(arr, ctx)).to be true
  end

  it "fails closed on empty property, missing context, and non-ordered value types" do
    expect(described_class.evaluate_single({ "parameters" => { "Property" => " ", "Operator" => "eq", "Value" => "x" } },
                                           Toggly::EntityContext.new(kind: "P", key: "1", attributes: { "x" => 1 }))).to be false
    expect(described_class.new.evaluate(ctx_filter("Color", "eq", "red"), Toggly::Context.new)).to be false
    expect(described_class.context_property?({ "type" => "ContextProperty" })).to be true
    expect(described_class.context_property?({ "name" => "always_on" })).to be false
    ordered = definition(filters: [ctx_filter("Color", "gt", "red", "string")], requirement: "All")
    entity = Toggly::EntityContext.new(kind: "P", key: "1", attributes: { "Color" => "red" })
    expect(engine.evaluate(ordered, Toggly::Context.new(entity: entity))).to be false
  end
end
