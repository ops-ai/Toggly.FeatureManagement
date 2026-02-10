import Foundation

/// Represents the current network connectivity state.
public struct NetworkState: Sendable, Equatable {
    /// Whether the device is connected to the network.
    public let isConnected: Bool

    /// The type of network connection (e.g., "wifi", "cellular").
    public let connectionType: String?

    /// Creates a new network state.
    public init(isConnected: Bool, connectionType: String? = nil) {
        self.isConnected = isConnected
        self.connectionType = connectionType
    }

    /// Default state assuming connectivity.
    public static let connected = NetworkState(isConnected: true)

    /// State indicating no connectivity.
    public static let disconnected = NetworkState(isConnected: false)
}

/// The current application state.
public enum AppStateType: String, Sendable {
    /// App is in the foreground and active.
    case active
    /// App is inactive (transitioning).
    case inactive
    /// App is in the background.
    case background
}

/// Protocol for network state monitoring.
public protocol NetworkMonitor: Sendable {
    /// Get the current network state.
    func getState() async -> NetworkState

    /// Subscribe to network state changes.
    /// - Parameter handler: Closure called when network state changes.
    /// - Returns: A function to unsubscribe from updates.
    func subscribe(_ handler: @escaping @Sendable (NetworkState) -> Void) -> @Sendable () -> Void
}

/// Protocol for app state monitoring.
public protocol AppStateMonitor: Sendable {
    /// Get the current app state.
    func getCurrentState() -> AppStateType

    /// Subscribe to app state changes.
    /// - Parameter handler: Closure called when app state changes.
    /// - Returns: A function to unsubscribe from updates.
    func subscribe(_ handler: @escaping @Sendable (AppStateType) -> Void) -> @Sendable () -> Void
}
