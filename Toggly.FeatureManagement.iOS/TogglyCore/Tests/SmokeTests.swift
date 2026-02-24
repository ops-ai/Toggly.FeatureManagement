import Foundation
import XCTest
@testable import TogglyCore

final class SmokeTests: XCTestCase {
    func testLiveEvaluatedFlags() async throws {
        guard let appKey = ProcessInfo.processInfo.environment["TOGGLY_SMOKE_APP_KEY_FRONTEND"],
              !appKey.isEmpty else {
            throw XCTSkip("TOGGLY_SMOKE_APP_KEY_FRONTEND is not set")
        }

        let config = TogglyConfig(
            appKey: appKey,
            environment: "Production",
            baseURI: "https://definitions.toggly.io",
            refreshInterval: 0,
            useSignedDefinitions: true
        )

        let service = TogglyService(config: config)
        _ = await service.initialize()

        let isFlagOn = await service.isFeatureOn("FlagOn")
        let isFlagOff = await service.isFeatureOff("FlagOff")

        XCTAssertTrue(isFlagOn)
        XCTAssertTrue(isFlagOff)
    }

    func testWebSocketConnectsAndReceivesDefinitions() async throws {
        guard let appKey = ProcessInfo.processInfo.environment["TOGGLY_SMOKE_APP_KEY_FRONTEND"],
              !appKey.isEmpty else {
            throw XCTSkip("TOGGLY_SMOKE_APP_KEY_FRONTEND is not set")
        }

        let url = URL(string: "wss://definitions.toggly.io/\(appKey)/ws")!
        let session = URLSession(configuration: .default)
        let task = session.webSocketTask(with: url)
        task.resume()

        var foundDefinitions = false
        let deadline = Date().addingTimeInterval(15)

        while Date() < deadline {
            let message: URLSessionWebSocketTask.Message
            do {
                message = try await withThrowingTaskGroup(of: URLSessionWebSocketTask.Message.self) { group in
                    group.addTask {
                        try await task.receive()
                    }
                    group.addTask {
                        try await Task.sleep(nanoseconds: 15_000_000_000)
                        throw URLError(.timedOut)
                    }
                    let result = try await group.next()!
                    group.cancelAll()
                    return result
                }
            } catch {
                task.cancel(with: .goingAway, reason: nil)
                throw error
            }

            guard case .string(let text) = message else {
                continue
            }

            let data = Data(text.utf8)
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                continue
            }
            let type = json["type"] as? String
            if type == "ping" {
                continue
            }
            XCTAssertTrue(type == "definitions" || type == "evaluated",
                           "Expected type to be 'definitions' or 'evaluated', got '\(type ?? "nil")'")
            XCTAssertNotNil(json["timestamp"], "Expected 'timestamp' field in message")
            foundDefinitions = true
            break
        }

        task.cancel(with: .goingAway, reason: nil)
        XCTAssertTrue(foundDefinitions, "Never received a definitions/evaluated message")
    }
}
