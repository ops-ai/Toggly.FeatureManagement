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
            useSignedDefinitions: true,
            refreshInterval: 0
        )

        let service = TogglyService(config: config)
        _ = await service.initialize()

        let isFlagOn = await service.isFeatureOn("FlagOn")
        let isFlagOff = await service.isFeatureOff("FlagOff")

        XCTAssertTrue(isFlagOn)
        XCTAssertTrue(isFlagOff)
    }
}
