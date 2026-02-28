# frozen_string_literal: true

require "simplecov"
require "simplecov_json_formatter"
SimpleCov.start do
  formatter SimpleCov::Formatter::MultiFormatter.new([
    SimpleCov::Formatter::HTMLFormatter,
    SimpleCov::Formatter::JSONFormatter
  ])
  add_filter "/spec/"
  enable_coverage :branch
  minimum_coverage line: 70, branch: 35
end

ENV["RAILS_ENV"] = "test"

require "ostruct"
require "rails"
require "action_controller/railtie"
require "action_view/railtie"
require "toggly-rails"
require "webmock/rspec"

# Create a minimal Rails application for testing
class TestApp < Rails::Application
  config.eager_load = false
  config.secret_key_base = "test_secret_key_base_for_toggly_rails_testing"
  config.hosts << "www.example.com"
  routes.draw do
    get "/test" => "test#index"
  end
end

class TestController < ActionController::Base
  include Toggly::Rails::ControllerConcern

  def index
    if feature_enabled?(:test_feature)
      render plain: "Feature Enabled"
    else
      render plain: "Feature Disabled"
    end
  end

  def current_user
    @current_user ||= OpenStruct.new(id: 123, name: "Test User")
  end
end

TestApp.initialize!

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
    Toggly::Rails.reset!
    WebMock.disable_net_connect!(allow_localhost: true)
  end

  config.after(:each) do
    Toggly::Rails.reset!
  end
end

# Test helpers
module TestHelpers
  def build_definitions_response(features)
    { "features" => features }.to_json
  end

  def stub_definitions_api(app_key:, environment:, features:, status: 200)
    url = "https://app.toggly.io/definitions/#{app_key}/#{environment}"

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
