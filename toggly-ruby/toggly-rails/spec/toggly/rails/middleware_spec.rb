# frozen_string_literal: true

RSpec.describe Toggly::Rails::Middleware do
  let(:app) { ->(env) { [200, env, ["OK"]] } }
  let(:middleware) { described_class.new(app) }

  describe "#call" do
    it "calls the app" do
      env = {}
      status, _, body = middleware.call(env)

      expect(status).to eq(200)
      expect(body).to eq(["OK"])
    end

    it "cleans up context after request" do
      env = {}
      described_class.set_context(env, Toggly::Context.new(identity: "test"))

      middleware.call(env)

      expect(env[described_class::CONTEXT_KEY]).to be_nil
    end
  end

  describe ".context" do
    it "gets context from env" do
      env = {}
      context = Toggly::Context.new(identity: "user-1")
      described_class.set_context(env, context)

      expect(described_class.context(env)).to eq(context)
    end
  end

  describe ".set_user" do
    it "sets user in env" do
      env = {}
      user = OpenStruct.new(id: 123)
      described_class.set_user(env, user)

      expect(described_class.user(env)).to eq(user)
    end
  end
end
