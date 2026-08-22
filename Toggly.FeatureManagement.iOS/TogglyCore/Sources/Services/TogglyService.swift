import Foundation

/// Core Toggly service for feature flag management.
/// Thread-safe actor that handles feature flag evaluation, caching, and lifecycle management.
public actor TogglyService {
    // MARK: - Configuration

    private let config: TogglyConfig
    private let storage: TogglyStorage

    // MARK: - State

    private var definitions: EvaluatedDefinitions?
    private var features: FeatureFlags?
    private var featuresLoading = false
    private var identity: String?
    private var refreshTask: Task<Void, Never>?
    private var lastChecked: Date?
    private var lastSynced: Date?
    private var lastError: String?
    private var eTag: String?
    private var isInitialized = false
    private var networkState: NetworkState?
    private var appState: AppStateType = .active

    // MARK: - WebSocket

    private var webSocketTask: URLSessionWebSocketTask?
    private var wsConnected = false
    private var lastFallbackRefresh: Date = .distantPast
    private let fallbackRefreshInterval: TimeInterval = 20 * 60
    private let wsReconnectDelay: TimeInterval = 5
    private var wsListenTask: Task<Void, Never>?

    // MARK: - JWKS

    private var inMemoryJwks: JwkSet?

    // MARK: - Event Handling

    private var eventListeners: [UUID: TogglyEventListener] = [:]
    private var stateChangeHandlers: [UUID: FeatureStateChangeHandler] = [:]

    // MARK: - Computed Properties

    /// Whether to show feature content during initial evaluation.
    public var shouldShowFeatureDuringEvaluation: Bool {
        config.showFeatureDuringEvaluation
    }

    /// Whether the SDK has been initialized.
    public var initialized: Bool {
        isInitialized
    }

    /// Current user identity.
    public var currentIdentity: String? {
        identity
    }

    /// Current feature flags (may be nil if not loaded).
    public var currentFeatures: FeatureFlags? {
        features
    }

    // MARK: - Initialization

    /// Creates a new Toggly service with the given configuration.
    /// - Parameter config: The configuration for the service.
    public init(config: TogglyConfig = TogglyConfig()) {
        self.config = config
        self.storage = config.storage ?? MemoryStorage()
    }

    // MARK: - Lifecycle

    /// Initialize Toggly and load feature flags.
    /// - Returns: The initialization response.
    @discardableResult
    public func initialize() async -> TogglyInitResponse {
        // Handle identity
        if let configIdentity = config.identity {
            identity = configIdentity
        } else {
            // Try to get stored device ID
            var storedId = await storage.get(TogglyStorageKeys.deviceId)
            if storedId == nil {
                storedId = UUID().uuidString
                await storage.set(TogglyStorageKeys.deviceId, value: storedId!)
            }
            identity = storedId
        }

        // Start refresh timer
        startRefreshTimer()

        // Perform initial refresh
        let response = await refresh()

        // Start WebSocket for live updates after successful first refresh
        if config.enableLiveUpdates && response.status != .defaults {
            startWebSocket()
        }

        isInitialized = true
        emitEvent(.initialized(response))

        return response
    }

    /// Refresh feature flags from the server or cache.
    /// - Returns: The refresh response.
    @discardableResult
    public func refresh() async -> TogglyInitResponse {
        // Skip refresh if app is not in foreground
        guard appState == .active else {
            return TogglyInitResponse(
                status: .cached,
                flags: features ?? config.featureDefaults
            )
        }

        // Skip refresh if offline
        if networkState?.isConnected == false {
            let cached = await loadCachedDefinitions()
            applySnapshot(cached.definitions, flags: cached.flags)
            return TogglyInitResponse(status: .cached, flags: cached.flags)
        }

        // If no app key, use defaults
        guard config.appKey != nil else {
            applySnapshot(fromBooleanDefaults(config.featureDefaults), flags: config.featureDefaults)
            return TogglyInitResponse(status: .defaults, flags: features ?? [:])
        }

        // Fetch from server
        return await fetchFeatureFlags()
    }

    /// Dispose the service and clean up resources.
    public func dispose() {
        stopWebSocket()
        stopRefreshTimer()
        eventListeners.removeAll()
        stateChangeHandlers.removeAll()
        features = nil
        definitions = nil
        inMemoryJwks = nil
        isInitialized = false
    }

    // MARK: - Feature Evaluation

    /// Check if a feature is enabled.
    /// - Parameter featureKey: The feature key to check.
    /// - Returns: Whether the feature is enabled.
    public func isFeatureOn(_ featureKey: String) async -> Bool {
        await isEnabled(featureKey)
    }

    /// Check if a feature is enabled against an optional per-evaluation entity context.
    public func isEnabled(
        _ featureKey: String,
        context: Any? = nil,
        kind: String? = nil
    ) async -> Bool {
        await evaluateFeatureGate(
            featureKeys: [featureKey],
            requirement: .all,
            negate: false,
            context: context,
            kind: kind
        )
    }

    /// Check if a feature is disabled.
    /// - Parameter featureKey: The feature key to check.
    /// - Returns: Whether the feature is disabled.
    public func isFeatureOff(_ featureKey: String) async -> Bool {
        await evaluateFeatureGate(featureKeys: [featureKey], requirement: .all, negate: true)
    }

    /// Evaluate a feature gate with multiple feature keys.
    /// - Parameters:
    ///   - featureKeys: The feature keys to evaluate.
    ///   - requirement: Whether all or any features must be enabled.
    ///   - negate: Whether to negate the result.
    /// - Returns: The evaluation result.
    public func evaluateFeatureGate(
        featureKeys: [String],
        requirement: FeatureRequirement = .all,
        negate: Bool = false,
        context: Any? = nil,
        kind: String? = nil
    ) async -> Bool {
        await ensureFeaturesLoaded()
        let defs = definitions ?? fromBooleanDefaults(features ?? config.featureDefaults)
        return evaluateEvaluatedGate(
            features: defs,
            featureKeys: featureKeys,
            requirementAll: requirement == .all,
            negate: negate,
            entityContext: normalizeEntityContext(context, kind: kind)
        )
    }

    /// Register a local entity mapper. Does not PUT schemas (mobile public keys).
    public func registerContext(_ kind: String, mapper: @escaping EntityContextMapper) {
        TogglyCore.registerContext(kind, mapper: mapper)
    }

    // MARK: - Identity

    /// Set user identity for targeting.
    /// - Parameter identity: The new identity, or nil to use device ID.
    /// - Returns: The refresh response after identity change.
    @discardableResult
    public func setIdentity(_ identity: String?) async -> TogglyInitResponse {
        let previousIdentity = self.identity

        if let newIdentity = identity {
            self.identity = newIdentity
        } else {
            // Fall back to device ID
            var deviceId = await storage.get(TogglyStorageKeys.deviceId)
            if deviceId == nil {
                deviceId = UUID().uuidString
                await storage.set(TogglyStorageKeys.deviceId, value: deviceId!)
            }
            self.identity = deviceId
        }

        // Clear cache if identity changed
        if previousIdentity != self.identity {
            await clearCache()
        }

        // Emit event
        emitEvent(.identityChanged(IdentityChangedEvent(
            previousIdentity: previousIdentity,
            newIdentity: self.identity ?? ""
        )))

        return await refresh()
    }

    // MARK: - Cache

    /// Clear cached feature flags.
    public func clearCache() async {
        features = nil
        definitions = nil
        eTag = nil

        let hashedIdentity = hashIdentity(identity ?? "")
        let cacheKey = TogglyStorageKeys.featureFlagsCache + hashedIdentity
        await storage.delete(cacheKey)
        await storage.delete(TogglyStorageKeys.etag)
    }

    // MARK: - Events

    /// Subscribe to Toggly events.
    /// - Parameter listener: The event listener.
    /// - Returns: A function to unsubscribe.
    @discardableResult
    public func on(_ listener: @escaping TogglyEventListener) -> @Sendable () -> Void {
        let id = UUID()
        eventListeners[id] = listener
        return { [weak self] in
            Task { [weak self] in
                await self?.removeEventListener(id)
            }
        }
    }

    private func removeEventListener(_ id: UUID) {
        eventListeners.removeValue(forKey: id)
    }

    /// Add a feature state change handler.
    /// - Parameter handler: The handler to add.
    /// - Returns: A function to unsubscribe.
    @discardableResult
    public func addStateChangeHandler(_ handler: @escaping FeatureStateChangeHandler) -> @Sendable () -> Void {
        let id = UUID()
        stateChangeHandlers[id] = handler
        return { [weak self] in
            Task { [weak self] in
                await self?.removeStateChangeHandler(id)
            }
        }
    }

    private func removeStateChangeHandler(_ id: UUID) {
        stateChangeHandlers.removeValue(forKey: id)
    }

    // MARK: - App State

    /// Update the app state (call when app moves to foreground/background).
    /// - Parameter state: The new app state.
    public func setAppState(_ state: AppStateType) async {
        let wasBackground = appState == .background
        appState = state
        emitEvent(.appStateChanged(state))

        // Refresh when coming to foreground
        if wasBackground && state == .active {
            await refresh()
        }
    }

    /// Update the network state.
    /// - Parameter state: The new network state.
    public func setNetworkState(_ state: NetworkState) async {
        let wasOffline = networkState?.isConnected == false
        networkState = state
        emitEvent(.networkChanged(state))

        // Refresh when coming back online
        if wasOffline && state.isConnected {
            await refresh()
        }
    }

    // MARK: - Debug

    /// Get debug information about the SDK state.
    /// - Returns: Debug information.
    public func getDebugInfo() -> TogglyDebugInfo {
        TogglyDebugInfo(
            identity: identity,
            appKey: config.appKey,
            environment: config.environment,
            useSignedDefinitions: config.useSignedDefinitions,
            isAppInForeground: appState == .active,
            refreshInterval: config.refreshInterval,
            syncServiceRunning: refreshTask != nil,
            lastChecked: lastChecked,
            lastSynced: lastSynced,
            eTag: eTag,
            lastError: lastError,
            networkState: networkState,
            appState: appState
        )
    }

    // MARK: - Private Methods

    private func fetchFeatureFlags() async -> TogglyInitResponse {
        // Prevent duplicate fetches
        if featuresLoading {
            await waitForFeaturesLoaded()
            return TogglyInitResponse(status: .fetched, flags: features ?? [:])
        }

        featuresLoading = true
        defer { featuresLoading = false }

        do {
            let url = buildApiUrl()
            var request = URLRequest(url: url)
            request.httpMethod = "GET"
            request.timeoutInterval = config.requestTimeout
            request.setValue(SdkIdentity.userAgent, forHTTPHeaderField: "User-Agent")

            if config.useSignedDefinitions, let etag = eTag {
                request.setValue(etag, forHTTPHeaderField: "If-None-Match")
            }

            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw TogglyError.invalidResponse
            }

            if httpResponse.statusCode == 304 {
                lastChecked = Date()
                let cached = await loadCachedDefinitions()
                applySnapshot(cached.definitions, flags: cached.flags)
                return TogglyInitResponse(status: .cached, flags: cached.flags)
            }

            guard httpResponse.statusCode == 200 else {
                throw TogglyError.httpError(statusCode: httpResponse.statusCode)
            }

            let parsed = try await parseFeatureFlagsResponse(data)
            let flags = parsed.flags
            let previousFlags = features
            applySnapshot(parsed.definitions, flags: flags)

            await cacheFeatureFlags(
                flags,
                defsRaw: parsed.defsRaw,
                timestamp: parsed.timestamp,
                signature: parsed.signature,
                keyId: parsed.keyId
            )

            // Store ETag
            if let newEtag = httpResponse.value(forHTTPHeaderField: "ETag") {
                eTag = newEtag
                await storage.set(TogglyStorageKeys.etag, value: newEtag)
            }

            lastChecked = Date()
            lastSynced = Date()
            lastError = nil

            // Emit refreshed event
            emitEvent(.refreshed(flags))

            // Notify state change handlers
            if let previousFlags = previousFlags {
                notifyFeatureChanges(previousFlags: previousFlags, newFlags: flags)
            }

            return TogglyInitResponse(status: .fetched, flags: flags)
        } catch {
            lastError = error.localizedDescription
            emitEvent(.error(ErrorEvent(error: lastError ?? "Unknown error")))

            // Fall back to cache or defaults
            let cached = await loadCachedDefinitions()
            applySnapshot(cached.definitions, flags: cached.flags)

            return TogglyInitResponse(status: .defaults, flags: cached.flags, error: lastError)
        }
    }

    private func buildApiUrl() -> URL {
        var urlString = "\(config.baseURI)/evaluated-signed/\(config.appKey ?? "")/\(config.environment)"

        if let identity = identity {
            urlString += "?u=\(identity.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? identity)"
        }

        return URL(string: urlString)!
    }

    /// Parse definitions response. When `verifySignatures` is enabled, verify ES256
    /// against the exact raw defs JSON (Security digest-level double-hash).
    private func parseFeatureFlagsResponse(_ data: Data) async throws -> ParsedFeatureFlags {
        if !config.verifySignatures {
            let definitions = try parseEvaluatedDefinitions(from: data)
            let wrapped: EvaluatedDefinitions
            if let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                if object["defs"] != nil || object["data"] != nil {
                    let defsValue = object["defs"] ?? object["data"]
                    if let defsValue {
                        let defsData = try JSONSerialization.data(withJSONObject: defsValue)
                        wrapped = try parseEvaluatedDefinitions(from: defsData)
                    } else {
                        wrapped = definitions
                    }
                } else {
                    wrapped = definitions
                }
            } else {
                wrapped = definitions
            }
            let raw = SignedDefsVerify.extractRawJsonProperty(
                from: String(data: data, encoding: .utf8) ?? "",
                key: "defs"
            ) ?? SignedDefsVerify.extractRawJsonProperty(
                from: String(data: data, encoding: .utf8) ?? "",
                key: "data"
            ) ?? String(data: data, encoding: .utf8)
            return ParsedFeatureFlags(
                definitions: wrapped,
                flags: toBooleanDefinitions(wrapped),
                defsRaw: raw
            )
        }

        guard let bodyText = String(data: data, encoding: .utf8) else {
            throw TogglyError.invalidResponse
        }

        do {
            let (envelope, defsRaw) = try SignedDefsVerify.parseSignedEnvelope(bodyText)
            try SignedDefsVerify.assertEnvelopeFreshness(
                timestamp: envelope.timestamp,
                maxSignatureAgeSeconds: config.maxSignatureAgeSeconds
            )
            let jwks = try await fetchJwks()
            try SignedDefsVerify.verifySignedDefinitions(
                defsRaw: defsRaw,
                signature: envelope.signature,
                timestamp: envelope.timestamp,
                kid: envelope.kid,
                jwks: jwks
            )
            let definitions = try SignedDefsVerify.parseEvaluatedDefinitions(defsRaw)
            return ParsedFeatureFlags(
                definitions: definitions,
                flags: toBooleanDefinitions(definitions),
                defsRaw: defsRaw,
                timestamp: envelope.timestamp,
                signature: envelope.signature,
                keyId: envelope.kid
            )
        } catch let error as SignedDefsVerifyError {
            throw TogglyError.signatureVerificationFailed(error.localizedDescription)
        } catch let error as TogglyError {
            throw error
        } catch {
            throw TogglyError.signatureVerificationFailed(error.localizedDescription)
        }
    }

    private func fetchJwks(forceRefresh: Bool = false) async throws -> JwkSet {
        if !forceRefresh, let cached = inMemoryJwks {
            return cached
        }

        guard let url = URL(string: "\(config.baseURI)/.well-known/jwks") else {
            throw TogglyError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = config.requestTimeout
        request.setValue(SdkIdentity.userAgent, forHTTPHeaderField: "User-Agent")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw TogglyError.httpError(statusCode: status)
        }

        let jwks = try JSONDecoder().decode(JwkSet.self, from: data)
        inMemoryJwks = jwks
        if let encoded = String(data: data, encoding: .utf8) {
            await storage.set(TogglyStorageKeys.jwks, value: encoded)
        }
        return jwks
    }

    /// Prefer persisted JWKS for offline cold-start re-verification; fall back
    /// to a network fetch when none is stored (Flutter soft-fail parity).
    private func resolveJwksForCacheVerify() async -> JwkSet? {
        if let cached = inMemoryJwks {
            return cached
        }
        if let raw = await storage.get(TogglyStorageKeys.jwks),
           let data = raw.data(using: .utf8),
           let jwks = try? JSONDecoder().decode(JwkSet.self, from: data) {
            inMemoryJwks = jwks
            return jwks
        }
        do {
            return try await fetchJwks()
        } catch {
            return nil
        }
    }

    private func waitForFeaturesLoaded() async {
        while featuresLoading {
            try? await Task.sleep(nanoseconds: 50_000_000) // 50ms
        }
    }

    private struct CachedDefinitions {
        let definitions: EvaluatedDefinitions
        let flags: FeatureFlags
    }

    private func applySnapshot(_ defs: EvaluatedDefinitions, flags: FeatureFlags) {
        definitions = defs
        features = flags
    }

    private func loadCachedDefinitions() async -> CachedDefinitions {
        if let features, let definitions {
            return CachedDefinitions(definitions: definitions, flags: features)
        }
        if let features {
            return CachedDefinitions(definitions: fromBooleanDefaults(features), flags: features)
        }

        let hashedIdentity = hashIdentity(identity ?? "")
        let cacheKey = TogglyStorageKeys.featureFlagsCache + hashedIdentity

        guard let cached = await storage.get(cacheKey),
              let data = cached.data(using: .utf8),
              let cacheData = try? JSONDecoder().decode(TogglyFeatureFlagsCache.self, from: data),
              cacheData.identity == identity else {
            return CachedDefinitions(
                definitions: fromBooleanDefaults(config.featureDefaults),
                flags: config.featureDefaults
            )
        }

        return await trustOrReverifyCachedFlags(cacheData, cacheKey: cacheKey)
    }

    private func trustOrReverifyCachedFlags(
        _ cacheData: TogglyFeatureFlagsCache,
        cacheKey: String
    ) async -> CachedDefinitions {
        guard let parsed = try? parseEvaluatedDefinitions(from: cacheData.flags) else {
            await storage.delete(cacheKey)
            return CachedDefinitions(
                definitions: fromBooleanDefaults(config.featureDefaults),
                flags: config.featureDefaults
            )
        }
        let flags = toBooleanDefinitions(parsed)

        guard config.verifySignatures else {
            return CachedDefinitions(definitions: parsed, flags: flags)
        }

        guard let timestamp = cacheData.timestamp,
              let signature = cacheData.signature, !signature.isEmpty,
              let keyId = cacheData.keyId, !keyId.isEmpty else {
            await storage.delete(cacheKey)
            return CachedDefinitions(
                definitions: fromBooleanDefaults(config.featureDefaults),
                flags: config.featureDefaults
            )
        }

        do {
            try SignedDefsVerify.assertEnvelopeFreshness(
                timestamp: timestamp,
                maxSignatureAgeSeconds: config.maxSignatureAgeSeconds
            )
        } catch {
            await storage.delete(cacheKey)
            return CachedDefinitions(
                definitions: fromBooleanDefaults(config.featureDefaults),
                flags: config.featureDefaults
            )
        }

        guard let jwks = await resolveJwksForCacheVerify() else {
            return CachedDefinitions(definitions: parsed, flags: flags)
        }

        do {
            try SignedDefsVerify.verifySignedDefinitions(
                defsRaw: cacheData.flags,
                signature: signature,
                timestamp: timestamp,
                kid: keyId,
                jwks: jwks
            )
            return CachedDefinitions(definitions: parsed, flags: flags)
        } catch {
            await storage.delete(cacheKey)
            return CachedDefinitions(
                definitions: fromBooleanDefaults(config.featureDefaults),
                flags: config.featureDefaults
            )
        }
    }

    private func cacheFeatureFlags(
        _ flags: FeatureFlags,
        defsRaw: String? = nil,
        timestamp: Int64? = nil,
        signature: String? = nil,
        keyId: String? = nil
    ) async {
        let flagsString: String
        if let defsRaw {
            flagsString = defsRaw
        } else {
            guard let flagsData = try? JSONEncoder().encode(flags),
                  let encoded = String(data: flagsData, encoding: .utf8) else {
                return
            }
            flagsString = encoded
        }

        let hashedIdentity = hashIdentity(identity ?? "")
        let cacheKey = TogglyStorageKeys.featureFlagsCache + hashedIdentity
        let cacheData = TogglyFeatureFlagsCache(
            identity: identity ?? "",
            flags: flagsString,
            timestamp: timestamp,
            signature: signature,
            keyId: keyId
        )

        if let data = try? JSONEncoder().encode(cacheData),
           let string = String(data: data, encoding: .utf8) {
            await storage.set(cacheKey, value: string)
        }
    }

    private struct ParsedFeatureFlags {
        let definitions: EvaluatedDefinitions
        let flags: FeatureFlags
        let defsRaw: String?
        let timestamp: Int64?
        let signature: String?
        let keyId: String?

        init(
            definitions: EvaluatedDefinitions,
            flags: FeatureFlags,
            defsRaw: String? = nil,
            timestamp: Int64? = nil,
            signature: String? = nil,
            keyId: String? = nil
        ) {
            self.definitions = definitions
            self.flags = flags
            self.defsRaw = defsRaw
            self.timestamp = timestamp
            self.signature = signature
            self.keyId = keyId
        }
    }

    private func ensureFeaturesLoaded() async {
        if features != nil {
            return
        }

        if featuresLoading {
            await waitForFeaturesLoaded()
            return
        }

        let cached = await loadCachedDefinitions()
        applySnapshot(cached.definitions, flags: cached.flags)
    }

    private func startRefreshTimer() {
        stopRefreshTimer()

        guard config.appKey != nil, config.refreshInterval > 0 else {
            return
        }

        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(self?.config.refreshInterval ?? 180) * 1_000_000_000)

                guard !Task.isCancelled else { break }

                if await self?.appState == .active {
                    // When WebSocket is connected, only do fallback refresh every 20 minutes
                    if let self = self, await self.wsConnected {
                        let now = Date()
                        let lastFallback = await self.lastFallbackRefresh
                        let interval = await self.fallbackRefreshInterval
                        if now.timeIntervalSince(lastFallback) < interval {
                            continue
                        }
                        await self.setLastFallbackRefresh(now)
                    }
                    await self?.refresh()
                }
            }
        }
    }

    private func stopRefreshTimer() {
        refreshTask?.cancel()
        refreshTask = nil
    }

    private func setLastFallbackRefresh(_ date: Date) {
        lastFallbackRefresh = date
    }

    // MARK: - WebSocket

    private func startWebSocket() {
        stopWebSocket()

        guard let appKey = config.appKey else { return }

        let wsBaseURI = config.baseURI
            .replacingOccurrences(of: "https://", with: "wss://")
            .replacingOccurrences(of: "http://", with: "ws://")
        let wsURLString = SdkIdentity.appendSdkQueryParams(
            to: "\(wsBaseURI)/\(appKey)/ws",
            cachedRevision: eTag
        )

        guard let url = URL(string: wsURLString) else { return }

        let task = URLSession.shared.webSocketTask(with: url)
        webSocketTask = task
        task.resume()
        wsConnected = true

        wsListenTask = Task { [weak self] in
            await self?.receiveMessage()
        }
    }

    private func stopWebSocket() {
        wsListenTask?.cancel()
        wsListenTask = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        wsConnected = false
    }

    private func receiveMessage() {
        guard let webSocketTask = webSocketTask else { return }

        webSocketTask.receive { [weak self] result in
            Task { [weak self] in
                guard let self = self else { return }

                switch result {
                case .success(let message):
                    switch message {
                    case .string(let text):
                        await self.handleWebSocketMessage(text)
                    case .data(let data):
                        if let text = String(data: data, encoding: .utf8) {
                            await self.handleWebSocketMessage(text)
                        }
                    @unknown default:
                        break
                    }
                    // Continue receiving
                    await self.receiveMessage()

                case .failure:
                    await self.handleWebSocketDisconnect()
                }
            }
        }
    }

    private func handleWebSocketMessage(_ text: String) async {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else {
            return
        }

        // Skip ping messages
        if type == "ping" { return }

        // Key rotation: drop cached JWKS so the next verify uses fresh keys.
        if type == "signing-key-updated" {
            inMemoryJwks = nil
            await storage.delete(TogglyStorageKeys.jwks)
            await refresh()
            return
        }

        // Refresh on flags-updated or update messages
        if type == "flags-updated" || type == "update" {
            await refresh()
        }
    }

    private func handleWebSocketDisconnect() async {
        wsConnected = false
        webSocketTask = nil

        // Schedule reconnect after delay
        guard !Task.isCancelled else { return }

        try? await Task.sleep(nanoseconds: UInt64(wsReconnectDelay) * 1_000_000_000)

        guard !Task.isCancelled, appState == .active else { return }

        startWebSocket()
    }

    private func emitEvent(_ event: TogglyEvent) {
        for listener in eventListeners.values {
            listener(event)
        }
    }

    private func notifyFeatureChanges(previousFlags: FeatureFlags, newFlags: FeatureFlags) {
        let allKeys = Set(previousFlags.keys).union(Set(newFlags.keys))

        for key in allKeys {
            let previousValue = previousFlags[key]
            let newValue = newFlags[key]

            if previousValue != newValue {
                let event = FeatureChangedEvent(
                    featureKey: key,
                    previousValue: previousValue,
                    newValue: newValue
                )
                emitEvent(.featureChanged(event))

                for handler in stateChangeHandlers.values {
                    handler(key, previousValue, newValue)
                }
            }
        }
    }

    private func hashIdentity(_ identity: String) -> String {
        // Simple hash for cache key
        var hash = 0
        for char in identity.unicodeScalars {
            hash = 31 &* hash &+ Int(char.value)
        }
        return String(format: "%08x", abs(hash))
    }
}

// MARK: - Supporting Types

private struct SignedDefinitionsResponse: Codable {
    let defs: FeatureFlags?
    let data: FeatureFlags?
}

/// Errors that can occur in Toggly operations.
public enum TogglyError: LocalizedError {
    case invalidResponse
    case httpError(statusCode: Int)
    case signatureVerificationFailed(String)

    public var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid response from server"
        case .httpError(let statusCode):
            return "HTTP error: \(statusCode)"
        case .signatureVerificationFailed(let message):
            return "Signature verification failed: \(message)"
        }
    }
}
