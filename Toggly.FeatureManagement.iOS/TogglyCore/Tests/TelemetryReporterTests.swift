import Foundation
import XCTest
import zlib
@testable import TogglyCore

final class TelemetryReporterTests: XCTestCase {
    private enum CompressionFailure: Error { case failed }

    private func gunzip(_ data: Data) throws -> Data {
        var stream = z_stream()
        let initialized = inflateInit2_(&stream, 31, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
        XCTAssertEqual(initialized, Z_OK)
        defer { inflateEnd(&stream) }
        var output = [UInt8](repeating: 0, count: 49_152)
        let status = data.withUnsafeBytes { input in
            output.withUnsafeMutableBytes { target in
                stream.next_in = UnsafeMutablePointer(mutating: input.bindMemory(to: Bytef.self).baseAddress!)
                stream.avail_in = uInt(input.count)
                stream.next_out = target.bindMemory(to: Bytef.self).baseAddress!
                stream.avail_out = uInt(target.count)
                return inflate(&stream, Z_FINISH)
            }
        }
        XCTAssertEqual(status, Z_STREAM_END)
        return Data(output.prefix(Int(stream.total_out)))
    }

    func testOrdinaryFlushUsesNativeGzipAndCompressionFailureFallsBackBeforeSend() async throws {
        let requests = Requests()
        let gzip = TelemetryReporter(appKey: "test-app", compressor: { TelemetryReporter.gzip($0) }) { request in
            await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        await gzip.recordCheck("checkout", variant: "enabled")
        await gzip.flushTelemetry()
        let firstRequests = await requests.requests
        let first = try XCTUnwrap(firstRequests.first)
        XCTAssertEqual(first.value(forHTTPHeaderField: "Content-Encoding"), "gzip")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: gunzip(try XCTUnwrap(first.httpBody))) as? [String: Any])
        XCTAssertEqual((body["f"] as? [String: [String: [Int]]])?["checkout"]?["enabled"], [1])

        let fallback = TelemetryReporter(appKey: "test-app", compressor: { _ in throw CompressionFailure.failed }) { request in
            await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        await fallback.recordUsage("checkout")
        await fallback.flushTelemetry()
        let captured = await requests.requests
        XCTAssertEqual(captured.count, 2)
        XCTAssertNil(captured[1].value(forHTTPHeaderField: "Content-Encoding"))
        XCTAssertNoThrow(try JSONSerialization.jsonObject(with: XCTUnwrap(captured[1].httpBody)))
    }

    func testAmbiguousCompressedFailureDoesNotRetryAsPlain() async {
        let requests = Requests()
        let reporter = TelemetryReporter(appKey: "test-app", compressor: { TelemetryReporter.gzip($0) }) { request in
            await requests.append(request)
            throw URLError(.networkConnectionLost)
        }
        await reporter.recordUsage("checkout")
        await reporter.flushTelemetry()
        let captured = await requests.requests
        XCTAssertEqual(captured.count, 1)
        XCTAssertEqual(captured.first?.value(forHTTPHeaderField: "Content-Encoding"), "gzip")
    }

    func testDisposeFlushUsesPlainJson() async throws {
        let requests = Requests()
        let sent = expectation(description: "final telemetry request")
        let reporter = TelemetryReporter(appKey: "test-app", compressor: { TelemetryReporter.gzip($0) }) { request in
            await requests.append(request)
            sent.fulfill()
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        await reporter.recordUsage("checkout")
        await reporter.dispose()
        await fulfillment(of: [sent], timeout: 2)
        let captured = await requests.requests
        XCTAssertEqual(captured.count, 1)
        XCTAssertNil(captured[0].value(forHTTPHeaderField: "Content-Encoding"))
        XCTAssertNoThrow(try JSONSerialization.jsonObject(with: XCTUnwrap(captured[0].httpBody)))
    }
    func testRejectedAndDrainedNamesDoNotRemainInHistoricalCache() async throws {
        let reporter = TelemetryReporter(appKey: "test-app") { request in
            HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        for cycle in 0..<2 {
            for index in 0..<100 {
                await reporter.setGauge(String(repeating: "m", count: 20_000) + "\(cycle)-\(index)", value: 1)
            }
            await reporter.flushTelemetry()
            // Reflection runs only after all actor mutations have completed.
            let cache = Mirror(reflecting: reporter).children.first { $0.label == "encodedNameLengths" }?.value as? [String: Int]
            XCTAssertTrue(cache?.isEmpty ?? true, "Rejected and drained names must not be retained")
        }
        await reporter.dispose()
    }

    func testDisposeSendsAtMostOneFinalEnvelopeAndIsTerminal() async throws {
        let requests = Requests()
        let reporter = TelemetryReporter(appKey: "test-app") { request in
            await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        for index in 0..<8 { await reporter.setGauge(String(repeating: "m", count: 20_000) + "\(index)", value: 1) }
        await reporter.dispose()
        await reporter.flushTelemetry()
        await reporter.recordUsage("after-dispose")
        await reporter.flushTelemetry()
        let captured = await requests.requests
        XCTAssertEqual(captured.count, 1)
    }

    func testRapidRotationsShareOneMetadataInclusiveBoundAndReleaseAfterDrain() async throws {
        let requests = Requests()
        let barrier = Barrier()
        let started = expectation(description: "one in-flight request")
        let reporter = TelemetryReporter(appKey: "test-app") { request in
            await requests.append(request)
            if await requests.requests.count == 1 { started.fulfill(); await barrier.wait() }
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        await reporter.setContext(instanceId: "first")
        await reporter.setGauge("cart", value: 1)
        let flush = Task { await reporter.flushTelemetry() }
        await fulfillment(of: [started], timeout: 2)
        for index in 0..<400 {
            await reporter.setContext(instanceId: String(repeating: "token", count: 200) + "\(index)")
            await reporter.setGauge("cart", value: Double(index))
            let resources = await reporter.retainedResources()
            XCTAssertLessThanOrEqual(resources.entries, 2_000)
            XCTAssertLessThanOrEqual(resources.bytes, 262_144)
        }
        let count = await requests.requests.count
        XCTAssertEqual(count, 1)
        await barrier.release()
        await flush.value
        let empty = await reporter.retainedResources()
        XCTAssertEqual(empty.entries, 0)
        XCTAssertEqual(empty.bytes, 0)
        for index in 0..<500 { await reporter.setContext(identity: "empty-\(index)") }
        let stillEmpty = await reporter.retainedResources()
        XCTAssertEqual(stillEmpty.bytes, 0)
        await reporter.dispose()
    }

    func testRetryRetainsOriginalAttributionAcrossTokenRotationsAndGaugePartitions() async throws {
        let requests = Requests()
        let barrier = Barrier()
        let retryStarted = expectation(description: "retry waiting")
        let reporter = TelemetryReporter(appKey: "test-app", identity: "alice", sleep: { _ in
            retryStarted.fulfill(); await barrier.wait()
        }) { request in
            await requests.append(request)
            let status = await requests.requests.count == 1 ? 503 : 202
            return HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        }
        await reporter.setGauge("cart", value: 1)
        let flush = Task { await reporter.flushTelemetry() }
        await fulfillment(of: [retryStarted], timeout: 2)
        await reporter.setContext(instanceId: "minted-one", identity: "bob")
        await reporter.setGauge("cart", value: 2)
        await reporter.setContext(instanceId: "minted-two", identity: "bob")
        await reporter.setGauge("cart", value: 3)
        await barrier.release()
        await flush.value
        let captured = await requests.requests
        XCTAssertEqual(captured.count, 4)
        XCTAssertEqual(captured[0].httpBody, captured[1].httpBody)
        let bodies = try captured.map { try JSONSerialization.jsonObject(with: XCTUnwrap($0.httpBody)) as! [String: Any] }
        XCTAssertEqual(bodies[0]["u"] as? String, "alice")
        XCTAssertEqual(bodies[2]["i"] as? String, "minted-one")
        XCTAssertEqual(bodies[3]["i"] as? String, "minted-two")
        XCTAssertNil(bodies[3]["u"])
        XCTAssertEqual((bodies[2]["m"] as? [String: Int])?["cart"], 2)
        XCTAssertEqual((bodies[3]["m"] as? [String: Int])?["cart"], 3)
        await reporter.dispose()
    }

    func testPendingEventsExpireFromAdmissionBeforeFirstFlush() async {
        let clock = TestClock()
        let requests = Requests()
        let reporter = TelemetryReporter(appKey: "test-app", clock: { clock.now() }) { request in
            await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        await reporter.recordUsage("old")
        clock.advance(301)
        await reporter.flushTelemetry()
        let captured = await requests.requests
        XCTAssertTrue(captured.isEmpty)
        let resources = await reporter.retainedResources()
        XCTAssertEqual(resources.bytes, 0)
        await reporter.dispose()
    }

    actor Requests {
        var requests: [URLRequest] = []
        func append(_ request: URLRequest) { requests.append(request) }
    }

    final class Diagnostics: @unchecked Sendable {
        private let lock = NSLock()
        private var values: [String] = []
        func add(_ value: String) { lock.lock(); values.append(value); lock.unlock() }
        func snapshot() -> [String] { lock.lock(); defer { lock.unlock() }; return values }
    }

    func testInvalidIntervalFallsBackAndCredentialedEndpointIsDisabled() async throws {
        let requests = Requests()
        let diagnostics = Diagnostics()
        let fallback = TelemetryReporter(appKey: "test-app", telemetryFlushIntervalMs: 2,
            onDiagnostic: { diagnostics.add($0) }) { request in
            await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        await fallback.recordUsage("checkout")
        await fallback.flushTelemetry()
        let firstCount = await requests.requests.count
        XCTAssertEqual(firstCount, 1)
        XCTAssertEqual(diagnostics.snapshot(), ["telemetry_invalid_interval"])

        let invalid = TelemetryReporter(appKey: "test-app", metricsBaseUrl: "https://user:pass@metrics.example.test",
            onDiagnostic: { diagnostics.add($0) }) { request in
            await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        await invalid.recordUsage("checkout")
        await invalid.flushTelemetry()
        let finalCount = await requests.requests.count
        XCTAssertEqual(finalCount, 1)
        XCTAssertEqual(diagnostics.snapshot(), ["telemetry_invalid_interval", "telemetry_invalid_endpoint"])
    }

    private func sharedContract() throws -> [String: Any] {
        var location = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { location.deleteLastPathComponent() }
        location.appendPathComponent("tests/frontend-telemetry/contract.json")
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: location)) as? [String: Any])
    }

    func testSharedContractScenarios() async throws {
        let contract = try sharedContract()
        let scenarios = try XCTUnwrap(contract["scenarios"] as? [[String: Any]]) +
            (contract["contextTransitionScenarios"] as? [[String: Any]] ?? [])
        for scenario in scenarios {
            let name = try XCTUnwrap(scenario["name"] as? String)
            let options = scenario["options"] as? [String: Any] ?? [:]
            let requests = Requests()
            let reporter = TelemetryReporter(
                appKey: options["appKey"] as? String ?? "test-app",
                instanceId: options["instanceId"] as? String, identity: options["identity"] as? String,
                enableTelemetry: options["enableTelemetry"] as? Bool ?? true
            ) { request in
                await requests.append(request)
                return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
            }
            for event in try XCTUnwrap(scenario["events"] as? [[Any]]) {
                let method = try XCTUnwrap(event[0] as? String)
                if method == "setContext" {
                    let context = try XCTUnwrap(event[1] as? [String: Any])
                    await reporter.setContext(instanceId: context["instanceId"] as? String, identity: context["identity"] as? String)
                    continue
                }
                let key = try XCTUnwrap(event[1] as? String)
                switch method {
                case "recordCheck": await reporter.recordCheck(key, variant: event[2] as! String)
                case "recordUsage": await reporter.recordUsage(key, variant: event.count > 2 ? event[2] as! String : "enabled")
                case "recordView": await reporter.recordView(key, variant: event.count > 2 ? event[2] as! String : "enabled")
                case "incrementCounter": await reporter.incrementCounter(key, value: (event[2] as! NSNumber).doubleValue)
                case "setGauge": await reporter.setGauge(key, value: (event[2] as! NSNumber).doubleValue)
                default: XCTFail("Unknown shared fixture event: \(method)")
                }
            }
            await reporter.flushTelemetry()
            let captured = await requests.requests
            let expected = try XCTUnwrap(scenario["envelopes"] as? [[String: Any]])
            XCTAssertEqual(captured.count, expected.count, name)
            for (request, expectedBody) in zip(captured, expected) {
                let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: Any])
                XCTAssertEqual(body as NSDictionary, expectedBody as NSDictionary, name)
            }
            await reporter.dispose()
        }
    }

    actor RetryTrace {
        var statuses: [Int]
        var attempts: [Int] = []
        var nowMs = 0
        init(statuses: [Int]) { self.statuses = statuses }
        func respond(to request: URLRequest, retryAfter: String?, failure: String?) throws -> HTTPURLResponse {
            attempts.append(nowMs)
            if failure == "network" { throw URLError(.networkConnectionLost) }
            if failure == "timeout" { throw URLError(.timedOut) }
            let status = statuses.removeFirst()
            return HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                                   headerFields: retryAfter.map { ["Retry-After": $0] })!
        }
        func advance(_ seconds: TimeInterval) { nowMs += Int(seconds * 1000) }
    }

    func testSharedTransportRetryScenarios() async throws {
        let contract = try sharedContract()
        let scenarios = try XCTUnwrap(contract["transportScenarios"] as? [[String: Any]])
        for scenario in scenarios {
            let name = try XCTUnwrap(scenario["name"] as? String)
            let trace = RetryTrace(statuses: scenario["statuses"] as? [Int] ?? [])
            let retryAfter = scenario["retryAfter"] as? String
            let failure = scenario["failure"] as? String
            let reporter = TelemetryReporter(appKey: "test-app", sleep: { seconds in
                await trace.advance(seconds)
            }) { request in
                try await trace.respond(to: request, retryAfter: retryAfter, failure: failure)
            }
            await reporter.incrementCounter("orders")
            await reporter.flushTelemetry()
            let attempts = await trace.attempts
            XCTAssertEqual(attempts, scenario["attemptTimesMs"] as? [Int], name)
            await reporter.dispose()
        }
    }

    func testSharedEndpointScenarios() async throws {
        let contract = try sharedContract()
        let scenarios = try XCTUnwrap(contract["endpointScenarios"] as? [[String: Any]])
        for scenario in scenarios {
            let name = try XCTUnwrap(scenario["name"] as? String)
            let base = try XCTUnwrap(scenario["metricsBaseUrl"] as? String)
            let expected = scenario["expectedUrl"] as? String
            let requests = Requests()
            let reporter = TelemetryReporter(appKey: "test-app", metricsBaseUrl: base) { request in
                await requests.append(request)
                return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
            }
            await reporter.recordUsage("flag")
            await reporter.flushTelemetry()
            let captured = await requests.requests
            XCTAssertEqual(captured.first?.url?.absoluteString, expected, name)
            XCTAssertEqual(captured.count, expected == nil ? 0 : 1, name)
        }
    }

    private func boundaryKey(_ entry: [String: Any]) throws -> String {
        let overhead = try JSONSerialization.data(withJSONObject: entry).count
        return String(repeating: "x", count: 49_152 - overhead)
    }

    func testActualFeatureEntryAdmissionPreservesAcceptedDataAtByteBoundary() async throws {
        let requests = Requests()
        let reporter = TelemetryReporter(appKey: "test-app") { request in
            await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        let checkKey = try boundaryKey(["k": "test-app", "e": "Production", "f": ["": ["enabled": [1]]]])
        let growthKey = try boundaryKey(["k": "test-app", "e": "Production", "f": ["": ["enabled": [9]]]])
            .replacingOccurrences(of: "x", with: "y")
        await reporter.recordCheck("safe", variant: "enabled")
        await reporter.recordUsage(checkKey)
        await reporter.recordView(checkKey)
        for _ in 0..<10 { await reporter.recordCheck(growthKey, variant: "enabled") }
        await reporter.flushTelemetry()
        let captured = await requests.requests
        var safeChecks = 0
        var grownChecks = 0
        for request in captured {
            let data = try XCTUnwrap(request.httpBody)
            XCTAssertLessThanOrEqual(data.count, 49_152)
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            let features = try XCTUnwrap(body["f"] as? [String: [String: [Int]]])
            safeChecks += features["safe"]?["enabled"]?.first ?? 0
            grownChecks += features[growthKey]?["enabled"]?.first ?? 0
            XCTAssertNil(features[checkKey])
        }
        XCTAssertEqual(safeChecks, 1)
        XCTAssertEqual(grownChecks, 9)
    }

    func testActualMetricEntryAdmissionPreservesAcceptedDataAtByteBoundary() async throws {
        let requests = Requests()
        let reporter = TelemetryReporter(appKey: "test-app") { request in
            await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        let counterKey = try boundaryKey(["k": "test-app", "e": "Production", "m": ["": 1]])
        let gaugeKey = try boundaryKey(["k": "test-app", "e": "Production", "m": ["": 1]])
            .replacingOccurrences(of: "x", with: "y")
        await reporter.recordCheck("safe", variant: "enabled")
        await reporter.incrementCounter(counterKey, value: 1_000_000)
        await reporter.setGauge(gaugeKey, value: 999_999.5)
        await reporter.flushTelemetry()
        let captured = await requests.requests
        XCTAssertEqual(captured.count, 1)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(captured[0].httpBody)) as? [String: Any])
        XCTAssertEqual((body["f"] as? [String: [String: [Int]]])?["safe"]?["enabled"], [1])
        XCTAssertNil(body["m"])
    }

    func testEscapedHeadersAndRepeatedLongMetricKeysRespectTotalByteLimit() async throws {
        for (environment, key) in [(String(repeating: "\"", count: 10_000), "orders"),
                                   ("Production", String(repeating: "m", count: 20_000))] {
            let requests = Requests()
            let reporter = TelemetryReporter(appKey: "test-app", environment: environment) { request in
                await requests.append(request)
                return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
            }
            for _ in 0..<20 { await reporter.incrementCounter(key, value: 1_000_000) }
            await reporter.flushTelemetry()
            let captured = await requests.requests
            XCTAssertFalse(captured.isEmpty)
            XCTAssertLessThan(captured.count, 20)
            XCTAssertLessThanOrEqual(captured.reduce(0) { $0 + ($1.httpBody?.count ?? 0) }, 262_144)
            for request in captured { XCTAssertLessThanOrEqual(try XCTUnwrap(request.httpBody).count, 49_152) }
        }
    }

    func testInflightAndPendingBytesShareOneAdmissionBudget() async throws {
        let requests = Requests()
        let barrier = Barrier()
        let started = expectation(description: "first request inflight")
        let reporter = TelemetryReporter(appKey: "test-app") { request in
            await requests.append(request)
            let count = await requests.requests.count
            if count == 1 { started.fulfill(); await barrier.wait() }
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        let firstKey = String(repeating: "a", count: 20_000)
        let nextKey = String(repeating: "b", count: 20_000)
        await reporter.setGauge(firstKey, value: 1)
        let flush = Task { await reporter.flushTelemetry() }
        await fulfillment(of: [started], timeout: 2)
        for _ in 0..<20 { await reporter.incrementCounter(nextKey, value: 1_000_000) }
        await barrier.release()
        await flush.value
        let captured = await requests.requests
        XCTAssertLessThanOrEqual(captured.reduce(0) { $0 + ($1.httpBody?.count ?? 0) }, 262_144)
    }

    final class TestClock: @unchecked Sendable {
        private let lock = NSLock()
        private var time: TimeInterval = 0
        func now() -> TimeInterval { lock.lock(); defer { lock.unlock() }; return time }
        func advance(_ seconds: TimeInterval) { lock.lock(); time += seconds; lock.unlock() }
    }

    func testOversleptRetryAndQueuedEnvelopeExpireBeforeSend() async throws {
        let clock = TestClock()
        let requests = Requests()
        let reporter = TelemetryReporter(appKey: "test-app", sleep: { _ in clock.advance(301) },
                                         clock: { clock.now() }) { request in
            await requests.append(request)
            let count = await requests.requests.count
            return HTTPURLResponse(url: request.url!, statusCode: count == 1 ? 503 : 202,
                                   httpVersion: nil, headerFields: nil)!
        }
        await reporter.recordUsage("old")
        await reporter.flushTelemetry()
        let captured = await requests.requests
        XCTAssertEqual(captured.count, 1)

        let clock2 = TestClock()
        let queued = Requests()
        let reporter2 = TelemetryReporter(appKey: "test-app", sleep: { _ in clock2.advance(301) },
                                          clock: { clock2.now() }) { request in
            await queued.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!
        }
        for number in 0..<17 { await reporter2.recordCheck("experiment", variant: "variant-\(number)") }
        await reporter2.flushTelemetry()
        let queuedRequests = await queued.requests
        XCTAssertEqual(queuedRequests.count, 1)
    }

    func testCumulativeRetryExpiryStopsBeforeThirdAttempt() async {
        let clock = TestClock()
        let requests = Requests()
        let reporter = TelemetryReporter(appKey: "test-app", sleep: { _ in clock.advance(150) },
                                         clock: { clock.now() }) { request in
            await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!
        }
        await reporter.recordUsage("old")
        await reporter.flushTelemetry()
        let captured = await requests.requests
        XCTAssertEqual(captured.count, 2)
    }

    actor RetryCancellationProbe {
        var cancelled = false
        func sleep() async {
            do { try await Task.sleep(nanoseconds: 2_000_000_000) }
            catch { cancelled = true }
        }
    }

    func testDisposeCancelsRetrySleepAndFlushesNewerDataPromptly() async throws {
        let requests = Requests()
        let probe = RetryCancellationProbe()
        let entered = expectation(description: "retry backoff entered")
        let completed = expectation(description: "flush completed promptly after dispose")
        let reporter = TelemetryReporter(appKey: "test-app", sleep: { _ in
            entered.fulfill()
            await probe.sleep()
        }) { request in
            await requests.append(request)
            let count = await requests.requests.count
            return HTTPURLResponse(url: request.url!, statusCode: count == 1 ? 503 : 202,
                                   httpVersion: nil, headerFields: nil)!
        }
        await reporter.recordUsage("old")
        let flush = Task { await reporter.flushTelemetry(); completed.fulfill() }
        await fulfillment(of: [entered], timeout: 1)
        await reporter.recordUsage("new")
        await reporter.dispose()
        await fulfillment(of: [completed], timeout: 1)
        await flush.value
        let cancelled = await probe.cancelled
        XCTAssertTrue(cancelled)
        let captured = await requests.requests
        XCTAssertEqual(captured.count, 2)
        XCTAssertNil(captured[1].value(forHTTPHeaderField: "Content-Encoding"))
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(captured[1].httpBody)) as? [String: Any])
        XCTAssertEqual((body["f"] as? [String: [String: [Int]]])?["new"]?["enabled"], [0, 1])
    }

    actor Barrier {
        private var continuation: CheckedContinuation<Void, Never>?
        func wait() async { await withCheckedContinuation { continuation = $0 } }
        func release() { continuation?.resume(); continuation = nil }
    }

    func testInflightGaugeStaysAheadOfNewerGauge() async throws {
        let requests = Requests()
        let barrier = Barrier()
        let started = expectation(description: "first telemetry request started")
        let reporter = TelemetryReporter(appKey: "test-app") { request in
            await requests.append(request)
            let count = await requests.requests.count
            if count == 1 { started.fulfill(); await barrier.wait() }
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        await reporter.setGauge("cart", value: 1)
        let first = Task { await reporter.flushTelemetry() }
        await fulfillment(of: [started], timeout: 2)
        await reporter.setGauge("cart", value: 2)
        let second = Task { await reporter.flushTelemetry() }
        await barrier.release()
        await first.value
        await second.value
        let captured = await requests.requests
        XCTAssertEqual(captured.count, 2)
        let firstBody = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(captured[0].httpBody)) as? [String: Any])
        let secondBody = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(captured[1].httpBody)) as? [String: Any])
        XCTAssertEqual((firstBody["m"] as? [String: Int])?["cart"], 1)
        XCTAssertEqual((secondBody["m"] as? [String: Int])?["cart"], 2)
    }

    func testMetricKindCannotSwitchWhilePreviousValueIsInflight() async throws {
        let requests = Requests()
        let barrier = Barrier()
        let started = expectation(description: "gauge request started")
        let reporter = TelemetryReporter(appKey: "test-app") { request in
            await requests.append(request)
            let count = await requests.requests.count
            if count == 1 { started.fulfill(); await barrier.wait() }
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        await reporter.setGauge("cart", value: 1)
        let flush = Task { await reporter.flushTelemetry() }
        await fulfillment(of: [started], timeout: 2)
        await reporter.incrementCounter("cart", value: 2)
        await barrier.release()
        await flush.value
        await reporter.flushTelemetry()
        let captured = await requests.requests
        XCTAssertEqual(captured.count, 1)
    }

    func testOversizedEntryIsRejectedWithoutEvictingAcceptedEvent() async throws {
        let requests = Requests()
        let reporter = TelemetryReporter(appKey: "test-app") { request in
            await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        await reporter.recordCheck("safe", variant: "enabled")
        await reporter.recordCheck(String(repeating: "x", count: 50_000), variant: "enabled")
        await reporter.incrementCounter("huge", value: 1_000_001)
        await reporter.flushTelemetry()
        let captured = await requests.requests
        XCTAssertEqual(captured.count, 1)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(captured[0].httpBody)) as? [String: Any])
        XCTAssertEqual((body["f"] as? [String: [String: [Int]]])?["safe"]?["enabled"], [1])
        XCTAssertNil(body["m"])
    }

    func testInvalidVariantsAreRejectedWithoutEvictingValidEntry() async throws {
        let requests = Requests()
        let diagnostics = Diagnostics()
        let reporter = TelemetryReporter(appKey: "test-app", onDiagnostic: { diagnostics.add($0) }) { request in
            await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        await reporter.recordUsage("experiment", variant: "blue_1")
        await reporter.recordUsage("experiment", variant: "blue/green")
        await reporter.recordView("experiment", variant: String(repeating: "x", count: 65))
        await reporter.flushTelemetry()
        let captured = await requests.requests
        XCTAssertEqual(captured.count, 1)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(captured[0].httpBody)) as? [String: Any])
        let variants = try XCTUnwrap((body["f"] as? [String: [String: [Int]]])?["experiment"])
        XCTAssertEqual(variants, ["blue_1": [0, 1]])
        XCTAssertEqual(diagnostics.snapshot(), ["telemetry_invalid_variant", "telemetry_invalid_variant"])
    }

    func testSeventeenthVariantMovesToNextEnvelope() async throws {
        let requests = Requests()
        let reporter = TelemetryReporter(appKey: "test-app") { request in
            await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        for number in 0..<17 { await reporter.recordCheck("experiment", variant: "variant-\(number)") }
        await reporter.flushTelemetry()
        let captured = await requests.requests
        XCTAssertEqual(captured.count, 2)
        for request in captured {
            XCTAssertLessThanOrEqual(try XCTUnwrap(request.httpBody).count, 49_152)
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: Any])
            let features = try XCTUnwrap(body["f"] as? [String: [String: [Int]]])
            XCTAssertLessThanOrEqual(try XCTUnwrap(features["experiment"]).count, 16)
        }
    }

    func testBufferRejectsEntryBeyondTwoThousandWithoutLosingAcceptedEntries() async throws {
        let requests = Requests()
        let reporter = TelemetryReporter(appKey: "test-app") { request in
            await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        for number in 0..<2_001 { await reporter.recordCheck("feature-\(number)", variant: "enabled") }
        await reporter.flushTelemetry()
        let captured = await requests.requests
        var total = 0
        for request in captured {
            let data = try XCTUnwrap(request.httpBody)
            XCTAssertLessThanOrEqual(data.count, 49_152)
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            let features = try XCTUnwrap(body["f"] as? [String: [String: [Int]]])
            total += features.values.reduce(0) { $0 + $1.count }
        }
        XCTAssertEqual(total, 2_000)
    }

    func testExplicitEventsProduceCompactPrivateEnvelope() async throws {
        let requests = Requests()
        let reporter = TelemetryReporter(
            appKey: "public-app", environment: "Staging",
            metricsBaseUrl: "https://metrics.example.test/prefix/",
            telemetryFlushIntervalMs: 45_000
        ) { request in
            await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }

        await reporter.recordCheck("checkout", variant: "enabled")
        await reporter.recordCheck("checkout", variant: "enabled")
        await reporter.recordUsage("checkout", variant: "enabled")
        await reporter.recordView("checkout", variant: "disabled")
        await reporter.incrementCounter("purchases", value: 3)
        await reporter.setGauge("cart_value", value: 12.5)
        await reporter.flushTelemetry()

        let captured = await requests.requests
        XCTAssertEqual(captured.count, 1)
        let request = try XCTUnwrap(captured.first)
        XCTAssertEqual(request.url?.absoluteString, "https://metrics.example.test/prefix/api/frontend/telemetry")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        XCTAssertNil(request.value(forHTTPHeaderField: "Origin"))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertEqual(Set(json.keys), Set(["k", "e", "f", "m"]))
        XCTAssertEqual(json["k"] as? String, "public-app")
        XCTAssertEqual(json["e"] as? String, "Staging")
        let features = try XCTUnwrap(json["f"] as? [String: [String: [Int]]])
        XCTAssertEqual(features["checkout"]?["enabled"], [2, 1])
        XCTAssertEqual(features["checkout"]?["disabled"], [0, 0, 1])
        let metrics = try XCTUnwrap(json["m"] as? [String: Double])
        XCTAssertEqual(metrics["purchases"], 3)
        XCTAssertEqual(metrics["cart_value"], 12.5)
    }

    func testInvalidEventsAndConflictingMetricKindsAreRejected() async throws {
        let requests = Requests()
        let reporter = TelemetryReporter(appKey: "public-app", environment: "Production") { request in
            await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        await reporter.recordCheck(" ", variant: "enabled")
        await reporter.incrementCounter("sales", value: -1)
        await reporter.incrementCounter("sales", value: 2)
        await reporter.setGauge("sales", value: 3)
        await reporter.setGauge("bad", value: .infinity)
        await reporter.flushTelemetry()
        let captured = await requests.requests
        XCTAssertEqual(captured.count, 1)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(captured[0].httpBody)) as? [String: Any])
        XCTAssertNil(json["f"])
        XCTAssertEqual((json["m"] as? [String: Int])?["sales"], 2)
    }
}
