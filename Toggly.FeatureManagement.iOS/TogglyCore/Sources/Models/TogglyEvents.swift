import Foundation

/// Types of events emitted by Toggly.
public enum TogglyEventType: String, Sendable, CaseIterable {
    /// SDK has been initialized.
    case initialized
    /// Feature flags have been refreshed.
    case refreshed
    /// An error occurred.
    case error
    /// User identity has changed.
    case identityChanged
    /// A specific feature flag has changed.
    case featureChanged
    /// Network state has changed.
    case networkChanged
    /// App state has changed (foreground/background).
    case appStateChanged
}

/// Event data for identity changes.
public struct IdentityChangedEvent: Sendable {
    /// The previous identity value.
    public let previousIdentity: String?

    /// The new identity value.
    public let newIdentity: String

    /// Creates a new identity changed event.
    public init(previousIdentity: String?, newIdentity: String) {
        self.previousIdentity = previousIdentity
        self.newIdentity = newIdentity
    }
}

/// Event data for feature changes.
public struct FeatureChangedEvent: Sendable {
    /// The key of the feature that changed.
    public let featureKey: String

    /// The previous value of the feature.
    public let previousValue: Bool?

    /// The new value of the feature.
    public let newValue: Bool?

    /// Creates a new feature changed event.
    public init(featureKey: String, previousValue: Bool?, newValue: Bool?) {
        self.featureKey = featureKey
        self.previousValue = previousValue
        self.newValue = newValue
    }
}

/// Event data for errors.
public struct ErrorEvent: Sendable {
    /// The error message.
    public let error: String

    /// Creates a new error event.
    public init(error: String) {
        self.error = error
    }
}

/// Generic event payload that can contain different event types.
public enum TogglyEvent: Sendable {
    case initialized(TogglyInitResponse)
    case refreshed(FeatureFlags)
    case error(ErrorEvent)
    case identityChanged(IdentityChangedEvent)
    case featureChanged(FeatureChangedEvent)
    case networkChanged(NetworkState)
    case appStateChanged(AppStateType)
}

/// Listener type for Toggly events.
public typealias TogglyEventListener = @Sendable (TogglyEvent) -> Void

/// Handler for feature state changes.
public typealias FeatureStateChangeHandler = @Sendable (_ featureKey: String, _ previousValue: Bool?, _ newValue: Bool?) -> Void
