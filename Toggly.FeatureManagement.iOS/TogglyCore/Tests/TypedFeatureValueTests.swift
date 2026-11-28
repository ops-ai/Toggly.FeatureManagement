import XCTest
@testable import TogglyCore

private final class TypedFeatureValueURLProtocol: URLProtocol {
    static var responseBody = "{}"

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "typed-values.invalid"
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

/// Covers the typed flag getters (`getStringValue` / `getNumberValue` /
/// `getJsonValue` / `getDateTimeValue`) added for OPS-2102 / OPS-2107:
/// soft-null semantics driven by the assigned variant's `valueType`.
final class TypedFeatureValueTests: XCTestCase {
    override func setUp() {
        super.setUp()
        TypedFeatureValueURLProtocol.responseBody = "{}"
        URLProtocol.registerClass(TypedFeatureValueURLProtocol.self)
    }
    override func tearDown() {
        URLProtocol.unregisterClass(TypedFeatureValueURLProtocol.self)
        super.tearDown()
    }

    private func makeService(responseBody: String) -> TogglyService {
        TypedFeatureValueURLProtocol.responseBody = responseBody
        return TogglyService(config: TogglyConfig(
            appKey: "app",
            baseURI: "https://typed-values.invalid",
            identity: "alice",
            refreshInterval: 0,
            enableVariants: true,
            enableLiveUpdates: false,
            enableTelemetry: false
        ))
    }

    private struct Checkout: Decodable, Equatable {
        let color: String
    }

    func testGetStringValueReturnsTypedString() async {
        let service = makeService(responseBody: """
        {"stringFlag": {"enabled": true, "variant": "default", "valueType": "string", "configurationValue": "hello"}}
        """)
        await service.initialize()
        let value = await service.getStringValue("stringFlag")
        XCTAssertEqual(value, "hello")
        await service.dispose()
    }

    func testGetStringValueSoftNullsNumberTypedFlag() async {
        let service = makeService(responseBody: """
        {"numberFlag": {"enabled": true, "variant": "default", "valueType": "number", "configurationValue": 42}}
        """)
        await service.initialize()
        let value = await service.getStringValue("numberFlag")
        XCTAssertNil(value)
        await service.dispose()
    }

    func testGetNumberValueReturnsTypedNumber() async {
        let service = makeService(responseBody: """
        {"numberFlag": {"enabled": true, "variant": "default", "valueType": "number", "configurationValue": 42}}
        """)
        await service.initialize()
        let value = await service.getNumberValue("numberFlag")
        XCTAssertEqual(value, 42)
        await service.dispose()
    }

    func testGetNumberValueSoftNullsWhenDeclaredTypeDisagrees() async {
        let service = makeService(responseBody: """
        {"mismatch": {"enabled": true, "variant": "default", "valueType": "number", "configurationValue": "not-a-number-type"}}
        """)
        await service.initialize()
        let value = await service.getNumberValue("mismatch")
        XCTAssertNil(value)
        await service.dispose()
    }

    func testGetJsonValueReturnsUntypedPayload() async {
        let service = makeService(responseBody: """
        {"jsonFlag": {"enabled": true, "variant": "default", "valueType": "json", "configurationValue": {"color": "blue"}}}
        """)
        await service.initialize()
        let value = await service.getJsonValue("jsonFlag")
        XCTAssertEqual((value as? [String: String])?["color"], "blue")
        await service.dispose()
    }

    func testGetJsonValueDecodesTyped() async {
        let service = makeService(responseBody: """
        {"jsonFlag": {"enabled": true, "variant": "default", "valueType": "json", "configurationValue": {"color": "blue"}}}
        """)
        await service.initialize()
        let typed: Checkout? = await service.getJsonValue("jsonFlag")
        XCTAssertEqual(typed, Checkout(color: "blue"))
        await service.dispose()
    }

    func testGetDateTimeValueParsesIso8601WireString() async {
        let service = makeService(responseBody: """
        {"dateFlag": {"enabled": true, "variant": "default", "valueType": "datetime", "configurationValue": "2026-01-15T10:00:00Z"}}
        """)
        await service.initialize()
        let value = await service.getDateTimeValue("dateFlag")
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        XCTAssertEqual(value, formatter.date(from: "2026-01-15T10:00:00Z"))
        await service.dispose()
    }

    func testGetDateTimeValueSoftNullsStringTypedFlag() async {
        let service = makeService(responseBody: """
        {"stringFlag": {"enabled": true, "variant": "default", "valueType": "string", "configurationValue": "hello"}}
        """)
        await service.initialize()
        let value = await service.getDateTimeValue("stringFlag")
        XCTAssertNil(value)
        await service.dispose()
    }

    func testTypedGettersSoftNullWhenDisabled() async {
        let service = makeService(responseBody: """
        {"stringFlag": {"enabled": false, "variant": "default", "valueType": "string", "configurationValue": "hidden"}}
        """)
        await service.initialize()
        let value = await service.getStringValue("stringFlag")
        XCTAssertNil(value)
        await service.dispose()
    }

    func testTypedGettersSoftNullForUnknownFeature() async {
        let service = makeService(responseBody: "{}")
        await service.initialize()
        let stringValue = await service.getStringValue("missing")
        let numberValue = await service.getNumberValue("missing")
        let jsonValue = await service.getJsonValue("missing")
        let dateValue = await service.getDateTimeValue("missing")
        XCTAssertNil(stringValue)
        XCTAssertNil(numberValue)
        XCTAssertNil(jsonValue)
        XCTAssertNil(dateValue)
        await service.dispose()
    }

    func testTypedGettersAttemptDecodeWhenNoValueTypeDeclared() async {
        let service = makeService(responseBody: """
        {"legacyFlag": {"enabled": true, "variant": "default", "configurationValue": "no-declared-type"}}
        """)
        await service.initialize()
        let value = await service.getStringValue("legacyFlag")
        XCTAssertEqual(value, "no-declared-type")
        await service.dispose()
    }
}
