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
}
