import Foundation
import Darwin

private enum UncaughtExceptionBridge {
    static let lock = NSLock()
    static var count = 0
    static var previous: (@convention(c) (NSException) -> Void)?
    static var installs = 0

    static func record() {
        lock.lock()
        count += 1
        lock.unlock()
    }

    static func callPrevious(_ exception: NSException) {
        previous?(exception)
    }

    static func install() {
        lock.lock()
        defer { lock.unlock() }
        if installs == 0 {
            if previous == nil {
                previous = NSGetUncaughtExceptionHandler()
            }
            if NSGetUncaughtExceptionHandler() != togglySystemMetricsUncaughtHandler {
                NSSetUncaughtExceptionHandler(togglySystemMetricsUncaughtHandler)
            }
        }
        installs += 1
    }

    static func uninstall() {
        lock.lock()
        defer { lock.unlock() }
        guard installs > 0 else { return }
        installs -= 1
        if installs == 0 {
            // Only restore / clear `previous` when we still own the slot.
            // If another SDK wrapped us, keep `previous` so a later install
            // does not lose the original chain or recurse into ourselves.
            if NSGetUncaughtExceptionHandler() == togglySystemMetricsUncaughtHandler {
                NSSetUncaughtExceptionHandler(previous)
                previous = nil
            }
        }
    }

    static func drainCount() -> Int {
        lock.lock()
        defer { lock.unlock() }
        let value = count
        count = 0
        return value
    }
}

private func togglySystemMetricsUncaughtHandler(_ exception: NSException) {
    UncaughtExceptionBridge.record()
    UncaughtExceptionBridge.callPrevious(exception)
}

/// Opt-in client metrics: CpuUsage and ExceptionCount every 10s via gauges.
final class SystemMetricsCollector: @unchecked Sendable {
    static let intervalSeconds: TimeInterval = 10
    static let maxPending = 30

    typealias Observe = @Sendable (String, Double) -> Void
    typealias Sampler = @Sendable () -> [(String, Double)]

    private let observe: Observe
    private let interval: TimeInterval
    private let customSampler: Sampler?
    private let queue = DispatchQueue(label: "io.toggly.system-metrics")
    private var timer: DispatchSourceTimer?
    private var started = false
    private var pendingByMetric: [String: Int] = [:]
    private var lastCpu: CpuSample?

    init(
        observe: @escaping Observe,
        intervalSeconds: TimeInterval = SystemMetricsCollector.intervalSeconds,
        sampler: Sampler? = nil
    ) {
        self.observe = observe
        self.interval = intervalSeconds > 0 ? intervalSeconds : SystemMetricsCollector.intervalSeconds
        self.customSampler = sampler
    }

    func start() {
        queue.sync {
            guard !started else { return }
            started = true
            lastCpu = readCpuSample()
            UncaughtExceptionBridge.install()
            let source = DispatchSource.makeTimerSource(queue: queue)
            source.schedule(deadline: .now() + interval, repeating: interval)
            source.setEventHandler { [weak self] in self?.tick() }
            source.resume()
            timer = source
        }
    }

    func stop() {
        queue.sync {
            guard started else { return }
            started = false
            timer?.cancel()
            timer = nil
            UncaughtExceptionBridge.uninstall()
            pendingByMetric.removeAll()
            lastCpu = nil
        }
    }

    func onFlushed() {
        queue.async { [weak self] in
            self?.pendingByMetric.removeAll()
        }
    }

    func tick() {
        guard started else { return }
        let samples = customSampler?() ?? defaultSample()
        for (metric, value) in samples {
            guard value.isFinite else { continue }
            let pending = pendingByMetric[metric, default: 0]
            if pending >= Self.maxPending { continue }
            pendingByMetric[metric] = pending + 1
            observe(metric, value)
        }
    }

    private func defaultSample() -> [(String, Double)] {
        var out: [(String, Double)] = []
        if let cpu = sampleCpuPercent() {
            out.append(("CpuUsage", cpu))
        }
        let exceptions = UncaughtExceptionBridge.drainCount()
        if exceptions > 0 {
            out.append(("ExceptionCount", Double(exceptions)))
        }
        return out
    }

    private func sampleCpuPercent() -> Double? {
        guard let current = readCpuSample() else { return nil }
        defer { lastCpu = current }
        guard let previous = lastCpu else { return nil }
        let wallNs = current.monotonicNs &- previous.monotonicNs
        guard wallNs > 0 else { return nil }
        let cpuMicros = (current.userMicros &- previous.userMicros)
            &+ (current.sysMicros &- previous.sysMicros)
        let cpuNs = cpuMicros * 1_000
        let cores = max(1, ProcessInfo.processInfo.processorCount)
        let pct = (Double(cpuNs) * 100.0 / Double(wallNs)) / Double(cores)
        guard pct.isFinite, pct >= 0 else { return nil }
        return min(100, pct)
    }

    private struct CpuSample {
        let userMicros: UInt64
        let sysMicros: UInt64
        let monotonicNs: UInt64
    }

    private func readCpuSample() -> CpuSample? {
        var usage = rusage()
        guard getrusage(RUSAGE_SELF, &usage) == 0 else { return nil }
        let user = UInt64(usage.ru_utime.tv_sec) * 1_000_000 + UInt64(usage.ru_utime.tv_usec)
        let sys = UInt64(usage.ru_stime.tv_sec) * 1_000_000 + UInt64(usage.ru_stime.tv_usec)
        var time = timespec()
        guard clock_gettime(CLOCK_MONOTONIC_RAW, &time) == 0 else { return nil }
        let mono = UInt64(time.tv_sec) * 1_000_000_000 + UInt64(time.tv_nsec)
        return CpuSample(userMicros: user, sysMicros: sys, monotonicNs: mono)
    }
}
