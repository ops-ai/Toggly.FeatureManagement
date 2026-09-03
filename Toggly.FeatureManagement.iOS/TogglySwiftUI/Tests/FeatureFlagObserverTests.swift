import XCTest
import TogglyCore
@testable import TogglySwiftUI

@MainActor
final class FeatureFlagObserverTests: XCTestCase {
    override func tearDown() {
        Toggly.reset()
    }

    func testObserverWithDefaultValue() async {
        let observer = FeatureFlagObserver(
            key: "test-feature",
            defaultValue: true,
            service: nil
        )

        // Without a configured service, should use default
        // Give it a moment to set up
        try? await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertTrue(observer.isEnabled)
    }

    func testObserverWithService() async {
        let config = TogglyConfig(featureDefaults: ["my-feature": true])
        let service = TogglyService(config: config)
        await service.initialize()

        let observer = FeatureFlagObserver(
            key: "my-feature",
            defaultValue: false,
            service: service
        )

        // Give it a moment to set up
        try? await Task.sleep(nanoseconds: 200_000_000)

        XCTAssertTrue(observer.isEnabled)
    }

    func testObserverWithDisabledFeature() async {
        let config = TogglyConfig(featureDefaults: ["my-feature": false])
        let service = TogglyService(config: config)
        await service.initialize()

        let observer = FeatureFlagObserver(
            key: "my-feature",
            defaultValue: true,
            service: service
        )

        // Give it a moment to set up
        try? await Task.sleep(nanoseconds: 200_000_000)

        XCTAssertFalse(observer.isEnabled)
    }

    func testObserverNegateShowsWhenDisabled() async {
        let config = TogglyConfig(featureDefaults: ["maintenance": false])
        let service = TogglyService(config: config)
        await service.initialize()

        let observer = FeatureFlagObserver(
            key: "maintenance",
            defaultValue: false,
            negate: true,
            service: service
        )

        try? await Task.sleep(nanoseconds: 200_000_000)

        XCTAssertTrue(observer.isEnabled)
    }

    func testGateObserverNegateInverts() async {
        let config = TogglyConfig(featureDefaults: ["f1": true])
        let service = TogglyService(config: config)
        await service.initialize()

        let observer = FeatureGateObserver(
            keys: ["f1"],
            requirement: .all,
            negate: true,
            service: service
        )

        try? await Task.sleep(nanoseconds: 200_000_000)

        XCTAssertFalse(observer.isEnabled)
    }
}
