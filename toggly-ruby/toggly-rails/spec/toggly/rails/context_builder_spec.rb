# frozen_string_literal: true

RSpec.describe Toggly::Rails::ContextBuilder do
  let(:config) { Toggly::Rails::Configuration.new }
  let(:builder) { described_class.new(config) }

  describe "#build" do
    context "with user" do
      it "extracts identity from user" do
        user = OpenStruct.new(id: 123)

        context = builder.build(user: user)

        expect(context.identity).to eq("123")
      end

      it "extracts groups when configured" do
        config.groups_method = :roles
        user = OpenStruct.new(id: 123, roles: %w[admin beta])

        context = builder.build(user: user)

        expect(context.groups).to eq(%w[admin beta])
      end
    end

    context "with request" do
      it "extracts request traits" do
        request = double(
          remote_ip: "192.168.1.1",
          user_agent: "Mozilla/5.0"
        )

        context = builder.build(request: request)

        expect(context.trait("request_ip")).to eq("192.168.1.1")
        expect(context.trait("user_agent")).to eq("Mozilla/5.0")
      end
    end

    context "with custom trait extractors" do
      it "calls custom extractors" do
        config.add_trait(:plan) { |_req, user| user&.plan }
        user = OpenStruct.new(id: 1, plan: "enterprise")

        context = builder.build(user: user)

        expect(context.trait("plan")).to eq("enterprise")
      end

      it "handles errors in extractors gracefully" do
        config.add_trait(:failing) { |_req, _user| raise "error" }

        context = builder.build

        expect(context.trait("failing")).to be_nil
      end
    end

    context "without user or request" do
      it "returns empty context" do
        context = builder.build

        expect(context.identity).to be_nil
        expect(context.groups).to eq([])
      end
    end
  end
end
