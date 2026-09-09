import XCTest
import CryptoKit
@testable import TogglyCore
private final class IdentitySwitchProtocol: URLProtocol {
    static var pending: IdentitySwitchProtocol?
    static var started: XCTestExpectation?
    static var fail = false
    static var requests: [URLRequest] = []
    static var failOld = false
    static var signedBodies: (old: Data, new: Data, jwks: Data)?
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "identity-switch.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.append(request)
        if request.url!.path.hasSuffix("jwks"), let signedBodies = Self.signedBodies {
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: signedBodies.jwks)
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        if request.url!.query!.contains("u=new") && !Self.fail {
            finish(newUser: true)
            return
        }
        if Self.fail { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)); return }
        Self.pending = self
        Self.started?.fulfill()
    }
    func finish(newUser: Bool = false) {
        if Self.failOld && !newUser {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["ETag": newUser ? "new-user-revision" : "old-user-revision"])!, cacheStoragePolicy: .notAllowed)
        let body = Self.signedBodies.map { newUser ? $0.new : $0.old }
            ?? Data((newUser ? "{\"oldUserOnly\":false}" : "{\"oldUserOnly\":true}").utf8)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
private actor SuspendingContextStorage: TogglyStorage {
    private var values: [String: String] = [:]
    private let prefix: String?
    private let paused: XCTestExpectation?
    private var continuation: CheckedContinuation<Void, Never>?
    private var didPause = false
    init(prefix: String?, paused: XCTestExpectation?) { self.prefix = prefix; self.paused = paused }
    func get(_ key: String) -> String? { values[key] }
    func set(_ key: String, value: String) async {
        if let prefix, key.hasPrefix(prefix), !didPause {
            didPause = true
            await withCheckedContinuation { continuation in
                self.continuation = continuation
                paused?.fulfill()
            }
        }
        values[key] = value
    }
    func resume() { continuation?.resume(); continuation = nil }
    func delete(_ key: String) { values.removeValue(forKey: key) }
    func clear() { values.removeAll() }
}

final class IdentitySwitchTests: XCTestCase {
    func testIdentitySwitchDoesNotCacheInflightOldUserResponseUnderNewContext() async throws {
        IdentitySwitchProtocol.failOld = false
        try await checkSwitch()
    }
    func testFailedObsoleteRequestStillFetchesNewIdentity() async throws {
        IdentitySwitchProtocol.failOld = true
        try await checkSwitch()
    }
    func testIdentitySwitchDuringCacheWriteDoesNotApplyObsoleteFlags() async throws {
        IdentitySwitchProtocol.failOld = false
        try await checkSwitch(suspendedPrefix: TogglyStorageKeys.featureFlagsCache)
    }
    func testIdentitySwitchDuringRevisionWriteDoesNotApplyObsoleteValidator() async throws {
        IdentitySwitchProtocol.failOld = false
        try await checkSwitch(suspendedPrefix: TogglyStorageKeys.etag)
    }
    func testIdentitySwitchDuringJwksStorageRejectsVerifiedOldResponse() async throws {
        IdentitySwitchProtocol.failOld = false
        try await checkSwitch(suspendedPrefix: TogglyStorageKeys.jwks)
    }
    private func checkSwitch(suspendedPrefix: String? = nil) async throws {
        URLProtocol.registerClass(IdentitySwitchProtocol.self)
        defer { URLProtocol.unregisterClass(IdentitySwitchProtocol.self) }
        IdentitySwitchProtocol.fail = false
        IdentitySwitchProtocol.requests = []
        let verify = suspendedPrefix == TogglyStorageKeys.jwks
        IdentitySwitchProtocol.signedBodies = verify ? try signedBodies() : nil
        let paused = suspendedPrefix == nil ? nil : expectation(description: "storage write paused")
        let storage = SuspendingContextStorage(prefix: suspendedPrefix, paused: paused)
        let config = TogglyConfig(appKey:"app", baseURI:"https://identity-switch.invalid", identity:"old", featureDefaults:["oldUserOnly":false], refreshInterval:0, useSignedDefinitions:true, verifySignatures:verify, storage:storage, enableLiveUpdates:false, groups:["beta"], claims:["plan":"pro"])
        let service = TogglyService(config:config)
        let started = expectation(description:"old request started")
        IdentitySwitchProtocol.started = started
        let initial = Task { await service.initialize() }
        await fulfillment(of:[started], timeout:2)
        if let paused {
            IdentitySwitchProtocol.pending!.finish()
            await fulfillment(of: [paused], timeout: 2)
        }
        let switched = expectation(description:"identity changed")
        let unsubscribe = await service.on { event in
            if case .identityChanged = event { switched.fulfill() }
        }
        let change = Task { await service.setIdentity("new") }
        await fulfillment(of:[switched], timeout:2)
        if suspendedPrefix == nil { IdentitySwitchProtocol.pending!.finish() }
        else { await storage.resume() }
        _ = await initial.value
        let response = await change.value
        XCTAssertEqual(response.flags["oldUserOnly"], false, "New identity must not receive old identity's in-flight flags")
        XCTAssertEqual(IdentitySwitchProtocol.requests.filter { $0.url!.path.contains("evaluated-signed") }.count, 2)
        XCTAssertNil(IdentitySwitchProtocol.requests.last?.value(forHTTPHeaderField: "If-None-Match"))
        let current = await service.currentFeatures
        XCTAssertEqual(current?["oldUserOnly"], false)
        await service.refresh()
        XCTAssertEqual(IdentitySwitchProtocol.requests.last?.value(forHTTPHeaderField: "If-None-Match"), "new-user-revision")
        unsubscribe()
        await service.dispose()
        IdentitySwitchProtocol.fail = true
        let next = TogglyService(config:TogglyConfig(appKey:"app", baseURI:"https://identity-switch.invalid", identity:"new", featureDefaults:["oldUserOnly":false], refreshInterval:0, useSignedDefinitions:true, verifySignatures:verify, storage:storage, enableLiveUpdates:false, groups:["beta"], claims:["plan":"pro"]))
        let cached = await next.initialize()
        XCTAssertEqual(cached.flags["oldUserOnly"], false, "Old identity result must not poison new full-context cache")
        await next.dispose()
    }
    private func signedBodies() throws -> (old: Data, new: Data, jwks: Data) {
        let key = P256.Signing.PrivateKey()
        let bytes = key.publicKey.x963Representation
        let x = SignedDefsVerify.base64URLEncode(bytes.subdata(in: 1..<33))
        let y = SignedDefsVerify.base64URLEncode(bytes.subdata(in: 33..<65))
        let kid = try SignedDefsVerify.computeKid(x: x, y: y)
        let timestamp = Int64(Date().timeIntervalSince1970)
        func body(_ enabled: Bool) throws -> Data {
            let defs = "{\"oldUserOnly\":\(enabled)}"
            let digest = SHA256.hash(data: Data(SHA256.hash(data: Data("\(defs)|\(timestamp)".utf8))))
            let signature = try key.signature(for: digest).rawRepresentation.base64EncodedString()
            return Data("{\"defs\":\(defs),\"timestamp\":\(timestamp),\"signature\":\"\(signature)\",\"kid\":\"\(kid)\"}".utf8)
        }
        return (try body(true), try body(false), try JSONEncoder().encode(JwkSet(keys: [Jwk(kid: kid, x: x, y: y)])))
    }

}
