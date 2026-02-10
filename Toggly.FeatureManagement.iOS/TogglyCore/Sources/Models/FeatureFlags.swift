import Foundation

/// A dictionary mapping feature keys to their enabled/disabled state.
public typealias FeatureFlags = [String: Bool]

/// Requirement type for evaluating multiple features.
public enum FeatureRequirement: String, Sendable {
    /// All specified features must be enabled.
    case all
    /// At least one of the specified features must be enabled.
    case any
}

/// The status of feature flags loading.
public enum TogglyLoadStatus: String, Sendable {
    /// Feature flags were successfully fetched from the server.
    case fetched
    /// Feature flags were loaded from cache.
    case cached
    /// Default feature flags are being used.
    case defaults
}

/// Response from Toggly initialization or refresh.
public struct TogglyInitResponse: Sendable {
    /// The status of the load operation.
    public let status: TogglyLoadStatus

    /// The loaded feature flags.
    public let flags: FeatureFlags

    /// Error message if the load failed.
    public let error: String?

    /// Creates a new init response.
    public init(status: TogglyLoadStatus, flags: FeatureFlags, error: String? = nil) {
        self.status = status
        self.flags = flags
        self.error = error
    }
}

/// Cache data structure for persisted feature flags.
public struct TogglyFeatureFlagsCache: Codable, Sendable {
    /// The identity associated with this cache.
    public let identity: String

    /// JSON-encoded feature flags.
    public let flags: String

    /// Creates a new cache entry.
    public init(identity: String, flags: String) {
        self.identity = identity
        self.flags = flags
    }
}
