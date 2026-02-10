#if canImport(UIKit)
import XCTest
import TogglyCore
@testable import TogglyUIKit

final class FeatureFlagAsyncTests: XCTestCase {
    var service: TogglyService!

    override func setUp() async throws {
        let config = TogglyConfig(featureDefaults: [
            "enabled-feature": true,
            "disabled-feature": false
        ])
        service = TogglyService(config: config)
        await service.initialize()

        Toggly.configure(config: config)
        await Toggly.shared.initialize()
    }

    override func tearDown() {
        Toggly.reset()
    }

    func testIsEnabled() async {
        let enabled = await FeatureFlagAsync.isEnabled("enabled-feature", service: service)
        let disabled = await FeatureFlagAsync.isEnabled("disabled-feature", service: service)

        XCTAssertTrue(enabled)
        XCTAssertFalse(disabled)
    }

    func testIsDisabled() async {
        let enabled = await FeatureFlagAsync.isDisabled("enabled-feature", service: service)
        let disabled = await FeatureFlagAsync.isDisabled("disabled-feature", service: service)

        XCTAssertFalse(enabled)
        XCTAssertTrue(disabled)
    }

    func testEvaluateAll() async {
        let allEnabled = await FeatureFlagAsync.evaluate(
            ["enabled-feature"],
            requirement: .all,
            service: service
        )
        let notAllEnabled = await FeatureFlagAsync.evaluate(
            ["enabled-feature", "disabled-feature"],
            requirement: .all,
            service: service
        )

        XCTAssertTrue(allEnabled)
        XCTAssertFalse(notAllEnabled)
    }

    func testEvaluateAny() async {
        let anyEnabled = await FeatureFlagAsync.evaluate(
            ["enabled-feature", "disabled-feature"],
            requirement: .any,
            service: service
        )
        let noneEnabled = await FeatureFlagAsync.evaluate(
            ["disabled-feature"],
            requirement: .any,
            service: service
        )

        XCTAssertTrue(anyEnabled)
        XCTAssertFalse(noneEnabled)
    }

    func testIfEnabled() async {
        var executed = false

        await FeatureFlagAsync.ifEnabled("enabled-feature", service: service) {
            executed = true
        }

        XCTAssertTrue(executed)
    }

    func testIfEnabledNotExecuted() async {
        var executed = false

        await FeatureFlagAsync.ifEnabled("disabled-feature", service: service) {
            executed = true
        }

        XCTAssertFalse(executed)
    }

    func testIfDisabled() async {
        var executed = false

        await FeatureFlagAsync.ifDisabled("disabled-feature", service: service) {
            executed = true
        }

        XCTAssertTrue(executed)
    }

    func testChoose() async {
        let result = await FeatureFlagAsync.choose(
            "enabled-feature",
            service: service,
            enabled: { "enabled" },
            disabled: { "disabled" }
        )

        XCTAssertEqual(result, "enabled")
    }

    func testChooseDisabled() async {
        let result = await FeatureFlagAsync.choose(
            "disabled-feature",
            service: service,
            enabled: { "enabled" },
            disabled: { "disabled" }
        )

        XCTAssertEqual(result, "disabled")
    }
}
#endif
