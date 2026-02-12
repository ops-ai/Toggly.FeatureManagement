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

    # Register an evaluator
    #
    # @param evaluator [Evaluators::Base] The evaluator instance
    # @return [self]
    def register(evaluator)
      @mutex.synchronize do
        @evaluators[evaluator.class.type.to_s.downcase] = evaluator
      end
      self
    end

    # Get an evaluator by type
    #
    # @param type [String] The evaluator type
    # @return [Evaluators::Base, nil]
    def get(type)
      @mutex.synchronize do
        @evaluators[type.to_s.downcase]
      end
    end

    # Check if an evaluator exists for a type
    #
    # @param type [String] The evaluator type
    # @return [Boolean]
    def registered?(type)
      @mutex.synchronize do
        @evaluators.key?(type.to_s.downcase)
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
        @evaluators.delete(type.to_s.downcase)
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
    end
  end
end
