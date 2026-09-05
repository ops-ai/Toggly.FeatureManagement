# frozen_string_literal: true

require "json"
require "pathname"

REQUIRED_FILTER_PARITY_IDS = %w[
  browser-family-match
  browser-family-miss
  browser-language-match
  country-from-request
  country-from-cf-ipcountry
  device-type-match
  os-match
  user-claims-match
  user-claims-miss
  targeting-groups-match
  percentage-missing-fail-closed
  percentage-zero-fail-closed
  unknown-filter-fail-closed
].freeze

RSpec.describe "filter parity fixtures" do
  def self.resolve_fixtures_dir
    cwd = Pathname.pwd.expand_path
    candidates = [
      cwd / "docs" / "filter-parity" / "fixtures",
      cwd / ".." / "docs" / "filter-parity" / "fixtures",
      cwd / ".." / ".." / "docs" / "filter-parity" / "fixtures",
      cwd / ".." / ".." / ".." / "docs" / "filter-parity" / "fixtures"
    ]
    candidates.each do |candidate|
      return candidate.expand_path if candidate.directory?
    end

    walk = cwd
    6.times do
      candidate = walk / "docs" / "filter-parity" / "fixtures"
      return candidate.expand_path if candidate.directory?
      break if walk.parent == walk

      walk = walk.parent
    end
    nil
  end

  def self.load_fixtures
    directory = resolve_fixtures_dir
    raise "docs/filter-parity/fixtures not found" if directory.nil?

    directory.glob("*.json").sort.map do |path|
      data = JSON.parse(path.read)
      [data.fetch("id"), data]
    end
  end

  def to_definition(root)
    filters = Array(root["filters"]).map do |filter|
      {
        "name" => filter["name"],
        "parameters" => filter["parameters"] || {}
      }
    end

    Toggly::FeatureDefinition.new(
      feature_key: root.fetch("featureKey"),
      enabled: true,
      rules: filters,
      requirement_type: root["requirementType"] || "Any"
    )
  end

  def to_context(root)
    base = Toggly::Context.from_hash(root["context"] || {})
    headers = root["httpHeaders"]
    return Toggly::HttpRequestMapper.merge_into(headers, base) if headers.is_a?(Hash) && !headers.empty?

    base
  end

  it "loads required wave1 cases" do
    ids = self.class.load_fixtures.map(&:first)
    REQUIRED_FILTER_PARITY_IDS.each do |required|
      expect(ids).to include(required), "missing fixture #{required}"
    end
  end

  load_fixtures.each do |fixture_id, root|
    it "matches golden fixture #{fixture_id}" do
      engine = Toggly::EvaluationEngine.new
      definition = to_definition(root)
      context = to_context(root)
      expected = root.fetch("expected") ? true : false
      actual = engine.evaluate(definition, context)
      expect(actual).to eq(expected), "fixture #{fixture_id} failed"
    end
  end
end
