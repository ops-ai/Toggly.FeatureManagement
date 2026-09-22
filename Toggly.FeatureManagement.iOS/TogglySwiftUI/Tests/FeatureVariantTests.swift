import SwiftUI
import XCTest
import TogglyCore
@testable import TogglySwiftUI

private final class FeatureVariantURLProtocol: URLProtocol {
    static var responseBody = "{}"

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "feature-variant-tests.invalid"
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        client?.urlProtocol(
            self,
            didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
            cacheStoragePolicy: .notAllowed
        )
        client?.urlProtocol(self, didLoad: Data(Self.responseBody.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor
final class FeatureVariantTests: XCTestCase {
    override class func setUp() {
        super.setUp()
        URLProtocol.registerClass(FeatureVariantURLProtocol.self)
    }

    override class func tearDown() {
        URLProtocol.unregisterClass(FeatureVariantURLProtocol.self)
        super.tearDown()
    }

    override func tearDown() {
        Toggly.reset()
    }

    private func makeVariantsService(responseBody: String) async -> TogglyService {
        FeatureVariantURLProtocol.responseBody = responseBody
        let service = TogglyService(config: TogglyConfig(
            appKey: "app",
            baseURI: "https://feature-variant-tests.invalid",
            identity: "alice",
            refreshInterval: 0,
            enableVariants: true,
            enableLiveUpdates: false,
            enableTelemetry: false
        ))
        await service.initialize()
        return service
    }

    func testObserverReflectsAssignedVariant() async {
        let service = await makeVariantsService(responseBody: """
        {"checkout": {"enabled": true, "variant": "Treatment", "configurationValue": {"color": "blue"}}}
        """)

        let observer = FeatureVariantObserver(key: "checkout", service: service)
        try? await Task.sleep(nanoseconds: 200_000_000)

        XCTAssertEqual(observer.variant?.name, "Treatment")
        XCTAssertEqual((observer.variant?.configurationValue as? [String: String])?["color"], "blue")
        await service.dispose()
    }

    /// The observer piggybacks on the boolean state-change handler (see
    /// `FeatureVariant.swift`), matching the rest of the SDK's reactive design
    /// (`FeatureFlagPublisher`, `FeatureGatePublisher`). A reassignment only
    /// propagates reactively when the feature's effective `enabled` value also
    /// flips; callers needing to react to same-enabled-state reassignments
    /// should call `getVariant` explicitly (e.g. on `identityChanged`).
    func testObserverUpdatesWhenEnabledFlagFlips() async {
        let service = await makeVariantsService(responseBody: """
        {"checkout": {"enabled": false, "variant": "Control"}}
        """)

        let observer = FeatureVariantObserver(key: "checkout", service: service)
        try? await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertNil(observer.variant)

        FeatureVariantURLProtocol.responseBody = """
        {"checkout": {"enabled": true, "variant": "Treatment"}}
        """
        await service.setIdentity("bob")
        try? await Task.sleep(nanoseconds: 200_000_000)

        XCTAssertEqual(observer.variant?.name, "Treatment")
        await service.dispose()
    }

    func testObserverReturnsNilWhenVariantsDisabled() async {
        let service = TogglyService(config: TogglyConfig(
            appKey: "app",
            baseURI: "https://feature-variant-tests.invalid",
            identity: "alice",
            refreshInterval: 0,
            enableVariants: false,
            enableLiveUpdates: false,
            enableTelemetry: false
        ))
        FeatureVariantURLProtocol.responseBody = """
        {"checkout": true}
        """
        await service.initialize()

        let observer = FeatureVariantObserver(key: "checkout", service: service)
        try? await Task.sleep(nanoseconds: 200_000_000)

        XCTAssertNil(observer.variant)
        await service.dispose()
    }

    func testObserverWithoutServiceReturnsNil() async {
        let observer = FeatureVariantObserver(key: "missing", service: nil)
        try? await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertNil(observer.variant)
    }

    func testPropertyWrapperExposesWrappedValue() async {
        let service = await makeVariantsService(responseBody: """
        {"checkout": {"enabled": true, "variant": "Treatment"}}
        """)

        // StateObject storage requires a hosting View to persist across
        // accesses; outside a View, each access constructs a fresh observer
        // (see the runtime warning). This exercises the wrapper's init and
        // wrappedValue accessor for coverage, matching `FeatureFlag`'s own
        // property-wrapper coverage test.
        let variant = FeatureVariant("checkout", service: service)
        _ = variant.wrappedValue
        try? await Task.sleep(nanoseconds: 200_000_000)
        _ = variant.wrappedValue
        await service.dispose()
    }
}
