# frozen_string_literal: true

require "fileutils"
require "open3"
require "rbconfig"
require "rubygems/package"
require "tmpdir"

SDK_ROOT = File.expand_path("..", __dir__)
RAILS_VERSION = ENV.fetch("RAILS_VERSION")
REDIS_VERSION = ENV.fetch("REDIS_VERSION")
REDIS_URL = ENV.fetch("REDIS_URL", "redis://127.0.0.1:6379")
INDEX_GENERATOR_VERSION = "1.2.0"

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

  specification = Gem::Package.new(gem_path).spec
  indexed_gem_path = File.join(destination, "#{specification.name}-#{specification.version}.gem")
  FileUtils.mv(gem_path, indexed_gem_path)

  { name: specification.name, version: specification.version.to_s }
end

def generate_repository_index!(repository, tool_gem_home)
  tool_environment = { "GEM_HOME" => tool_gem_home, "GEM_PATH" => tool_gem_home }
  install_directory = ["--install-dir", tool_gem_home, "--no-document"]

  run!(
    "gem", "install", *install_directory, "rubygems-generate_index", "-v", INDEX_GENERATOR_VERSION,
    chdir: SDK_ROOT,
    env: tool_environment
  )
  run!("gem", "generate_index", "--directory", repository, chdir: SDK_ROOT, env: tool_environment)
end

def write_host_gemfile(host_directory, repository, packed_gems)
  # A repository of the built archives makes Bundler resolve the candidate gems,
  # Rails and Redis together without using a source-tree path dependency.
  gemfile = <<~RUBY
    source "https://rubygems.org"

    source "file://#{repository}" do
  RUBY

  packed_gems.each do |gem|
    gemfile << "  gem #{gem[:name].inspect}, #{gem[:version].inspect}\n"
  end

  gemfile << <<~RUBY
    end

    gem "rails", #{RAILS_VERSION.inspect}
    gem "redis", #{REDIS_VERSION.inspect}
  RUBY
  File.write(File.join(host_directory, "Gemfile"), gemfile)
end

def verify_packed_repository!(host_directory, repository, packed_gems)
  lockfile = File.read(File.join(host_directory, "Gemfile.lock"))
  expected_source = "remote: file://#{repository}/"
  raise "packed gems did not resolve from the artifact repository" unless lockfile.include?(expected_source)

  packed_gems.each do |gem|
    specification = "    #{gem[:name]} (#{gem[:version]})"
    raise "packed artifact #{gem[:name]} was not locked" unless lockfile.include?(specification)
  end
end

def ruby_host!(host_directory, bundle_environment, script)
  run!("bundle", "exec", RbConfig.ruby, "-e", script, chdir: host_directory, env: bundle_environment)
end

Dir.mktmpdir("toggly-ruby-packed-hosts-") do |temporary_directory|
  repository = File.join(temporary_directory, "repository")
  artifacts = File.join(repository, "gems")
  host_directory = File.join(temporary_directory, "host")
  tool_gem_home = File.join(temporary_directory, "index-generator")
  FileUtils.mkdir_p(artifacts)
  FileUtils.mkdir_p(host_directory)

  core_gem = build_gem("toggly", "toggly.gemspec", "lib/toggly.rb", artifacts)
  rails_gem = build_gem("toggly-rails", "toggly-rails.gemspec", "lib/toggly-rails.rb", artifacts)
  cache_gem = build_gem("toggly-cache", "toggly-cache.gemspec", "lib/toggly-cache.rb", artifacts)
  generate_repository_index!(repository, tool_gem_home)
  write_host_gemfile(host_directory, repository, [core_gem, rails_gem, cache_gem])

  bundle_environment = {
    "BUNDLE_APP_CONFIG" => File.join(host_directory, ".bundle"),
    "BUNDLE_DISABLE_SHARED_GEMS" => "true",
    "BUNDLE_GEMFILE" => File.join(host_directory, "Gemfile"),
    "BUNDLE_PATH" => File.join(host_directory, "bundle"),
    "PACKED_HOST_RAILS_VERSION" => RAILS_VERSION,
    "PACKED_HOST_REDIS_VERSION" => REDIS_VERSION,
    "PACKED_HOST_REDIS_URL" => REDIS_URL
  }

  run!("bundle", "install", "--jobs", "4", chdir: host_directory, env: bundle_environment)
  verify_packed_repository!(host_directory, repository, [core_gem, rails_gem, cache_gem])

  host_output = ruby_host!(host_directory, bundle_environment, <<~'RUBY')
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
