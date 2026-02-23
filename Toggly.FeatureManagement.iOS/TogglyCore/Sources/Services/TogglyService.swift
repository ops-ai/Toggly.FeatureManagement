import Foundation

/// Core Toggly service for feature flag management.
/// Thread-safe actor that handles feature flag evaluation, caching, and lifecycle management.
public actor TogglyService {
    // MARK: - Configuration

    private let config: TogglyConfig
    private let storage: TogglyStorage

    // MARK: - State

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
            let cachedFlags = await getCachedFeatureFlags()
            return TogglyInitResponse(status: .cached, flags: cachedFlags)
        }

        // If no app key, use defaults
        guard config.appKey != nil else {
            features = config.featureDefaults
            return TogglyInitResponse(status: .defaults, flags: features ?? [:])
        }

        // Fetch from server
        return await fetchFeatureFlags()
    }

    /// Dispose the service and clean up resources.
    public func dispose() {
        stopRefreshTimer()
        eventListeners.removeAll()
        stateChangeHandlers.removeAll()
        features = nil
        isInitialized = false
    }

    // MARK: - Feature Evaluation

    /// Check if a feature is enabled.
    /// - Parameter featureKey: The feature key to check.
    /// - Returns: Whether the feature is enabled.
    public func isFeatureOn(_ featureKey: String) async -> Bool {
        await evaluateFeatureGate(featureKeys: [featureKey], requirement: .all, negate: false)
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
        negate: Bool = false
    ) async -> Bool {
        await ensureFeaturesLoaded()

        guard !featureKeys.isEmpty else {
            return true
        }

        let flags = features ?? config.featureDefaults

        // Fast path for single feature
        if featureKeys.count == 1 {
            let isEnabled = flags[featureKeys[0]] == true
            return negate ? !isEnabled : isEnabled
        }

        let isEnabled: Bool
        switch requirement {
        case .any:
            isEnabled = featureKeys.contains { flags[$0] == true }
        case .all:
            isEnabled = featureKeys.allSatisfy { flags[$0] == true }
        }

        return negate ? !isEnabled : isEnabled
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

            if config.useSignedDefinitions, let etag = eTag {
                request.setValue(etag, forHTTPHeaderField: "If-None-Match")
            }

            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw TogglyError.invalidResponse
            }

            if httpResponse.statusCode == 304 {
                // Not modified, use cached
                lastChecked = Date()
                let cachedFlags = await getCachedFeatureFlags()
                features = cachedFlags
                return TogglyInitResponse(status: .cached, flags: cachedFlags)
            }

            guard httpResponse.statusCode == 200 else {
                throw TogglyError.httpError(statusCode: httpResponse.statusCode)
            }

            let flags: FeatureFlags
            if let signedResponse = try? JSONDecoder().decode(SignedDefinitionsResponse.self, from: data) {
                flags = signedResponse.defs ?? signedResponse.data ?? [:]
            } else {
                flags = try JSONDecoder().decode(FeatureFlags.self, from: data)
            }

            // Track changes
            let previousFlags = features
            features = flags

            // Cache the flags
            await cacheFeatureFlags(flags)

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
            let cachedFlags = await getCachedFeatureFlags()
            features = cachedFlags

            return TogglyInitResponse(status: .defaults, flags: cachedFlags, error: lastError)
        }
    }

    private func buildApiUrl() -> URL {
        var urlString = "\(config.baseURI)/evaluated-signed/\(config.appKey ?? "")/\(config.environment)"

        if let identity = identity {
            urlString += "?u=\(identity.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? identity)"
        }

        return URL(string: urlString)!
    }

    private func waitForFeaturesLoaded() async {
        while featuresLoading {
            try? await Task.sleep(nanoseconds: 50_000_000) // 50ms
        }
    }

    private func getCachedFeatureFlags() async -> FeatureFlags {
        if let features = features {
            return features
        }

        let hashedIdentity = hashIdentity(identity ?? "")
        let cacheKey = TogglyStorageKeys.featureFlagsCache + hashedIdentity

        if let cached = await storage.get(cacheKey),
           let data = cached.data(using: .utf8),
           let cacheData = try? JSONDecoder().decode(TogglyFeatureFlagsCache.self, from: data),
           cacheData.identity == identity,
           let flagsData = cacheData.flags.data(using: .utf8),
           let flags = try? JSONDecoder().decode(FeatureFlags.self, from: flagsData) {
            return flags
        }

        return config.featureDefaults
    }

    private func cacheFeatureFlags(_ flags: FeatureFlags) async {
        guard let flagsData = try? JSONEncoder().encode(flags),
              let flagsString = String(data: flagsData, encoding: .utf8) else {
            return
        }

        let hashedIdentity = hashIdentity(identity ?? "")
        let cacheKey = TogglyStorageKeys.featureFlagsCache + hashedIdentity
        let cacheData = TogglyFeatureFlagsCache(identity: identity ?? "", flags: flagsString)

        if let data = try? JSONEncoder().encode(cacheData),
           let string = String(data: data, encoding: .utf8) {
            await storage.set(cacheKey, value: string)
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

        // Load from cache or defaults
        features = await getCachedFeatureFlags()
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
                    await self?.refresh()
                }
            }
        }
    }

    private func stopRefreshTimer() {
        refreshTask?.cancel()
        refreshTask = nil
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

    public var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid response from server"
        case .httpError(let statusCode):
            return "HTTP error: \(statusCode)"
        }
    }
}
