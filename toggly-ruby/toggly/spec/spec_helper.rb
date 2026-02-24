# frozen_string_literal: true

require "simplecov"
SimpleCov.start do
  add_filter "/spec/"
  enable_coverage :branch
  minimum_coverage line: 80, branch: 45 unless ENV["DISABLE_SIMPLECOV"]
end

require "toggly"
require "webmock/rspec"

RSpec.configure do |config|
  config.expect_with :rspec do |expectations|
    expectations.include_chain_clauses_in_custom_matcher_descriptions = true
  end

  config.mock_with :rspec do |mocks|
    mocks.verify_partial_doubles = true
  end

  config.shared_context_metadata_behavior = :apply_to_host_groups
  config.filter_run_when_matching :focus
  config.example_status_persistence_file_path = "spec/examples.txt"
  config.disable_monkey_patching!
  config.warnings = true
  config.order = :random
  Kernel.srand config.seed

  config.before(:each) do
    Toggly.reset!
    WebMock.disable_net_connect!(allow_localhost: true)
  end

  config.after(:each) do
    Toggly.reset!
  end
end

# Test helpers
module TestHelpers
  def build_definitions_response(features)
    { "features" => features }.to_json
  end

  def stub_definitions_api(app_key:, environment:, features:, status: 200)
    url = "https://definitions.toggly.io/definitions/#{app_key}/#{environment}"

    if status == 200
      stub_request(:get, url)
        .to_return(
          status: 200,
          body: build_definitions_response(features),
          headers: { "Content-Type" => "application/json" }
        )
    else
      stub_request(:get, url)
        .to_return(status: status, body: "")
    end
  end
end

RSpec.configure do |config|
  config.include TestHelpers
end
