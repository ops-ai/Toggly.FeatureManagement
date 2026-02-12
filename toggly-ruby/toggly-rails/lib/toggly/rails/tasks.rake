# frozen_string_literal: true

namespace :toggly do
  desc "Refresh feature definitions from Toggly API"
  task refresh: :environment do
    if Toggly.client
      puts "Refreshing Toggly feature definitions..."
      if Toggly.client.refresh(force: true)
        puts "Successfully refreshed #{Toggly.client.feature_keys.count} features"
      else
        puts "No changes detected"
      end
    else
      puts "Toggly is not configured. Run rails generate toggly:install first."
    end
  end

  desc "List all feature flags"
  task list: :environment do
    if Toggly.client
      features = Toggly.client.features
      if features.empty?
        puts "No features found"
      else
        puts "Feature Flags (#{features.count}):"
        puts "-" * 60
        features.sort_by(&:feature_key).each do |feature|
          status = feature.enabled ? "✓ enabled" : "✗ disabled"
          puts "  #{feature.feature_key.ljust(40)} #{status}"
        end
      end
    else
      puts "Toggly is not configured. Run rails generate toggly:install first."
    end
  end

  desc "Check if a specific feature is enabled"
  task :check, [:feature_key] => :environment do |_t, args|
    feature_key = args[:feature_key]
    if feature_key.nil? || feature_key.empty?
      puts "Usage: rake toggly:check[feature_key]"
      exit 1
    end

    if Toggly.client
      if Toggly.enabled?(feature_key)
        puts "Feature '#{feature_key}' is ENABLED"
      else
        puts "Feature '#{feature_key}' is DISABLED"
      end
    else
      puts "Toggly is not configured. Run rails generate toggly:install first."
    end
  end

  desc "Show Toggly configuration"
  task config: :environment do
    if Toggly::Rails.configuration
      config = Toggly::Rails.configuration
      puts "Toggly Configuration:"
      puts "-" * 40
      puts "  App Key:          #{config.app_key ? "#{config.app_key[0..7]}..." : "(not set)"}"
      puts "  Environment:      #{config.environment}"
      puts "  Base URL:         #{config.base_url || Toggly::Config::DEFAULT_BASE_URL}"
      puts "  Refresh Interval: #{config.refresh_interval}s"
      puts "  Request Context:  #{config.request_context_enabled ? "enabled" : "disabled"}"
      puts "  Rails Cache:      #{config.use_rails_cache ? "enabled" : "disabled"}"

      if Toggly.client
        puts "\nClient Status:"
        puts "  Ready:    #{Toggly.client.ready ? "yes" : "no"}"
        puts "  Features: #{Toggly.client.feature_keys.count}"
      end
    else
      puts "Toggly is not configured. Run rails generate toggly:install first."
    end
  end
end
