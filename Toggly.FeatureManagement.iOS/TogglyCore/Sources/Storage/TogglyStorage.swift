import Foundation

/// Protocol for custom storage implementations.
public protocol TogglyStorage: Sendable {
    /// Retrieve a value from storage.
    /// - Parameter key: The key to retrieve.
    /// - Returns: The stored value, or nil if not found.
    func get(_ key: String) async -> String?

    /// Store a value.
    /// - Parameters:
    ///   - key: The key to store under.
    ///   - value: The value to store.
    func set(_ key: String, value: String) async

    /// Delete a value from storage.
    /// - Parameter key: The key to delete.
    func delete(_ key: String) async

    /// Clear all stored values.
    func clear() async
}

/// Storage keys used by Toggly.
public enum TogglyStorageKeys {
    public static let deviceId = "@toggly:deviceId"
    public static let featureFlagsCache = "@toggly:featureFlagsCache:"
    public static let etag = "@toggly:etag"
    public static let jwks = "@toggly:jwks"
}
