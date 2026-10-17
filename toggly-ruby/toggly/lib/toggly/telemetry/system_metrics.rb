# frozen_string_literal: true

require "etc"

begin
  require "fiddle"
rescue LoadError
  # Optional: getrusage sampling is skipped when fiddle is unavailable.
end

module Toggly
  module Telemetry
    # Opt-in process metrics (CpuUsage, MemoryWorkingSet, ExceptionCount).
    module SystemMetrics
      INTERVAL_SECONDS = 10.0

      # FFI helpers for getrusage-based CPU and RSS samples.
      module RusageFFI
        module_function

        def read_rusage
          return nil unless defined?(@getrusage) && @getrusage

          # RUBY_FREE auto-releases when the pointer is GC'd / goes out of scope.
          freer = defined?(Fiddle::RUBY_FREE) ? Fiddle::RUBY_FREE : nil
          ptr = if freer
                  Fiddle::Pointer.malloc(Fiddle::SIZEOF_LONG * 18, freer)
                else
                  Fiddle::Pointer.malloc(Fiddle::SIZEOF_LONG * 18)
                end
          begin
            return nil if @getrusage.call(RUSAGE_SELF, ptr) != 0

            utime_sec = ptr[0, Fiddle::SIZEOF_LONG].unpack1("l!")
            utime_usec = ptr[Fiddle::SIZEOF_LONG, Fiddle::SIZEOF_LONG].unpack1("l!")
            stime_sec = ptr[2 * Fiddle::SIZEOF_LONG, Fiddle::SIZEOF_LONG].unpack1("l!")
            stime_usec = ptr[3 * Fiddle::SIZEOF_LONG, Fiddle::SIZEOF_LONG].unpack1("l!")
            maxrss = ptr[4 * Fiddle::SIZEOF_LONG, Fiddle::SIZEOF_LONG].unpack1("l!")
            {
              user_us: (utime_sec * 1_000_000) + utime_usec,
              sys_us: (stime_sec * 1_000_000) + stime_usec,
              maxrss: maxrss
            }
          ensure
            if freer.nil? && ptr
              if ptr.respond_to?(:call_free)
                ptr.call_free
              elsif ptr.respond_to?(:free) && ptr.free.respond_to?(:call)
                ptr.free.call(ptr)
              end
            end
          end
        rescue StandardError
          nil
        end

        RUSAGE_SELF = 0
        begin
          libc = Fiddle.dlopen(nil)
          @getrusage = Fiddle::Function.new(
            libc["getrusage"],
            [Fiddle::TYPE_INT, Fiddle::TYPE_VOIDP],
            Fiddle::TYPE_INT
          )
        rescue StandardError
          @getrusage = nil
        end
      end

      # Periodic sampler that posts gauges through the provided observe callback.
      class Collector
        def initialize(observe:, sampler: nil, interval: INTERVAL_SECONDS)
          @observe = observe
          @sampler = sampler
          @interval = interval.to_f
          @mutex = Mutex.new
          @exception_count = 0
          @last_cpu = nil
          @thread = nil
          @closed = false
          @trace = nil
          @ended_threads = []
          install_exception_handler
        end

        def start
          return if @thread&.alive?

          @closed = false
          @thread = Thread.new { run_loop }
          @thread.abort_on_exception = false
        end

        def stop
          @mutex.synchronize { @closed = true }
          @thread&.wakeup if @thread&.alive?
          @thread&.join(2.0) if @thread&.alive?
          @thread = nil
          disable_exception_handler
        end

        def tick
          return if @closed

          drain_ended_threads
          samples = @sampler ? @sampler.call : default_sample
          samples.each do |metric, value|
            next unless value.is_a?(Numeric) && value.finite? && value >= 0

            @observe.call(metric, value.to_f)
          end
          exceptions = @mutex.synchronize do
            count = @exception_count
            @exception_count = 0
            count
          end
          @observe.call("ExceptionCount", exceptions.to_f) if exceptions.positive?
        rescue StandardError
          # Never disrupt the host process.
        end

        private

        def run_loop
          loop do
            sleep(@interval)
            break if @mutex.synchronize { @closed }

            tick
          end
        end

        def default_sample
          out = []
          cpu = sample_cpu
          out << ["CpuUsage", cpu] if cpu
          mem = sample_memory_working_set
          out << ["MemoryWorkingSet", mem] if mem
          out
        end

        def sample_cpu
          ru = RusageFFI.read_rusage
          return nil unless ru

          now = Process.clock_gettime(Process::CLOCK_MONOTONIC)
          user_us = ru[:user_us]
          sys_us = ru[:sys_us]
          prev = @mutex.synchronize do
            p = @last_cpu
            @last_cpu = { user_us: user_us, sys_us: sys_us, at: now }
            p
          end
          return nil unless prev

          wall_us = [(now - prev[:at]) * 1_000_000, 1].max
          cpu_us = (user_us - prev[:user_us]) + (sys_us - prev[:sys_us])
          return nil if cpu_us.negative?

          n_cpu = [Etc.nprocessors, 1].max
          pct = (cpu_us.to_f / wall_us / n_cpu) * 100.0
          return nil unless pct.finite? && pct >= 0

          [pct, 100.0].min
        end

        def sample_memory_working_set
          if (rss = read_linux_statm_rss)
            return rss.to_f
          end

          ru = RusageFFI.read_rusage
          return nil unless ru && ru[:maxrss].to_i.positive?

          rss = ru[:maxrss]
          rss *= 1024 if RUBY_PLATFORM.include?("linux")
          rss.to_f
        end

        def read_linux_statm_rss
          return nil unless RUBY_PLATFORM.include?("linux")

          line = File.read("/proc/self/statm").split
          pages = line[1].to_i
          page_size = begin
            if Process.respond_to?(:getpagesize)
              Process.getpagesize
            elsif defined?(Etc::SC_PAGESIZE)
              Etc.sysconf(Etc::SC_PAGESIZE)
            elsif defined?(Etc::SC_PAGE_SIZE)
              Etc.sysconf(Etc::SC_PAGE_SIZE)
            else
              Integer(ENV.fetch("PAGESIZE", 4096))
            end
          rescue StandardError
            4096
          end
          pages * page_size
        rescue StandardError
          nil
        end

        def install_exception_handler
          return if @trace

          # Do not call Thread#join/#value inside TracePoint — that raises
          # ThreadError for normal exits. Queue ended threads and inspect on tick.
          @trace = TracePoint.new(:thread_end) do |tp|
            thread = tp.self
            next if thread == Thread.main
            next if thread.status == "aborting"

            @mutex.synchronize { @ended_threads << thread }
          end
          @trace.enable
        end

        def drain_ended_threads
          ended = @mutex.synchronize do
            list = @ended_threads
            @ended_threads = []
            list
          end
          ended.each do |thread|
            begin
              thread.value
            rescue StandardError, ScriptError
              @mutex.synchronize { @exception_count += 1 }
            rescue Exception # rubocop:disable Lint/RescueException
              nil
            end
          end
        end

        def disable_exception_handler
          return unless @trace

          @trace.disable
          @trace = nil
          drain_ended_threads
        end
      end
    end
  end
end
