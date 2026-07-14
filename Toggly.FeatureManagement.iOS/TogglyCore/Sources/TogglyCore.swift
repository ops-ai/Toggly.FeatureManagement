// TogglyCore - Feature Flag Management SDK
// Pure Swift implementation with no external dependencies

// Models
@_exported import struct Foundation.Date
@_exported import struct Foundation.TimeInterval
@_exported import struct Foundation.URL
@_exported import struct Foundation.UUID

// Re-export all public types
// This file serves as the main entry point for the TogglyCore module

/// Toggly SDK version
public let togglyVersion = "1.0.1"

/// Shared Toggly service instance for convenient access.
/// Initialize with `Toggly.shared.configure(config:)` before use.
public enum Toggly {
    private static var _shared: TogglyService?

    /// The shared Toggly service instance.
    /// - Note: You must call `configure(config:)` before accessing this property.
    public static var shared: TogglyService {
        guard let service = _shared else {
            fatalError("Toggly.shared accessed before configure(config:) was called")
        }
        return service
    }

    /// Configure the shared Toggly instance.
    /// - Parameter config: The configuration for the SDK.
    /// - Returns: The configured TogglyService instance.
    @discardableResult
    public static func configure(config: TogglyConfig) -> TogglyService {
        let service = TogglyService(config: config)
        _shared = service
        return service
    }

    /// Reset the shared instance. Useful for testing.
    public static func reset() {
        _shared = nil
    }

    /// Check if the shared instance has been configured.
    public static var isConfigured: Bool {
        _shared != nil
    }
}
