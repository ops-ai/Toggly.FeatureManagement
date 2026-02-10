import Foundation

/// UserDefaults-based storage implementation for Toggly.
/// Provides persistent storage across app launches.
public final class UserDefaultsStorage: TogglyStorage, @unchecked Sendable {
    private let defaults: UserDefaults
    private let keyPrefix: String
    private let queue = DispatchQueue(label: "io.toggly.userdefaults.storage")

    /// Creates a new UserDefaults storage instance.
    /// - Parameters:
    ///   - defaults: The UserDefaults instance to use. Defaults to standard.
    ///   - keyPrefix: Prefix for all keys. Defaults to "toggly_".
    public init(defaults: UserDefaults = .standard, keyPrefix: String = "toggly_") {
        self.defaults = defaults
        self.keyPrefix = keyPrefix
    }

    /// Retrieve a value from storage.
    public func get(_ key: String) async -> String? {
        return await withCheckedContinuation { continuation in
            queue.async { [weak self] in
                guard let self = self else {
                    continuation.resume(returning: nil)
                    return
                }
                let value = self.defaults.string(forKey: self.prefixedKey(key))
                continuation.resume(returning: value)
            }
        }
    }

    /// Store a value.
    public func set(_ key: String, value: String) async {
        await withCheckedContinuation { continuation in
            queue.async { [weak self] in
                guard let self = self else {
                    continuation.resume()
                    return
                }
                self.defaults.set(value, forKey: self.prefixedKey(key))
                continuation.resume()
            }
        }
    }

    /// Delete a value from storage.
    public func delete(_ key: String) async {
        await withCheckedContinuation { continuation in
            queue.async { [weak self] in
                guard let self = self else {
                    continuation.resume()
                    return
                }
                self.defaults.removeObject(forKey: self.prefixedKey(key))
                continuation.resume()
            }
        }
    }

    /// Clear all Toggly-related values from storage.
    public func clear() async {
        await withCheckedContinuation { continuation in
            queue.async { [weak self] in
                guard let self = self else {
                    continuation.resume()
                    return
                }
                let allKeys = self.defaults.dictionaryRepresentation().keys
                for key in allKeys where key.hasPrefix(self.keyPrefix) {
                    self.defaults.removeObject(forKey: key)
                }
                continuation.resume()
            }
        }
    }

    private func prefixedKey(_ key: String) -> String {
        return keyPrefix + key
    }
}
