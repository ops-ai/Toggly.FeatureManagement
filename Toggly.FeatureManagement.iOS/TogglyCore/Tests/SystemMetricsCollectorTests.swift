import XCTest
@testable import TogglyCore

private func togglyTestDummyException() -> NSException {
    NSException(name: NSExceptionName("TogglyTest"), reason: "test", userInfo: nil)
}

private var togglyTestPreviousForwardCalls = 0
private var togglyTestStubPreviousCalls = 0

private func togglyTestReentrantPreviousHandler(_ exception: NSException) {
    togglyTestPreviousForwardCalls += 1
    NSGetUncaughtExceptionHandler()?(exception)
}

private func togglyTestCountingPreviousHandler(_: NSException) {
    togglyTestStubPreviousCalls += 1
}

final class SystemMetricsCollectorTests: SystemMetricsTestCase {
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

    func testUncaughtHandlerRecordsAndForwardsToPrevious() {
        let saved = NSGetUncaughtExceptionHandler()
        defer { NSSetUncaughtExceptionHandler(saved) }

        togglyTestStubPreviousCalls = 0
        NSSetUncaughtExceptionHandler(togglyTestCountingPreviousHandler)

        let collector = SystemMetricsCollector(observe: { _, _ in }, sampler: { [] })
        collector.start()
        defer { collector.stop() }

        let handler = NSGetUncaughtExceptionHandler()
        XCTAssertNotNil(handler)
        handler?(togglyTestDummyException())
        XCTAssertEqual(togglyTestStubPreviousCalls, 1)
        XCTAssertEqual(SystemMetricsCollector.Testing.uncaughtBridgeCount(), 1)
    }

    func testUncaughtHandlerReentrancyGuardSkipsNestedRecord() {
        let saved = NSGetUncaughtExceptionHandler()
        defer { NSSetUncaughtExceptionHandler(saved) }

        togglyTestPreviousForwardCalls = 0
        NSSetUncaughtExceptionHandler(togglyTestReentrantPreviousHandler)

        let collector = SystemMetricsCollector(observe: { _, _ in }, sampler: { [] })
        collector.start()
        defer { collector.stop() }

        NSGetUncaughtExceptionHandler()?(togglyTestDummyException())
        XCTAssertEqual(togglyTestPreviousForwardCalls, 1)
        XCTAssertEqual(SystemMetricsCollector.Testing.uncaughtBridgeCount(), 1)
    }

    func testDefaultSamplerEmitsDrainedExceptionCount() {
        var observed: [(String, Double)] = []
        let collector = SystemMetricsCollector(
            observe: { metric, value in observed.append((metric, value)) }
        )
        collector.start()
        defer { collector.stop() }

        SystemMetricsCollector.Testing.invokeUncaughtHandler(togglyTestDummyException())
        collector.tick()
        let exceptionSamples = observed.filter { $0.0 == "ExceptionCount" }
        XCTAssertEqual(exceptionSamples.count, 1)
        XCTAssertEqual(exceptionSamples[0].1, 1)
    }

    func testNestedInstallPreservesPreviousWhenHandlerAlreadyOurs() {
        let saved = NSGetUncaughtExceptionHandler()
        defer { NSSetUncaughtExceptionHandler(saved) }

        togglyTestStubPreviousCalls = 0
        NSSetUncaughtExceptionHandler(togglyTestCountingPreviousHandler)
        let stubHandler = NSGetUncaughtExceptionHandler()

        let first = SystemMetricsCollector(observe: { _, _ in }, sampler: { [] })
        let second = SystemMetricsCollector(observe: { _, _ in }, sampler: { [] })
        first.start()
        second.start()
        defer {
            second.stop()
            first.stop()
        }

        SystemMetricsCollector.Testing.invokeUncaughtHandler(togglyTestDummyException())
        XCTAssertEqual(togglyTestStubPreviousCalls, 1)

        second.stop()
        first.stop()
        XCTAssertTrue(
            unsafeBitCast(NSGetUncaughtExceptionHandler(), to: Optional<UnsafeRawPointer>.self)
                == unsafeBitCast(stubHandler, to: Optional<UnsafeRawPointer>.self)
        )
    }

    func testDefaultSamplerDoesNotDrainExceptionsWhenPendingCapFull() {
        var exceptionObservations = 0
        let collector = SystemMetricsCollector(
            observe: { metric, _ in
                if metric == "ExceptionCount" { exceptionObservations += 1 }
            }
        )
        collector.start()
        defer { collector.stop() }

        for _ in 0..<SystemMetricsCollector.maxPending {
            SystemMetricsCollector.Testing.invokeUncaughtHandler(togglyTestDummyException())
            collector.tick()
        }
        XCTAssertEqual(exceptionObservations, SystemMetricsCollector.maxPending)

        SystemMetricsCollector.Testing.invokeUncaughtHandler(togglyTestDummyException())
        XCTAssertEqual(SystemMetricsCollector.Testing.uncaughtBridgeCount(), 1)

        collector.tick()
        XCTAssertEqual(exceptionObservations, SystemMetricsCollector.maxPending)
        XCTAssertEqual(SystemMetricsCollector.Testing.uncaughtBridgeCount(), 1)

        collector.onFlushed()
        Thread.sleep(forTimeInterval: 0.05)
        collector.tick()
        XCTAssertEqual(exceptionObservations, SystemMetricsCollector.maxPending + 1)
        XCTAssertEqual(SystemMetricsCollector.Testing.uncaughtBridgeCount(), 0)
    }

    func testNegativeIntervalSecondsUsesDefaultSamplingCadence() {
        var observed: [(String, Double)] = []
        let collector = SystemMetricsCollector(
            observe: { metric, value in observed.append((metric, value)) },
            intervalSeconds: -3,
            sampler: { [("CpuUsage", 4)] }
        )
        collector.start()
        collector.tick()
        XCTAssertEqual(observed.count, 1)
        XCTAssertEqual(observed[0].0, "CpuUsage")
        XCTAssertEqual(observed[0].1, 4)
        collector.stop()
    }

    func testComputeCpuPercentEdgeCases() {
        typealias Sample = SystemMetricsCollector.CpuPercentSample
        XCTAssertNil(
            SystemMetricsCollector.Testing.computeCpuPercent(
                previous: Sample(userMicros: 0, sysMicros: 0, monotonicNs: 100),
                current: Sample(userMicros: 1, sysMicros: 0, monotonicNs: 100)
            )
        )
        let zeroUsage = SystemMetricsCollector.Testing.computeCpuPercent(
            previous: Sample(userMicros: 500, sysMicros: 500, monotonicNs: 0),
            current: Sample(userMicros: 500, sysMicros: 500, monotonicNs: 2_000_000_000)
        )
        XCTAssertEqual(zeroUsage, 0)
        let capped = SystemMetricsCollector.Testing.computeCpuPercent(
            previous: Sample(userMicros: 0, sysMicros: 0, monotonicNs: 0),
            current: Sample(userMicros: 10_000_000, sysMicros: 0, monotonicNs: 10_000_000)
        )
        XCTAssertEqual(capped, 100)
    }

    func testOnFlushedClearsPendingAsynchronously() {
        let flushDone = expectation(description: "pending cleared")
        var count = 0
        let collector = SystemMetricsCollector(
            observe: { _, _ in count += 1 },
            sampler: { [("ExceptionCount", 1)] }
        )
        collector.start()
        for _ in 0..<SystemMetricsCollector.maxPending {
            collector.tick()
        }
        XCTAssertEqual(count, SystemMetricsCollector.maxPending)

        collector.onFlushed()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            collector.tick()
            if count == SystemMetricsCollector.maxPending + 1 {
                flushDone.fulfill()
            }
        }
        wait(for: [flushDone], timeout: 2)
        collector.stop()
    }
}
