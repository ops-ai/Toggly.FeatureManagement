import XCTest
@testable import TogglyCore

private var handlerChainOriginalCalls = 0
private var handlerChainWrapperCalls = 0
private var handlerChainWrappedHandler: (@convention(c) (NSException) -> Void)?

private func handlerChainOriginalHandler(_: NSException) {
    handlerChainOriginalCalls += 1
}

private func handlerChainWrappingHandler(_ exception: NSException) {
    handlerChainWrapperCalls += 1
    handlerChainWrappedHandler?(exception)
}

private func handlerChainException() -> NSException {
    NSException(name: NSExceptionName("TogglyHandlerChainTest"), reason: "test", userInfo: nil)
}

/// Each test restores the process handler and clears the private bridge state.
class SystemMetricsTestCase: XCTestCase {
    private var savedHandler: (@convention(c) (NSException) -> Void)?

    override func setUp() {
        super.setUp()
        savedHandler = NSGetUncaughtExceptionHandler()
        NSSetUncaughtExceptionHandler(nil)
        SystemMetricsCollector.Testing.resetUncaughtBridgeState()
    }

    override func tearDown() {
        NSSetUncaughtExceptionHandler(savedHandler)
        SystemMetricsCollector.Testing.resetUncaughtBridgeState()
        super.tearDown()
    }
}

final class SystemMetricsHandlerChainTests: SystemMetricsTestCase {
    override func setUp() {
        super.setUp()
        handlerChainOriginalCalls = 0
        handlerChainWrapperCalls = 0
        handlerChainWrappedHandler = nil
    }

    override func tearDown() {
        super.tearDown()
        handlerChainWrappedHandler = nil
    }

    private func assertWrapperOwnsSlot(file: StaticString = #filePath, line: UInt = #line) {
        let wrapper: @convention(c) (NSException) -> Void = handlerChainWrappingHandler
        XCTAssertEqual(
            unsafeBitCast(NSGetUncaughtExceptionHandler(), to: Optional<UnsafeRawPointer>.self),
            unsafeBitCast(wrapper, to: UnsafeRawPointer.self), file: file, line: line
        )
    }

    func testExternalWrapperForwardsBeforeAndAfterStopRestart() {
        NSSetUncaughtExceptionHandler(handlerChainOriginalHandler)
        let collector = SystemMetricsCollector(observe: { _, _ in }, sampler: { [] })
        collector.start()
        defer { collector.stop() }
        handlerChainWrappedHandler = NSGetUncaughtExceptionHandler()
        NSSetUncaughtExceptionHandler(handlerChainWrappingHandler)

        NSGetUncaughtExceptionHandler()?(handlerChainException())
        XCTAssertEqual(handlerChainOriginalCalls, 1)
        XCTAssertEqual(handlerChainWrapperCalls, 1)

        collector.stop()
        assertWrapperOwnsSlot()
        // The wrapper can still call Toggly while no collector is installed.
        NSGetUncaughtExceptionHandler()?(handlerChainException())
        XCTAssertEqual(handlerChainOriginalCalls, 2)
        collector.start()
        assertWrapperOwnsSlot()
        NSGetUncaughtExceptionHandler()?(handlerChainException())
        XCTAssertEqual(handlerChainOriginalCalls, 3)
        XCTAssertEqual(handlerChainWrapperCalls, 3)
        XCTAssertEqual(SystemMetricsCollector.Testing.uncaughtBridgeCount(), 3)
    }

    func testExternalWrapperWithNilOriginalSurvivesRepeatedRestarts() {
        let collector = SystemMetricsCollector(observe: { _, _ in }, sampler: { [] })
        collector.start()
        defer { collector.stop() }
        handlerChainWrappedHandler = NSGetUncaughtExceptionHandler()
        NSSetUncaughtExceptionHandler(handlerChainWrappingHandler)

        for cycle in 1...3 {
            collector.stop()
            collector.start()
            assertWrapperOwnsSlot()
            NSGetUncaughtExceptionHandler()?(handlerChainException())
            XCTAssertEqual(handlerChainWrapperCalls, cycle)
            XCTAssertEqual(SystemMetricsCollector.Testing.uncaughtBridgeCount(), cycle)
        }
        collector.stop()
        assertWrapperOwnsSlot()
    }

    func testMultipleCollectorsPreserveWrappedChainAcrossRepeatedCycles() {
        NSSetUncaughtExceptionHandler(handlerChainOriginalHandler)
        let first = SystemMetricsCollector(observe: { _, _ in }, sampler: { [] })
        let second = SystemMetricsCollector(observe: { _, _ in }, sampler: { [] })
        first.start()
        handlerChainWrappedHandler = NSGetUncaughtExceptionHandler()
        NSSetUncaughtExceptionHandler(handlerChainWrappingHandler)
        defer {
            first.stop()
            second.stop()
        }

        for cycle in 1...3 {
            second.start()
            first.stop()
            NSGetUncaughtExceptionHandler()?(handlerChainException())
            XCTAssertEqual(handlerChainOriginalCalls, cycle * 2 - 1)
            second.stop()
            first.start()
            assertWrapperOwnsSlot()
            NSGetUncaughtExceptionHandler()?(handlerChainException())
            XCTAssertEqual(handlerChainOriginalCalls, cycle * 2)
            XCTAssertEqual(handlerChainWrapperCalls, cycle * 2)
        }
    }

    func testRetainedHandlerRestoresOriginalWhenWrapperReturnsSlot() {
        NSSetUncaughtExceptionHandler(handlerChainOriginalHandler)
        let original = NSGetUncaughtExceptionHandler()
        let collector = SystemMetricsCollector(observe: { _, _ in }, sampler: { [] })
        collector.start()
        defer { collector.stop() }
        handlerChainWrappedHandler = NSGetUncaughtExceptionHandler()
        NSSetUncaughtExceptionHandler(handlerChainWrappingHandler)
        collector.stop()
        collector.start()
        NSSetUncaughtExceptionHandler(handlerChainWrappedHandler)
        collector.stop()
        XCTAssertEqual(
            unsafeBitCast(NSGetUncaughtExceptionHandler(), to: Optional<UnsafeRawPointer>.self),
            unsafeBitCast(original, to: Optional<UnsafeRawPointer>.self)
        )
        // A subsequent owned installation can capture and restore a fresh target.
        NSSetUncaughtExceptionHandler(nil)
        collector.start()
        NSGetUncaughtExceptionHandler()?(handlerChainException())
        collector.stop()
        XCTAssertNil(NSGetUncaughtExceptionHandler())
        XCTAssertEqual(handlerChainOriginalCalls, 0)
    }

}
