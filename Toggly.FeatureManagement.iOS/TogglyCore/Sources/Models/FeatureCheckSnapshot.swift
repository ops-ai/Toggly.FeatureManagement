import Foundation

/// An immutable owner-bound cached evaluation. Tokens remain internal to the SDK.
public struct FeatureCheckSnapshot: Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    public let key: String
    public let enabled: Bool
    let owner: UUID
    public var description: String { "FeatureCheckSnapshot" }
    public var debugDescription: String { description }
    let attribution: TelemetryReporter.Attribution
}
