import XCTest
@testable import TogglyCore

final class TogglySharedTests: XCTestCase {
    override func tearDown() {
        Toggly.reset()
    }

    func testConfigureCreatesSharedInstance() {
        let config = TogglyConfig(appKey: "test-key")
        Toggly.configure(config: config)

        XCTAssertTrue(Toggly.isConfigured)
    }

    func testResetClearsSharedInstance() {
        Toggly.configure(config: TogglyConfig())
        Toggly.reset()

        XCTAssertFalse(Toggly.isConfigured)
    }

    func testIsConfiguredFalseByDefault() {
        XCTAssertFalse(Toggly.isConfigured)
    }

    func testSharedReturnsConfiguredInstance() async {
        let config = TogglyConfig(
            identity: "test-user",
            featureDefaults: ["feature1": true]
        )
        Toggly.configure(config: config)

        await Toggly.shared.initialize()

        let isOn = await Toggly.shared.isFeatureOn("feature1")
        XCTAssertTrue(isOn)
    }
}
