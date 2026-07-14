import XCTest
@testable import TogglyCore

final class TogglyConfigTests: XCTestCase {
    func testDefaultConfiguration() {
        let config = TogglyConfig()

        XCTAssertNil(config.appKey)
        XCTAssertEqual(config.environment, "Production")
        XCTAssertEqual(config.baseURI, "https://definitions.toggly.io")
        XCTAssertNil(config.identity)
        XCTAssertTrue(config.featureDefaults.isEmpty)
        XCTAssertFalse(config.showFeatureDuringEvaluation)
        XCTAssertEqual(config.refreshInterval, 180)
        XCTAssertFalse(config.useSignedDefinitions)
        XCTAssertFalse(config.verifySignatures)
        XCTAssertEqual(config.connectTimeout, 10)
        XCTAssertEqual(config.requestTimeout, 30)
        XCTAssertNil(config.storage)
    }

    func testCustomConfiguration() {
        let defaults: FeatureFlags = ["feature1": true, "feature2": false]
        let config = TogglyConfig(
            appKey: "test-app-key",
            environment: "Staging",
            baseURI: "https://custom.toggly.io",
            identity: "user-123",
            featureDefaults: defaults,
            showFeatureDuringEvaluation: true,
            refreshInterval: 60,
            useSignedDefinitions: true,
            connectTimeout: 5,
            requestTimeout: 15
        )

        XCTAssertEqual(config.appKey, "test-app-key")
        XCTAssertEqual(config.environment, "Staging")
        XCTAssertEqual(config.baseURI, "https://custom.toggly.io")
        XCTAssertEqual(config.identity, "user-123")
        XCTAssertEqual(config.featureDefaults, defaults)
        XCTAssertTrue(config.showFeatureDuringEvaluation)
        XCTAssertEqual(config.refreshInterval, 60)
        XCTAssertTrue(config.useSignedDefinitions)
        XCTAssertEqual(config.connectTimeout, 5)
        XCTAssertEqual(config.requestTimeout, 15)
    }
}
