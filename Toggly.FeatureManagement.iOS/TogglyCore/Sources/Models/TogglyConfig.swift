import Foundation

/// Configuration for the Toggly SDK.
public struct TogglyConfig: Sendable {
    /// The application key from the Toggly dashboard.
    public let appKey: String?

    /// The environment name (e.g., "Production", "Staging").
    public let environment: String

    /// Base URI for the Toggly API.
    public let baseURI: String

    /// User identity for feature targeting.
    public let identity: String?

    /// Default feature flag values when server is unavailable.
    public let featureDefaults: FeatureFlags

    /// Whether to show feature content during initial evaluation.
    public let showFeatureDuringEvaluation: Bool

    /// Interval in seconds between automatic refreshes. Set to 0 to disable.
    public let refreshInterval: TimeInterval

    /// Whether to use signed definitions for enhanced security.
    public let useSignedDefinitions: Bool

    /// Connection timeout in seconds.
    public let connectTimeout: TimeInterval

    /// Request timeout in seconds.
    public let requestTimeout: TimeInterval

    /// Custom storage implementation for caching.
    public let storage: TogglyStorage?

    /// Creates a new Toggly configuration.
    /// - Parameters:
    ///   - appKey: The application key from the Toggly dashboard.
    ///   - environment: The environment name. Defaults to "Production".
    ///   - baseURI: Base URI for the Toggly API. Defaults to the Toggly CDN.
    ///   - identity: User identity for feature targeting.
    ///   - featureDefaults: Default feature flag values.
    ///   - showFeatureDuringEvaluation: Whether to show content during evaluation.
    ///   - refreshInterval: Interval between refreshes in seconds. Defaults to 180.
    ///   - useSignedDefinitions: Whether to use signed definitions.
    ///   - connectTimeout: Connection timeout in seconds. Defaults to 10.
    ///   - requestTimeout: Request timeout in seconds. Defaults to 30.
    ///   - storage: Custom storage implementation.
    public init(
        appKey: String? = nil,
        environment: String = "Production",
        baseURI: String = "https://client.toggly.io",
        identity: String? = nil,
        featureDefaults: FeatureFlags = [:],
        showFeatureDuringEvaluation: Bool = false,
        refreshInterval: TimeInterval = 180,
        useSignedDefinitions: Bool = false,
        connectTimeout: TimeInterval = 10,
        requestTimeout: TimeInterval = 30,
        storage: TogglyStorage? = nil
    ) {
        self.appKey = appKey
        self.environment = environment
        self.baseURI = baseURI
        self.identity = identity
        self.featureDefaults = featureDefaults
        self.showFeatureDuringEvaluation = showFeatureDuringEvaluation
        self.refreshInterval = refreshInterval
        self.useSignedDefinitions = useSignedDefinitions
        self.connectTimeout = connectTimeout
        self.requestTimeout = requestTimeout
        self.storage = storage
    }
}
