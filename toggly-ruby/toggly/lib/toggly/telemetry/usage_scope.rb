# frozen_string_literal: true

module Toggly
  module Telemetry
    # Tracks one usage attempt; call {#fail} to mark failure without raising.
    class FeatureUsageScope
      def initialize
        @failed = false
      end

      def fail
        @failed = true
      end

      def failed?
        @failed
      end
    end

    # Runs a usage-scope block and records attempt, duration, and errors.
    module UsageScopeRunner
      module_function

      def run(handlers, &block)
        record_attempt, record_success, record_failure = handlers
        record_attempt.call
        start = Process.clock_gettime(Process::CLOCK_MONOTONIC)
        scope = FeatureUsageScope.new
        outcome_recorded = false
        begin
          result = block.call(scope)
          duration_ms = elapsed_ms(start)
          if scope.failed?
            record_failure.call(duration_ms)
          else
            record_success.call(duration_ms)
          end
          outcome_recorded = true
          result
        rescue StandardError => e
          record_failure.call(elapsed_ms(start))
          outcome_recorded = true
          raise e
        ensure
          # Non-local exits (return/break/throw) still need an outcome; honor fail().
          unless outcome_recorded
            duration_ms = elapsed_ms(start)
            if scope.failed?
              record_failure.call(duration_ms)
            else
              record_success.call(duration_ms)
            end
          end
        end
      end

      def elapsed_ms(start)
        ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - start) * 1000).round
        ms.negative? ? 0 : ms
      end
    end
  end
end
