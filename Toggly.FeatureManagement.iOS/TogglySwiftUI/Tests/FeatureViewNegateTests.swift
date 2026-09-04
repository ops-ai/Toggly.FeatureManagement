import SwiftUI
import XCTest
import TogglyCore
@testable import TogglySwiftUI

@MainActor
final class FeatureViewNegateTests: XCTestCase {
    override func tearDown() {
        Toggly.reset()
    }

    private func makeService(defaults: [String: Bool]) async -> TogglyService {
        let config = TogglyConfig(featureDefaults: defaults)
        let service = TogglyService(config: config)
        await service.initialize()
        return service
    }

    func testFeatureViewSingleNegateInit() async {
        let service = await makeService(defaults: ["maintenance": false])

        let view = FeatureView("maintenance", negate: true, service: service) {
            Text("off-path")
        }

        // Retain and force body evaluation so init + gate wiring are covered.
        _ = view.body
        try? await Task.sleep(nanoseconds: 200_000_000)
        _ = view.body
    }

    func testFeatureViewDualSlotInit() async {
        let service = await makeService(defaults: ["new-ui": true])

        let view = FeatureView("new-ui", service: service) {
            Text("enabled")
        } else: {
            Text("disabled")
        }

        _ = view.body
        try? await Task.sleep(nanoseconds: 200_000_000)
        _ = view.body
    }

    func testFeatureGateViewSingleNegateInit() async {
        let service = await makeService(defaults: ["a": true, "b": false])

        let view = FeatureGateView(
            ["a", "b"],
            requirement: .all,
            negate: true,
            service: service
        ) {
            Text("gate-off-path")
        }

        _ = view.body
        try? await Task.sleep(nanoseconds: 200_000_000)
        _ = view.body
    }

    func testFeatureGateViewDualSlotInit() async {
        let service = await makeService(defaults: ["a": true, "b": true])

        let view = FeatureGateView(
            ["a", "b"],
            requirement: .all,
            negate: false,
            service: service
        ) {
            Text("enabled")
        } else: {
            Text("disabled")
        }

        _ = view.body
        try? await Task.sleep(nanoseconds: 200_000_000)
        _ = view.body
    }

    func testFeatureFlagViewModifierNegate() async {
        let service = await makeService(defaults: ["legacy": false])

        let modified = Text("content").featureFlag(
            "legacy",
            negate: true,
            service: service
        )
        _ = modified

        // Direct modifier init (internal) for coverage of FeatureFlag wiring.
        let modifier = FeatureFlagViewModifier(
            key: "legacy",
            negate: true,
            service: service
        )
        _ = modifier
        try? await Task.sleep(nanoseconds: 200_000_000)
    }

    func testFeatureFlagOffDeprecatedExtension() async {
        let service = await makeService(defaults: ["new-checkout": false])

        let modified = Text("legacy-banner").featureFlagOff(
            "new-checkout",
            service: service
        )
        _ = modified
        try? await Task.sleep(nanoseconds: 200_000_000)
    }

    func testFeatureFlagSwapExtension() async {
        let service = await makeService(defaults: ["new-pricing": true])

        let modified = Text("new").featureFlag("new-pricing", service: service) {
            Text("old")
        }
        _ = modified
        try? await Task.sleep(nanoseconds: 200_000_000)
    }

    func testFeatureFlagPropertyWrapperInitWithNegate() async {
        let service = await makeService(defaults: ["beta": false])

        // Constructing FeatureFlag covers the property-wrapper init path used by modifiers.
        let flag = FeatureFlag("beta", defaultValue: false, negate: true, service: service)
        _ = flag.wrappedValue
        try? await Task.sleep(nanoseconds: 200_000_000)
        _ = flag.wrappedValue
        _ = flag.projectedValue.wrappedValue
    }

    func testFeatureGatePropertyWrapperInitWithNegate() async {
        let service = await makeService(defaults: ["x": true])

        let gate = FeatureGate(["x"], requirement: .all, negate: true, service: service)
        _ = gate.wrappedValue
        try? await Task.sleep(nanoseconds: 200_000_000)
        _ = gate.wrappedValue
    }

    func testObserverNegateWithoutServiceUsesDefault() async {
        let observer = FeatureFlagObserver(
            key: "missing",
            defaultValue: false,
            negate: true,
            service: nil
        )

        try? await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertTrue(observer.isEnabled)
    }

    func testGateObserverNegateWithoutService() async {
        let observer = FeatureGateObserver(
            keys: ["missing"],
            requirement: .all,
            negate: true,
            service: nil
        )

        try? await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertTrue(observer.isEnabled)
    }
}
