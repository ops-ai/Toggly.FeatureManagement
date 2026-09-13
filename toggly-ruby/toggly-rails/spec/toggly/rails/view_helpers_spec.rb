# frozen_string_literal: true

RSpec.describe Toggly::Rails::ViewHelpers do
  let(:view) { ActionView::Base.empty.extend(described_class) }

  describe "#feature" do
    it "captures enabled content with the implicit context" do
      allow(view).to receive(:feature_enabled?).with(:checkout, context: nil).and_return(true)

      result = view.feature(:checkout) { view.content_tag(:strong, "<Express>") }

      expect(result).to eq("<strong>&lt;Express&gt;</strong>")
      expect(result).to be_html_safe
    end

    it "forwards an explicit context" do
      context = Toggly::Context.new(identity: "customer-1")
      allow(view).to receive(:feature_enabled?).with(:checkout, context: context).and_return(true)

      expect(view.feature(:checkout, context: context) { "Express" }).to eq("Express")
    end

    it "does not capture an unselected positive block" do
      captured = false
      allow(view).to receive(:feature_enabled?).with(:checkout, context: nil).and_return(false)

      result = view.feature(:checkout) do
        captured = true
        "Express"
      end

      expect(result).to be_nil
      expect(captured).to be false
    end

    it "captures only the selected negated block" do
      positive_captured = false
      negative_captured = false
      allow(view).to receive(:feature_enabled?).with(:checkout, context: nil).and_return(false)

      positive = view.feature(:checkout) do
        positive_captured = true
        "Express"
      end
      negative = view.feature(:checkout, negate: true) do
        negative_captured = true
        "Standard"
      end

      expect(positive).to be_nil
      expect(negative).to eq("Standard")
      expect(positive_captured).to be false
      expect(negative_captured).to be true
    end

    it "does not capture an unselected negated block" do
      captured = false
      allow(view).to receive(:feature_enabled?).with(:checkout, context: nil).and_return(true)

      result = view.feature(:checkout, negate: true) do
        captured = true
        "Standard"
      end

      expect(result).to be_nil
      expect(captured).to be false
    end

    it "returns nil when a selected branch has no block" do
      allow(view).to receive(:feature_enabled?).with(:checkout, context: nil).and_return(true)

      expect(view.feature(:checkout)).to be_nil
    end
  end

  describe "deprecated block helpers" do
    it "adapts when_feature_enabled to the canonical positive helper" do
      context = Toggly::Context.new(identity: "customer-1")
      allow(view).to receive(:feature).and_yield

      result = view.when_feature_enabled(:checkout, context: context) do
        view.content_tag(:strong, "Express")
      end

      expect(result).to eq("<strong>Express</strong>")
      expect(result).to be_html_safe
      expect(view).to have_received(:feature).with(:checkout, context: context, negate: false)
    end

    it "adapts when_feature_disabled to the canonical negated helper" do
      context = Toggly::Context.new(identity: "customer-1")
      allow(view).to receive(:feature).and_yield

      result = view.when_feature_disabled(:checkout, context: context) do
        view.content_tag(:em, "Standard")
      end

      expect(result).to eq("<em>Standard</em>")
      expect(result).to be_html_safe
      expect(view).to have_received(:feature).with(:checkout, context: context, negate: true)
    end
  end
end
