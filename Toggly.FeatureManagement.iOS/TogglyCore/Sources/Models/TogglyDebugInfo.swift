import Foundation

/// Debug information about the Toggly SDK state.
public struct TogglyDebugInfo: Sendable {
    /// Current user identity.
    public let identity: String?

    /// Application key.
    public let appKey: String?

    /// Current environment.
    public let environment: String

    /// Whether signed definitions are enabled.
    public let useSignedDefinitions: Bool

    /// Whether the app is in the foreground.
    public let isAppInForeground: Bool

    /// Refresh interval in seconds.
    public let refreshInterval: TimeInterval

    /// Whether the sync service is running.
    public let syncServiceRunning: Bool

    /// Last time feature flags were checked.
    public let lastChecked: Date?

    /// Last time feature flags were successfully synced.
    public let lastSynced: Date?

    /// Current ETag for conditional requests.
    public let eTag: String?

    /// Last error message.
    public let lastError: String?

    /// Current network state.
    public let networkState: NetworkState?

    /// Current app state.
    public let appState: AppStateType

    /// Creates debug info.
    public init(
        identity: String?,
        appKey: String?,
        environment: String,
        useSignedDefinitions: Bool,
        isAppInForeground: Bool,
        refreshInterval: TimeInterval,
        syncServiceRunning: Bool,
        lastChecked: Date?,
        lastSynced: Date?,
        eTag: String?,
        lastError: String?,
        networkState: NetworkState?,
        appState: AppStateType
    ) {
        self.identity = identity
        self.appKey = appKey
        self.environment = environment
        self.useSignedDefinitions = useSignedDefinitions
        self.isAppInForeground = isAppInForeground
        self.refreshInterval = refreshInterval
        self.syncServiceRunning = syncServiceRunning
        self.lastChecked = lastChecked
        self.lastSynced = lastSynced
        self.eTag = eTag
        self.lastError = lastError
        self.networkState = networkState
        self.appState = appState
    }
}
