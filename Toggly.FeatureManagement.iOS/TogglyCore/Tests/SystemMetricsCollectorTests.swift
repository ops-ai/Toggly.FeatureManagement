import XCTest
@testable import TogglyCore

final class SystemMetricsCollectorTests: XCTestCase {
    func testDoesNotStartSamplingWhenDisabledBySampler() {
        let collector = SystemMetricsCollector(observe: { _, _ in }, sampler: { [] })
        collector.start()
        collector.tick()
        collector.stop()
    }

    func testEmitsInjectedObservations() {
        var observed: [(String, Double)] = []
        let collector = SystemMetricsCollector(
            observe: { metric, value in observed.append((metric, value)) },
            sampler: { [("ExceptionCount", 2)] }
        )
        collector.start()
        collector.tick()
        XCTAssertEqual(observed.count, 1)
        XCTAssertEqual(observed[0].0, "ExceptionCount")
        XCTAssertEqual(observed[0].1, 2)
        collector.stop()
    }

    func testCapsPendingSamplesUntilFlushed() {
        var count = 0
        let collector = SystemMetricsCollector(
            observe: { _, _ in count += 1 },
            sampler: { [("ExceptionCount", 1)] }
        )
        collector.start()
        for _ in 0..<(SystemMetricsCollector.maxPending + 3) {
            collector.tick()
        }
        XCTAssertEqual(count, SystemMetricsCollector.maxPending)
        collector.onFlushed()
        // onFlushed clears pending on the collector queue asynchronously.
        Thread.sleep(forTimeInterval: 0.05)
        collector.tick()
        XCTAssertEqual(count, SystemMetricsCollector.maxPending + 1)
        collector.stop()
    }

    func testIgnoresNonFiniteSamples() {
        var observed: [(String, Double)] = []
        let collector = SystemMetricsCollector(
            observe: { metric, value in observed.append((metric, value)) },
            sampler: { [("ExceptionCount", .nan), ("CpuUsage", 1.5)] }
        )
        collector.start()
        collector.tick()
        XCTAssertEqual(observed.count, 1)
        XCTAssertEqual(observed[0].0, "CpuUsage")
        collector.stop()
    }

    func testTickBeforeStartIsNoOpAndDoubleStartStopAreIdempotent() {
        var observed: [(String, Double)] = []
        let collector = SystemMetricsCollector(
            observe: { metric, value in observed.append((metric, value)) },
            intervalSeconds: 0,
            sampler: { [("CpuUsage", 1)] }
        )
        collector.tick()
        XCTAssertTrue(observed.isEmpty)
        collector.start()
        collector.start()
        collector.tick()
        XCTAssertEqual(observed.count, 1)
        collector.stop()
        collector.stop()
        let before = observed.count
        collector.tick()
        XCTAssertEqual(observed.count, before)
    }

    func testDefaultSamplerEmitsCpuAfterSecondTick() {
        var observed: [(String, Double)] = []
        let collector = SystemMetricsCollector(
            observe: { metric, value in observed.append((metric, value)) }
        )
        collector.start()
        observed.removeAll()
        // Prime CPU baseline then sample again.
        Thread.sleep(forTimeInterval: 0.02)
        collector.tick()
        XCTAssertTrue(observed.contains(where: { $0.0 == "CpuUsage" && $0.1.isFinite }))
        collector.stop()
    }

    func testUncaughtExceptionHandlerInstallAndOwnership() {
        let previous = NSGetUncaughtExceptionHandler()
        defer { NSSetUncaughtExceptionHandler(previous) }

        let first = SystemMetricsCollector(observe: { _, _ in }, sampler: { [] })
        first.start()
        let ours = NSGetUncaughtExceptionHandler()
        XCTAssertNotNil(ours)

        // Hijack the slot so stop must not restore past the replacement.
        let replacement: (@convention(c) (NSException) -> Void) = { _ in }
        NSSetUncaughtExceptionHandler(replacement)
        first.stop()
        XCTAssertTrue(
            unsafeBitCast(NSGetUncaughtExceptionHandler(), to: Optional<UnsafeRawPointer>.self)
                == unsafeBitCast(replacement, to: Optional<UnsafeRawPointer>.self)
        )

        // Clean install/uninstall restores prior when we still own the slot.
        NSSetUncaughtExceptionHandler(previous)
        let second = SystemMetricsCollector(observe: { _, _ in }, sampler: { [] })
        second.start()
        second.stop()
        XCTAssertTrue(
            unsafeBitCast(NSGetUncaughtExceptionHandler(), to: Optional<UnsafeRawPointer>.self)
                == unsafeBitCast(previous, to: Optional<UnsafeRawPointer>.self)
        )
    }
}
