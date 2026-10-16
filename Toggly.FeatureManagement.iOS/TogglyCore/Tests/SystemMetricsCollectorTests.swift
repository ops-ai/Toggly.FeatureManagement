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
}
