# frozen_string_literal: true

module Toggly
  # Registry for evaluators.
  #
  # Manages the collection of evaluators and dispatches
  # evaluation requests to the appropriate handler.
  class Registry
    def initialize
      @evaluators = {}
      @mutex = Mutex.new
      register_defaults
    end

    # Normalize filter / evaluator names for lookup.
    # Strips non-alphanumeric characters so AlwaysOn and always_on match.
    #
    # @param type [String, Symbol]
    # @return [String]
    def self.normalize_key(type)
      type.to_s.downcase.gsub(/[^a-z0-9]/, "")
    end

    # Register an evaluator (and optional extra aliases).
    #
    # @param evaluator [Evaluators::Base] The evaluator instance
    # @param extra_aliases [Array<String>] Additional names
    # @return [self]
    def register(evaluator, *extra_aliases)
      names = [evaluator.class.type, *Array(evaluator.class.aliases), *extra_aliases]
      @mutex.synchronize do
        names.compact.each do |name|
          @evaluators[self.class.normalize_key(name)] = evaluator
        end
      end
      self
    end

    # Get an evaluator by type
    #
    # @param type [String] The evaluator type
    # @return [Evaluators::Base, nil]
    def get(type)
      @mutex.synchronize do
        @evaluators[self.class.normalize_key(type)]
      end
    end

    # Check if an evaluator exists for a type
    #
    # @param type [String] The evaluator type
    # @return [Boolean]
    def registered?(type)
      @mutex.synchronize do
        @evaluators.key?(self.class.normalize_key(type))
      end
    end

    # List all registered evaluator types
    #
    # @return [Array<String>]
    def types
      @mutex.synchronize do
        @evaluators.keys
      end
    end

    # Unregister an evaluator
    #
    # @param type [String] The evaluator type
    # @return [Evaluators::Base, nil] The removed evaluator
    def unregister(type)
      @mutex.synchronize do
        @evaluators.delete(self.class.normalize_key(type))
      end
    end

    # Clear all evaluators
    #
    # @return [self]
    def clear
      @mutex.synchronize do
        @evaluators.clear
      end
      self
    end

    private

    def register_defaults
      register(Evaluators::AlwaysOn.new)
      register(Evaluators::AlwaysOff.new)
      register(Evaluators::Percentage.new)
      register(Evaluators::Targeting.new)
      register(Evaluators::TimeWindow.new)
      register(Evaluators::ContextualTargeting.new)
      register(Evaluators::ContextProperty.new)
      register(Evaluators::BrowserFamily.new)
      register(Evaluators::BrowserLanguage.new)
      register(Evaluators::Country.new)
      register(Evaluators::DeviceType.new)
      register(Evaluators::OperatingSystem.new)
      register(Evaluators::UserClaims.new)
    end
  end
end
