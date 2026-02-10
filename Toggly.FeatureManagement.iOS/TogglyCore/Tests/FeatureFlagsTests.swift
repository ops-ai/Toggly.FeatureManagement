import XCTest
@testable import TogglyCore

final class FeatureFlagsTests: XCTestCase {
    func testFeatureRequirementAll() {
        XCTAssertEqual(FeatureRequirement.all.rawValue, "all")
    }

    func testFeatureRequirementAny() {
        XCTAssertEqual(FeatureRequirement.any.rawValue, "any")
    }

    func testTogglyLoadStatusFetched() {
        XCTAssertEqual(TogglyLoadStatus.fetched.rawValue, "fetched")
    }

    func testTogglyLoadStatusCached() {
        XCTAssertEqual(TogglyLoadStatus.cached.rawValue, "cached")
    }

    func testTogglyLoadStatusDefaults() {
        XCTAssertEqual(TogglyLoadStatus.defaults.rawValue, "defaults")
    }

    func testTogglyInitResponse() {
        let flags: FeatureFlags = ["feature1": true]
        let response = TogglyInitResponse(
            status: .fetched,
            flags: flags,
            error: nil
        )

        XCTAssertEqual(response.status, .fetched)
        XCTAssertEqual(response.flags, flags)
        XCTAssertNil(response.error)
    }

    func testTogglyInitResponseWithError() {
        let response = TogglyInitResponse(
            status: .defaults,
            flags: [:],
            error: "Network error"
        )

        XCTAssertEqual(response.status, .defaults)
        XCTAssertEqual(response.error, "Network error")
    }

    func testTogglyFeatureFlagsCache() {
        let cache = TogglyFeatureFlagsCache(
            identity: "user-123",
            flags: "{\"feature1\":true}"
        )

        XCTAssertEqual(cache.identity, "user-123")
        XCTAssertEqual(cache.flags, "{\"feature1\":true}")
    }

    func testTogglyFeatureFlagsCacheEncodeDecode() throws {
        let cache = TogglyFeatureFlagsCache(
            identity: "user-123",
            flags: "{\"feature1\":true}"
        )

        let data = try JSONEncoder().encode(cache)
        let decoded = try JSONDecoder().decode(TogglyFeatureFlagsCache.self, from: data)

        XCTAssertEqual(decoded.identity, cache.identity)
        XCTAssertEqual(decoded.flags, cache.flags)
    }
}
