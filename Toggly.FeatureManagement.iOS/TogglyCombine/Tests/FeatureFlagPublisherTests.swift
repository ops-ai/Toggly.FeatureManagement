import XCTest
import Combine
import TogglyCore
@testable import TogglyCombine

final class FeatureFlagPublisherTests: XCTestCase {
    var cancellables: Set<AnyCancellable>!

    override func setUp() {
        cancellables = []
    }

    override func tearDown() {
        cancellables = nil
        Toggly.reset()
    }

    func testFeatureFlagPublisherEmitsValue() async {
        let config = TogglyConfig(featureDefaults: ["test-feature": true])
        Toggly.configure(config: config)
        await Toggly.shared.initialize()

        let expectation = XCTestExpectation(description: "Publisher emits value")
        var receivedValue: Bool?

        FeatureFlagPublisher("test-feature")
            .sink { value in
                receivedValue = value
                expectation.fulfill()
            }
            .store(in: &cancellables)

        await fulfillment(of: [expectation], timeout: 1.0)

        XCTAssertEqual(receivedValue, true)
    }

    func testFeatureFlagPublisherWithDefaultValue() async {
        // No service configured
        let expectation = XCTestExpectation(description: "Publisher emits default")
        var receivedValue: Bool?

        FeatureFlagPublisher("nonexistent", defaultValue: true)
            .sink { value in
                receivedValue = value
                expectation.fulfill()
            }
            .store(in: &cancellables)

        await fulfillment(of: [expectation], timeout: 1.0)

        XCTAssertEqual(receivedValue, true)
    }

    func testFeatureGatePublisher() async {
        let config = TogglyConfig(featureDefaults: [
            "feature1": true,
            "feature2": true
        ])
        Toggly.configure(config: config)
        await Toggly.shared.initialize()

        let expectation = XCTestExpectation(description: "Gate publisher emits value")
        var receivedValue: Bool?

        FeatureGatePublisher(["feature1", "feature2"], requirement: .all)
            .sink { value in
                receivedValue = value
                expectation.fulfill()
            }
            .store(in: &cancellables)

        await fulfillment(of: [expectation], timeout: 1.0)

        XCTAssertEqual(receivedValue, true)
    }

    func testFeatureGatePublisherAny() async {
        let config = TogglyConfig(featureDefaults: [
            "feature1": true,
            "feature2": false
        ])
        Toggly.configure(config: config)
        await Toggly.shared.initialize()

        let expectation = XCTestExpectation(description: "Gate publisher emits value")
        var receivedValue: Bool?

        FeatureGatePublisher(["feature1", "feature2"], requirement: .any)
            .sink { value in
                receivedValue = value
                expectation.fulfill()
            }
            .store(in: &cancellables)

        await fulfillment(of: [expectation], timeout: 1.0)

        XCTAssertEqual(receivedValue, true)
    }

    func testTogglyPublishersConvenience() async {
        let config = TogglyConfig(featureDefaults: ["my-feature": true])
        Toggly.configure(config: config)
        await Toggly.shared.initialize()

        let expectation = XCTestExpectation(description: "Convenience publisher emits value")
        var receivedValue: Bool?

        TogglyPublishers.featureFlag("my-feature")
            .sink { value in
                receivedValue = value
                expectation.fulfill()
            }
            .store(in: &cancellables)

        await fulfillment(of: [expectation], timeout: 1.0)

        XCTAssertEqual(receivedValue, true)
    }
}
