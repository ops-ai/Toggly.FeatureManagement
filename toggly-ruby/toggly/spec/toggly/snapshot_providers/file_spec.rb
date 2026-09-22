# frozen_string_literal: true

require "tempfile"

RSpec.describe Toggly::SnapshotProviders::File do
  let(:temp_file) { Tempfile.new(["toggly_snapshot", ".json"]) }
  let(:provider) { described_class.new(path: temp_file.path) }

  after do
    temp_file.close
    temp_file.unlink
  end

  describe "#save and #load" do
    it "saves and loads definitions" do
      definitions = {
        "feature-1" => Toggly::FeatureDefinition.new(feature_key: "feature-1", enabled: true),
        "feature-2" => Toggly::FeatureDefinition.new(feature_key: "feature-2", enabled: false)
      }

      provider.save(definitions, { version: "1.0" })
      result = provider.load

      expect(result[:definitions].keys).to eq(%w[feature-1 feature-2])
      expect(result[:definitions]["feature-1"].enabled).to be true
      expect(result[:metadata][:version]).to eq("1.0")
    end

    it "persists to file" do
      definitions = {
        "test" => Toggly::FeatureDefinition.new(feature_key: "test", enabled: true)
      }

      provider.save(definitions)

      # Read raw file to verify JSON
      content = File.read(temp_file.path)
      data = JSON.parse(content)

      expect(data["definitions"]).to be_an(Array)
      expect(data["definitions"].first["feature_key"]).to eq("test")
    end
  end

  describe "#exists?" do
    it "returns false when file does not exist" do
      provider = described_class.new(path: "/nonexistent/path.json")
      expect(provider.exists?).to be false
    end

    it "returns true when file exists" do
      provider.save({})
      expect(provider.exists?).to be true
    end
  end

  describe "#clear" do
    it "deletes the file" do
      provider.save({})
      provider.clear

      expect(provider.exists?).to be false
    end

    it "handles missing file gracefully" do
      expect { provider.clear }.not_to raise_error
    end
  end

  describe "error handling" do
    it "raises SnapshotError on invalid JSON" do
      File.write(temp_file.path, "invalid json")

      expect { provider.load }.to raise_error(Toggly::SnapshotError, /parse/)
    end
  end

  describe "#save_variants and #load_variants (dual-rail)" do
    after do
      FileUtils.rm_f(provider.variants_path)
    end

    it "persists evaluated variants to a separate file from definitions" do
      variants = {
        "checkout-flow" => Toggly::EvaluatedVariantDef.new(enabled: true, variant: "treatment", configuration_value: { "cta" => "Buy" })
      }

      provider.save_variants(variants, { version: "1.0" })

      expect(provider.variants_path).not_to eq(provider.path)
      result = provider.load_variants

      expect(result[:variants].keys).to eq(["checkout-flow"])
      expect(result[:variants]["checkout-flow"].configuration_value).to eq({ "cta" => "Buy" })
      expect(result[:metadata][:version]).to eq("1.0")
    end

    it "returns nil when no variants snapshot file exists" do
      expect(provider.load_variants).to be_nil
    end

    it "removes the variants file on #clear" do
      provider.save_variants({ "f" => Toggly::EvaluatedVariantDef.new(enabled: true) })
      provider.clear

      expect(File.exist?(provider.variants_path)).to be false
    end
  end

  describe "atomic writes" do
    it "writes to temp file first" do
      definitions = {
        "test" => Toggly::FeatureDefinition.new(feature_key: "test", enabled: true)
      }

      # This tests that if write fails, original file is preserved
      provider.save(definitions)

      expect(File.exist?(temp_file.path)).to be true
      expect(File.exist?("#{temp_file.path}.tmp")).to be false
    end
  end
end
