# frozen_string_literal: true

require "fileutils"
require "open3"
require "rbconfig"
require "tmpdir"

SDK_ROOT = File.expand_path("..", __dir__)
RAILS_VERSION = ENV.fetch("RAILS_VERSION")
REDIS_VERSION = ENV.fetch("REDIS_VERSION")
REDIS_URL = ENV.fetch("REDIS_URL", "redis://127.0.0.1:6379")

def run!(*command, chdir:, env: {})
  output, status = Open3.capture2e(env, *command, chdir:)
  return output if status.success?

  raise "#{command.join(" ")} failed in #{chdir}:\n#{output}"
end

def build_gem(package, gemspec, expected_file, destination)
  package_directory = File.join(SDK_ROOT, package)
  gem_path = File.join(destination, "#{package}.gem")
  run!("gem", "build", gemspec, "--output", gem_path, chdir: package_directory)

  files = run!("gem", "specification", gem_path, "files", chdir: package_directory)
  raise "#{package} package omitted #{expected_file}" unless files.include?(expected_file)

  gem_path
end

def ruby_host!(gem_environment, script)
  run!(RbConfig.ruby, "-e", script, chdir: SDK_ROOT, env: gem_environment)
end

Dir.mktmpdir("toggly-ruby-packed-hosts-") do |temporary_directory|
  artifacts = File.join(temporary_directory, "artifacts")
  gem_home = File.join(temporary_directory, "gems")
  FileUtils.mkdir_p(artifacts)
  FileUtils.mkdir_p(gem_home)

  core_gem = build_gem("toggly", "toggly.gemspec", "lib/toggly.rb", artifacts)
  rails_gem = build_gem("toggly-rails", "toggly-rails.gemspec", "lib/toggly-rails.rb", artifacts)
  cache_gem = build_gem("toggly-cache", "toggly-cache.gemspec", "lib/toggly-cache.rb", artifacts)

  gem_environment = {
    "GEM_HOME" => gem_home,
    "GEM_PATH" => gem_home,
    "PACKED_HOST_RAILS_VERSION" => RAILS_VERSION,
    "PACKED_HOST_REDIS_VERSION" => REDIS_VERSION,
    "PACKED_HOST_REDIS_URL" => REDIS_URL
  }
  install_directory = ["--install-dir", gem_home, "--no-document"]

  run!("gem", "install", *install_directory, core_gem, chdir: SDK_ROOT, env: gem_environment)
  run!("gem", "install", *install_directory, "rails", "-v", RAILS_VERSION, chdir: SDK_ROOT, env: gem_environment)
  run!("gem", "install", *install_directory, "redis", "-v", REDIS_VERSION, chdir: SDK_ROOT, env: gem_environment)
  run!("gem", "install", *install_directory, rails_gem, chdir: SDK_ROOT, env: gem_environment)
  run!("gem", "install", *install_directory, cache_gem, chdir: SDK_ROOT, env: gem_environment)

  host_output = ruby_host!(gem_environment, <<~'RUBY')
    require "rails"
    require "redis"
    require "toggly-rails"
    require "toggly-cache"

    expected_rails_version = ENV.fetch("PACKED_HOST_RAILS_VERSION")
    expected_redis_version = ENV.fetch("PACKED_HOST_REDIS_VERSION")
    redis_url = ENV.fetch("PACKED_HOST_REDIS_URL")
    raise "wrong Rails version: #{Rails.version}" unless Rails.version == expected_rails_version
    raise "wrong Redis version: #{Redis::VERSION}" unless Redis::VERSION == expected_redis_version

    Toggly::Rails.configure do |config|
      config.defaults = { "packed-host" => true }
      config.disable_background_refresh = true
    end
    raise "Rails gate did not evaluate from defaults" unless Toggly::Rails.client.enabled?("packed-host")
    Toggly::Rails.reset!

    redis = Redis.new(url: redis_url)
    provider = Toggly::Cache::RedisSnapshotProvider.new(
      redis: redis,
      key_prefix: "toggly-packed-host-#{Process.pid}",
      ttl: 60
    )
    definitions = {
      "packed-host" => Toggly::FeatureDefinition.new(feature_key: "packed-host", enabled: true)
    }
    provider.save(definitions, { "revision" => "packed-host" })
    restored = provider.load
    raise "Redis snapshot did not restore definitions" unless restored[:definitions]["packed-host"].enabled
    raise "Redis snapshot did not restore metadata" unless restored[:metadata][:revision] == "packed-host"
    raise "Redis snapshot TTL did not extend" unless provider.touch
    provider.clear
    raise "Redis snapshot did not clear" if provider.exists?
    redis.close

    puts "PACKED_RUBY_HOST_PASS ruby=#{RUBY_VERSION} rails=#{Rails.version} redis=#{Redis::VERSION}"
  RUBY
  raise "packed host did not report success" unless host_output.include?("PACKED_RUBY_HOST_PASS")

  puts host_output
end
