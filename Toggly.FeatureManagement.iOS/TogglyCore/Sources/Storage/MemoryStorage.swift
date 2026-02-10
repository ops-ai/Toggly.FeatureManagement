import Foundation

/// In-memory storage implementation for Toggly.
/// Data is lost when the app terminates.
public actor MemoryStorage: TogglyStorage {
    private var storage: [String: String] = [:]

    /// Creates a new in-memory storage instance.
    public init() {}

    /// Retrieve a value from storage.
    public func get(_ key: String) async -> String? {
        return storage[key]
    }

    /// Store a value.
    public func set(_ key: String, value: String) async {
        storage[key] = value
    }

    /// Delete a value from storage.
    public func delete(_ key: String) async {
        storage.removeValue(forKey: key)
    }

    /// Clear all stored values.
    public func clear() async {
        storage.removeAll()
    }
}
