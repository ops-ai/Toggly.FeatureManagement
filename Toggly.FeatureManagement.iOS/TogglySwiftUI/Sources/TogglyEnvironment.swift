import SwiftUI
import TogglyCore

/// Environment key for the Toggly service.
private struct TogglyServiceKey: EnvironmentKey {
    static let defaultValue: TogglyService? = nil
}

extension EnvironmentValues {
    /// The Toggly service for this environment.
    public var togglyService: TogglyService? {
        get { self[TogglyServiceKey.self] }
        set { self[TogglyServiceKey.self] = newValue }
    }
}

extension View {
    /// Sets the Toggly service for this view hierarchy.
    /// - Parameter service: The Toggly service to use.
    /// - Returns: A view with the Toggly service set.
    public func togglyService(_ service: TogglyService) -> some View {
        environment(\.togglyService, service)
    }
}

/// A view that provides the Toggly service to its children.
public struct TogglyProvider<Content: View>: View {
    @Environment(\.togglyService) private var environmentService

    private let service: TogglyService?
    private let content: Content

    /// Creates a Toggly provider.
    /// - Parameters:
    ///   - service: The Toggly service to provide.
    ///   - content: The content to wrap.
    public init(
        service: TogglyService? = nil,
        @ViewBuilder content: () -> Content
    ) {
        self.service = service
        self.content = content()
    }

    public var body: some View {
        if let service = service {
            content.environment(\.togglyService, service)
        } else if Toggly.isConfigured {
            content.environment(\.togglyService, Toggly.shared)
        } else {
            content
        }
    }
}
