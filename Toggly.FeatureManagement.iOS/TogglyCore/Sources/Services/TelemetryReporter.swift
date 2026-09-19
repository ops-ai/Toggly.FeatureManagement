import Foundation
import zlib

/// Batches feature and app metric deltas with immutable attribution per admitted batch.
/// A reporter belongs to one service and never stores groups, claims, or entity context.
public actor TelemetryReporter {
    public typealias Diagnostic = @Sendable (String) -> Void
    typealias Transport = @Sendable (URLRequest) async throws -> HTTPURLResponse
    typealias Sleeper = @Sendable (TimeInterval) async -> Void
    typealias Compressor = @Sendable (Data) throws -> Data?

    struct Attribution: Equatable, Sendable {
        let field: String?
        let value: String?
        init(instanceId: String? = nil, identity: String? = nil) {
            let token = instanceId?.trimmingCharacters(in: .whitespacesAndNewlines)
            let user = identity?.trimmingCharacters(in: .whitespacesAndNewlines)
            if let token, !token.isEmpty { field = "i"; value = token }
            else if let user, !user.isEmpty { field = "u"; value = user }
            else { field = nil; value = nil }
        }
    }

    private struct Delta {
        var checks: Int64 = 0
        var used: Int64 = 0
        var viewed: Int64 = 0
        var values: [Int64] {
            if viewed > 0 { return [checks, used, viewed] }
            if used > 0 { return [checks, used] }
            return [checks]
        }
    }

    private enum Metric {
        case counter(Int64)
        case gauge(Double)
    }

    private struct Batch {
        let data: Data
        let entries: Int
        let createdAt: TimeInterval
        let metricKinds: [String: Bool]
        var retainedBytes: Int { data.count + metricKinds.keys.reduce(0) { $0 + $1.utf8.count + 1 } }
    }

    private enum Item {
        case feature(String, String, Delta)
        case metric(String, Double, Bool)
    }

    private let appKey: String
    private let enabled: Bool
    private let environment: String
    private let endpoint: URL?
    private let interval: Int
    private let transport: Transport
    private let sleeper: Sleeper
    private let compressor: Compressor
    private let clock: @Sendable () -> TimeInterval
    private let diagnostic: Diagnostic?
    private var features: [String: [String: Delta]] = [:]
    private var metrics: [String: Metric] = [:]
    private var queued: [Batch] = []
    private var attribution: Attribution
    private var pendingCreatedAt: TimeInterval?
    private var finalSendsRemaining = 1
    private var periodicTask: Task<Void, Never>?
    private var flushTask: Task<Void, Never>?
    private var retryTask: Task<Void, Never>?
    private(set) var packetizationPeakBytes = 0
    private(set) var packetizationCount = 0
    private var disposed = false
    private var isEnabled: Bool { enabled && !appKey.isEmpty && endpoint != nil && (30_000...60_000).contains(interval) }

    /// Creates an owner-scoped reporter. Invalid keys, URLs, or intervals disable it.
    public init(
        appKey: String,
        environment: String = "Production",
        instanceId: String? = nil,
        identity: String? = nil,
        enableTelemetry: Bool = true,
        metricsBaseUrl: String = "https://metrics.toggly.io",
        telemetryFlushIntervalMs: Int = 45_000,
        onDiagnostic: Diagnostic? = nil
    ) {
        self.appKey = appKey.trimmingCharacters(in: .whitespacesAndNewlines)
        self.enabled = enableTelemetry
        self.environment = environment
        self.attribution = Attribution(instanceId: instanceId, identity: identity)
        self.endpoint = Self.makeEndpoint(metricsBaseUrl)
        self.interval = (30_000...60_000).contains(telemetryFlushIntervalMs) ? telemetryFlushIntervalMs : 45_000
        self.diagnostic = onDiagnostic
        if enableTelemetry && !self.appKey.isEmpty {
            if self.endpoint == nil { onDiagnostic?("telemetry_invalid_endpoint") }
            if !(30_000...60_000).contains(telemetryFlushIntervalMs) { onDiagnostic?("telemetry_invalid_interval") }
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.timeoutIntervalForRequest = 5
        configuration.timeoutIntervalForResource = 5
        let session = URLSession(configuration: configuration)
        self.transport = { request in
            let (_, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
            return http
        }
        self.sleeper = { seconds in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        }
        self.compressor = { Self.gzip($0) }
        self.clock = { Date().timeIntervalSince1970 }
    }

    // The transport/sleeper seams allow deterministic tests without making test hooks public.
    init(
        appKey: String,
        environment: String = "Production",
        instanceId: String? = nil,
        identity: String? = nil,
        enableTelemetry: Bool = true,
        metricsBaseUrl: String = "https://metrics.toggly.io",
        telemetryFlushIntervalMs: Int = 45_000,
        onDiagnostic: Diagnostic? = nil,
        sleep: @escaping Sleeper = { seconds in try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) },
        compressor: @escaping Compressor = { _ in nil },
        clock: @escaping @Sendable () -> TimeInterval = { Date().timeIntervalSince1970 },
        transport: @escaping Transport
    ) {
        self.appKey = appKey.trimmingCharacters(in: .whitespacesAndNewlines)
        self.enabled = enableTelemetry
        self.environment = environment
        self.attribution = Attribution(instanceId: instanceId, identity: identity)
        self.endpoint = Self.makeEndpoint(metricsBaseUrl)
        self.interval = (30_000...60_000).contains(telemetryFlushIntervalMs) ? telemetryFlushIntervalMs : 45_000
        self.diagnostic = onDiagnostic
        if enableTelemetry && !self.appKey.isEmpty {
            if self.endpoint == nil { onDiagnostic?("telemetry_invalid_endpoint") }
            if !(30_000...60_000).contains(telemetryFlushIntervalMs) { onDiagnostic?("telemetry_invalid_interval") }
        }
        self.sleeper = sleep
        self.compressor = compressor
        self.clock = clock
        self.transport = transport
    }

    static func gzip(_ data: Data) -> Data? {
        var stream = z_stream()
        guard deflateInit2_(&stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, 31, 8,
                            Z_DEFAULT_STRATEGY, ZLIB_VERSION,
                            Int32(MemoryLayout<z_stream>.size)) == Z_OK else { return nil }
        defer { deflateEnd(&stream) }
        var output = Data(count: min(49_152, Int(deflateBound(&stream, uLong(data.count)))))
        let status = data.withUnsafeBytes { source in
            output.withUnsafeMutableBytes { target in
                stream.next_in = UnsafeMutablePointer(mutating: source.bindMemory(to: Bytef.self).baseAddress)
                stream.avail_in = uInt(source.count)
                stream.next_out = target.bindMemory(to: Bytef.self).baseAddress
                stream.avail_out = uInt(target.count)
                return deflate(&stream, Z_FINISH)
            }
        }
        guard status == Z_STREAM_END else { return nil }
        output.count = Int(stream.total_out)
        return output
    }

    private static func makeEndpoint(_ base: String) -> URL? {
        guard !base.contains("?"), !base.contains("#"),
              var components = URLComponents(string: base),
              let scheme = components.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil else { return nil }
        components.scheme = scheme
        components.host = host.lowercased()
        if (scheme == "https" && components.port == 443) || (scheme == "http" && components.port == 80) {
            components.port = nil
        }
        components.query = nil
        components.fragment = nil
        var segments: [String] = []
        for segment in components.path.split(separator: "/", omittingEmptySubsequences: false) {
            switch segment {
            case ".": continue
            case "..":
                if let last = segments.last, !last.isEmpty { segments.removeLast() }
            default: segments.append(String(segment))
            }
        }
        var prefix = segments.joined(separator: "/")
        while prefix.hasSuffix("/") { prefix.removeLast() }
        components.path = prefix + "/api/frontend/telemetry"
        return components.url
    }

    private func diagnose(_ message: String) { diagnostic?(message) }

    private func startTimerIfNeeded() {
        guard periodicTask == nil, isEnabled, !disposed else { return }
        let base = interval
        periodicTask = Task { [weak self] in
            while !Task.isCancelled {
                let jitter = Double.random(in: 0.8...1.2)
                try? await Task.sleep(nanoseconds: UInt64(Double(base) * jitter * 1_000_000))
                if Task.isCancelled { return }
                await self?.flushTelemetry()
            }
        }
    }

    private func accept(_ change: () -> Void, undo: () -> Void) {
        guard isEnabled, !disposed else { return }
        change()
        let (entries, upperBytes) = pendingResources()
        let queuedEntries = queued.reduce(0) { $0 + $1.entries }
        let queuedBytes = queued.reduce(0) { $0 + $1.retainedBytes }
        let exact = upperBytes + queuedBytes > 262_144 ? packetize(consume: false) : nil
        if entries + queuedEntries > 2_000 ||
           (exact != nil && (!exact!.valid || exact!.bytes + queuedBytes > 262_144)) {
            undo()
            diagnose("telemetry_buffer_limit")
        } else {
            if pendingCreatedAt == nil { pendingCreatedAt = clock() }
            startTimerIfNeeded()
        }
    }

    // Compute on demand: rejected or drained names never enter an owner-lifetime catalog.
    private func encodedNameLength(_ name: String) -> Int {
        var size = 2
        for byte in name.utf8 {
            switch byte {
            case 8, 9, 10, 12, 13, 34, 92: size += 2
            case 0..<32: size += 6
            default: size += 1
            }
        }
        return size
    }

    /// Seal accepted events before changing attribution. Empty rotations retain no history.
    public func setContext(instanceId: String? = nil, identity: String? = nil) {
        useAttribution(Attribution(instanceId: instanceId, identity: identity))
    }

    private func useAttribution(_ next: Attribution) {
        guard !disposed, next != attribution else { return }
        sealPending()
        attribution = next
    }

    private func sealPending() {
        _ = packetize(consume: true)
        if features.isEmpty && metrics.isEmpty { pendingCreatedAt = nil }
    }

    private func hasQueuedKind(_ key: String, counter: Bool) -> Bool {
        queued.contains { $0.metricKinds[key] == counter }
    }

    // Measurement does not encode or retain another copy of the pending queue.
    func retainedResources() -> (entries: Int, bytes: Int) {
        let pending = packetize(consume: false)
        return (pending.entries + queued.reduce(0) { $0 + $1.entries },
                pending.bytes + queued.reduce(0) { $0 + $1.retainedBytes })
    }

    private func pendingResources() -> (entries: Int, upperBytes: Int) {
        var entries = 0
        var upperBytes = 0
        let headerBytes = headerByteCount
        for (key, variants) in features {
            let keyBytes = encodedNameLength(key)
            for (variant, delta) in variants {
                let maximum = max(delta.checks, delta.used, delta.viewed)
                let pieces = maximum == 0 ? 1 : Int((maximum - 1) / 1_000_000 + 1)
                entries += pieces
                // Each eventual chunk is no larger than an isolated envelope:
                // escaped header/key/variant plus at most three seven-digit values.
                // Forty bytes covers all punctuation, commas, and numbers.
                upperBytes += pieces * (headerBytes + keyBytes + encodedNameLength(variant) + 40)
            }
        }
        for (key, metric) in metrics {
            let keyBytes = encodedNameLength(key)
            switch metric {
            case .counter(let value):
                let pieces = value == 0 ? 1 : Int((value - 1) / 1_000_000 + 1)
                entries += pieces
                upperBytes += pieces * (headerBytes + 2 * keyBytes + 40)
            case .gauge(let value):
                _ = value
                entries += 1
                upperBytes += headerBytes + 2 * keyBytes + 40
            }
        }
        return (entries, upperBytes)
    }

    private func singleFeatureFits(_ key: String, variant: String, delta: Delta) -> Bool {
        var packet = Packet()
        packet.features = [key: [variant: Delta(checks: min(delta.checks, 1_000_000),
                                              used: min(delta.used, 1_000_000), viewed: min(delta.viewed, 1_000_000))]]
        return packetBytes(packet) <= 49_152
    }

    private func singleMetricFits(_ key: String, value: Double) -> Bool {
        var packet = Packet()
        packet.metrics = [key: value]
        return packetBytes(packet) <= 49_152
    }

    private func recordFeature(_ key: String, variant: String, index: Int) {
        guard !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { diagnose("telemetry_invalid_name"); return }
        let bytes = variant.utf8
        guard !bytes.isEmpty, bytes.count <= 64,
              bytes.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) ||
                                    (97...122).contains($0) || $0 == 95 || $0 == 45 }) else {
            diagnose("telemetry_invalid_variant")
            return
        }
        let old = features[key]?[variant]
        var updated = old ?? Delta()
        switch index {
        case 0: guard updated.checks < Int64.max else { return }; updated.checks += 1
        case 1: guard updated.used < Int64.max else { return }; updated.used += 1
        default: guard updated.viewed < Int64.max else { return }; updated.viewed += 1
        }
        guard singleFeatureFits(key, variant: variant, delta: updated) else { diagnose("telemetry_oversized_entry"); return }
        accept({ features[key, default: [:]][variant] = updated }, undo: {
            if let old { features[key, default: [:]][variant] = old }
            else { features[key]?.removeValue(forKey: variant); if features[key]?.isEmpty == true { features.removeValue(forKey: key) } }
        })
    }

    public func recordCheck(_ featureKey: String, variant: String) { recordFeature(featureKey, variant: variant, index: 0) }
    public func recordUsage(_ featureKey: String, variant: String = "enabled") { recordFeature(featureKey, variant: variant, index: 1) }
    public func recordView(_ featureKey: String, variant: String = "enabled") { recordFeature(featureKey, variant: variant, index: 2) }

    public func incrementCounter(_ metricKey: String, value: Double = 1) {
        guard !metricKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              value.isFinite, value >= 0, value <= 1_000_000,
              value.rounded(.towardZero) == value else { diagnose("telemetry_invalid_metric"); return }
        let increment = Int64(value)
        if case .gauge? = metrics[metricKey] { diagnose("telemetry_metric_kind_conflict"); return }
        if hasQueuedKind(metricKey, counter: false) { diagnose("telemetry_metric_kind_conflict"); return }
        let old = metrics[metricKey]
        let current: Int64
        if case .counter(let amount)? = old { current = amount } else { current = 0 }
        guard current <= Int64.max - increment else { diagnose("telemetry_metric_overflow"); return }
        guard singleMetricFits(metricKey, value: Double(min(current + increment, 1_000_000))) else {
            diagnose("telemetry_oversized_entry"); return
        }
        accept({ metrics[metricKey] = .counter(current + increment) }, undo: { metrics[metricKey] = old })
    }

    public func setGauge(_ metricKey: String, value: Double) {
        guard !metricKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              value.isFinite, value >= 0, value <= 1_000_000 else { diagnose("telemetry_invalid_metric"); return }
        guard singleMetricFits(metricKey, value: value) else { diagnose("telemetry_oversized_entry"); return }
        if case .counter? = metrics[metricKey] { diagnose("telemetry_metric_kind_conflict"); return }
        if hasQueuedKind(metricKey, counter: true) { diagnose("telemetry_metric_kind_conflict"); return }
        let old = metrics[metricKey]
        accept({ metrics[metricKey] = .gauge(value) }, undo: { metrics[metricKey] = old })
    }

    func recordChecks(_ checks: [(String, Bool)], attribution: Attribution) {
        guard !disposed else { return }
        useAttribution(attribution)
        for (key, enabled) in checks { recordCheck(key, variant: enabled ? "enabled" : "disabled") }
    }

    func recordUsage(_ key: String, variant: String, attribution: Attribution) {
        useAttribution(attribution); recordUsage(key, variant: variant)
    }
    func recordView(_ key: String, variant: String, attribution: Attribution) {
        useAttribution(attribution); recordView(key, variant: variant)
    }
    func incrementCounter(_ key: String, value: Double, attribution: Attribution) {
        useAttribution(attribution); incrementCounter(key, value: value)
    }
    func setGauge(_ key: String, value: Double, attribution: Attribution) {
        useAttribution(attribution); setGauge(key, value: value)
    }

    /// Only the current packet is scratch. Source entries move into queued ownership
    /// immediately after encoding it, before the next packet is constructed.
    private struct Packet {
        var features: [String: [String: Delta]] = [:]
        var metrics: [String: Double] = [:]
        var metricKinds: [String: Bool] = [:]
        var entries = 0
    }

    private var headerByteCount: Int {
        11 + encodedNameLength(appKey) + encodedNameLength(environment) +
            (attribution.value.map { 5 + encodedNameLength($0) } ?? 0)
    }

    private func packetBytes(_ packet: Packet) -> Int {
        var bytes = headerByteCount
        if !packet.features.isEmpty {
            bytes += 7 + packet.features.count - 1
            for (key, variants) in packet.features {
                bytes += encodedNameLength(key) + 3 + variants.count - 1
                for (variant, delta) in variants {
                    let values = delta.values
                    bytes += encodedNameLength(variant) + 3 + values.count - 1
                    bytes += values.reduce(0) { $0 + String($1).utf8.count }
                }
            }
        }
        if !packet.metrics.isEmpty {
            bytes += 7 + packet.metrics.count - 1
            for (key, value) in packet.metrics { bytes += encodedNameLength(key) + 1 + String(value).utf8.count }
        }
        return bytes
    }

    private func appendQuoted(_ string: String, to data: inout Data) {
        data.append(34)
        let hex = Array("0123456789abcdef".utf8)
        for byte in string.utf8 {
            switch byte {
            case 34, 92: data.append(92); data.append(byte)
            case 8: data.append(contentsOf: [92, 98])
            case 9: data.append(contentsOf: [92, 116])
            case 10: data.append(contentsOf: [92, 110])
            case 12: data.append(contentsOf: [92, 102])
            case 13: data.append(contentsOf: [92, 114])
            case 0..<32: data.append(contentsOf: [92, 117, 48, 48, hex[Int(byte / 16)], hex[Int(byte % 16)]])
            default: data.append(byte)
            }
        }
        data.append(34)
    }

    private func encodePacket(_ packet: Packet, bytes: Int) -> Data {
        var data = Data()
        data.reserveCapacity(bytes)
        data.append(contentsOf: "{\"k\":".utf8); appendQuoted(appKey, to: &data)
        data.append(contentsOf: ",\"e\":".utf8); appendQuoted(environment, to: &data)
        if let field = attribution.field, let value = attribution.value {
            data.append(44); appendQuoted(field, to: &data); data.append(58); appendQuoted(value, to: &data)
        }
        if !packet.features.isEmpty {
            data.append(contentsOf: ",\"f\":{".utf8)
            for (index, key) in packet.features.keys.sorted().enumerated() {
                if index > 0 { data.append(44) }
                appendQuoted(key, to: &data); data.append(contentsOf: ":{".utf8)
                let variants = packet.features[key]!
                for (variantIndex, variant) in variants.keys.sorted().enumerated() {
                    if variantIndex > 0 { data.append(44) }
                    appendQuoted(variant, to: &data); data.append(contentsOf: ":[".utf8)
                    for (valueIndex, value) in variants[variant]!.values.enumerated() {
                        if valueIndex > 0 { data.append(44) }
                        data.append(contentsOf: String(value).utf8)
                    }
                    data.append(93)
                }
                data.append(125)
            }
            data.append(125)
        }
        if !packet.metrics.isEmpty {
            data.append(contentsOf: ",\"m\":{".utf8)
            for (index, key) in packet.metrics.keys.sorted().enumerated() {
                if index > 0 { data.append(44) }
                appendQuoted(key, to: &data); data.append(58)
                data.append(contentsOf: String(packet.metrics[key]!).utf8)
            }
            data.append(125)
        }
        data.append(125)
        assert(data.count == bytes && data.count <= 49_152)
        packetizationPeakBytes = max(packetizationPeakBytes, data.count)
        packetizationCount += 1
        return data
    }

    // No whole-queue sorted key array or item catalogue survives packet transfer.
    private func nextKey<Value>(_ dictionary: [String: Value], after previous: String?) -> String? {
        dictionary.keys.lazy.filter { previous == nil || $0 > previous! }.min()
    }

    private func visitPendingItems(_ visit: (Item) -> Bool) -> Bool {
        var previousFeature: String?
        while let key = nextKey(features, after: previousFeature) {
            var previousVariant: String?
            while let variant = nextKey(features[key] ?? [:], after: previousVariant) {
                guard var delta = features[key]?[variant] else { return false }
                while delta.checks > 0 || delta.used > 0 || delta.viewed > 0 {
                    let piece = Delta(checks: min(delta.checks, 1_000_000), used: min(delta.used, 1_000_000), viewed: min(delta.viewed, 1_000_000))
                    guard visit(.feature(key, variant, piece)) else { return false }
                    delta.checks -= piece.checks; delta.used -= piece.used; delta.viewed -= piece.viewed
                }
                previousVariant = variant
            }
            previousFeature = key
        }
        var previousMetric: String?
        while let key = nextKey(metrics, after: previousMetric) {
            guard let metric = metrics[key] else { return false }
            switch metric {
            case .counter(var value):
                repeat {
                    let piece = min(value, 1_000_000)
                    guard visit(.metric(key, Double(piece), true)) else { return false }
                    value -= piece
                } while value > 0
            case .gauge(let value):
                guard visit(.metric(key, value, false)) else { return false }
            }
            previousMetric = key
        }
        return true
    }

    private func consume(_ packet: Packet) {
        for (key, variants) in packet.features {
            for (variant, delta) in variants {
                guard var original = features[key]?[variant] else { continue }
                original.checks -= delta.checks; original.used -= delta.used; original.viewed -= delta.viewed
                if max(original.checks, original.used, original.viewed) == 0 { features[key]?.removeValue(forKey: variant) }
                else { features[key]?[variant] = original }
            }
            if features[key]?.isEmpty == true { features.removeValue(forKey: key) }
        }
        for (key, value) in packet.metrics {
            if case .counter(let original)? = metrics[key], original > Int64(value) { metrics[key] = .counter(original - Int64(value)) }
            else { metrics.removeValue(forKey: key) }
        }
    }

    /// Exact admission/inspection is a size-only walk. Transfer encodes one envelope
    /// at a time, removes its source values, and immediately gives the queue ownership.
    @discardableResult
    private func packetize(consume shouldConsume: Bool, maxPackets: Int = .max) -> (entries: Int, bytes: Int, valid: Bool) {
        var packet = Packet()
        var totalEntries = 0
        var totalBytes = 0
        var packets = 0
        let createdAt = pendingCreatedAt ?? clock()
        func finish() {
            guard packet.entries > 0 else { return }
            let bytes = packetBytes(packet)
            totalEntries += packet.entries
            totalBytes += bytes + packet.metricKinds.keys.reduce(0) { $0 + $1.utf8.count + 1 }
            if shouldConsume {
                let data = encodePacket(packet, bytes: bytes)
                consume(packet)
                queued.append(Batch(data: data, entries: packet.entries, createdAt: createdAt, metricKinds: packet.metricKinds))
            }
            packets += 1
            packet = Packet()
        }
        let valid = visitPendingItems { item in
            let collision: Bool
            switch item {
            case .feature(let key, let variant, _): collision = packet.features[key]?[variant] != nil || (packet.features[key]?.count ?? 0) >= 16
            case .metric(let key, _, _): collision = packet.metrics[key] != nil
            }
            if collision { finish() }
            guard packets < maxPackets else { return false }
            func insert() {
                switch item {
                case .feature(let key, let variant, let delta): packet.features[key, default: [:]][variant] = delta
                case .metric(let key, let value, let counter): packet.metrics[key] = value; packet.metricKinds[key] = counter
                }
                packet.entries += 1
            }
            insert()
            if packetBytes(packet) > 49_152 || packet.entries > 2_000 {
                switch item {
                case .feature(let key, let variant, _):
                    packet.features[key]?.removeValue(forKey: variant)
                    if packet.features[key]?.isEmpty == true { packet.features.removeValue(forKey: key) }
                case .metric(let key, _, _): packet.metrics.removeValue(forKey: key); packet.metricKinds.removeValue(forKey: key)
                }
                packet.entries -= 1
                finish()
                guard packets < maxPackets else { return false }
                insert()
            }
            return packetBytes(packet) <= 49_152 && totalEntries + packet.entries <= 2_000
        }
        if valid { finish() }
        return (totalEntries, totalBytes, valid || packets == maxPackets)
    }

    /// Sends queued deltas in request order; failures never affect flag evaluation.
    public func flushTelemetry() async {
        guard isEnabled else { return }
        if let flushTask { await flushTask.value; return }
        let task = Task { await drain() }
        flushTask = task
        await task.value
        flushTask = nil
    }

    private func drain() async {
        defer {
            if queued.isEmpty && features.isEmpty && metrics.isEmpty { periodicTask?.cancel(); periodicTask = nil }
        }
        while true {
            if disposed && finalSendsRemaining == 0 {
                queued = []; features = [:]; metrics = [:]; pendingCreatedAt = nil
                return
            }
            if queued.isEmpty {
                sealPending()
            }
            guard let batch = queued.first, let endpoint else { return }
            if batchExpired(batch) {
                diagnose("telemetry_batch_expired")
                queued.removeFirst()
                continue
            }
            if disposed { finalSendsRemaining -= 1 }
            var request = URLRequest(url: endpoint)
            request.httpMethod = "POST"
            if !disposed, let compressed = try? compressor(batch.data), compressed.count <= 49_152 {
                request.httpBody = compressed
                request.setValue("gzip", forHTTPHeaderField: "Content-Encoding")
            } else {
                request.httpBody = batch.data
            }
            request.timeoutInterval = 5
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            var retry = 0
            while true {
                if batchExpired(batch) { diagnose("telemetry_batch_expired"); break }
                do {
                    let response = try await withThrowingTaskGroup(of: HTTPURLResponse.self) { group in
                        group.addTask { try await self.transport(request) }
                        group.addTask {
                            try await Task.sleep(nanoseconds: 5_000_000_000)
                            throw URLError(.timedOut)
                        }
                        defer { group.cancelAll() }
                        return try await group.next()!
                    }
                    if response.statusCode == 202 { break }
                    if !disposed && retry < 2 && (response.statusCode == 429 || response.statusCode == 503) {
                        let base = retry == 0 ? 30.0 : 60.0
                        let delay = max(base, Self.retryAfter(response) ?? 0)
                        if clock() - batch.createdAt + delay < 300 {
                            retry += 1
                            let sleeping = Task { await sleeper(delay) }
                            retryTask = sleeping
                            await sleeping.value
                            retryTask = nil
                            if disposed || batchExpired(batch) { break }
                            continue
                        }
                    }
                    diagnose("telemetry_http_failure")
                    break
                } catch {
                    diagnose("telemetry_transport_failure")
                    break
                }
            }
            queued.removeFirst()
            if queued.isEmpty && features.isEmpty && metrics.isEmpty { periodicTask?.cancel(); periodicTask = nil }
        }
    }

    private func batchExpired(_ batch: Batch) -> Bool {
        let age = clock() - batch.createdAt
        return !age.isFinite || age >= 300
    }

    private static func retryAfter(_ response: HTTPURLResponse) -> TimeInterval? {
        guard let raw = response.value(forHTTPHeaderField: "Retry-After") else { return nil }
        if let seconds = TimeInterval(raw), seconds.isFinite, seconds >= 0 { return seconds }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        return formatter.date(from: raw).map { max(0, $0.timeIntervalSinceNow) }
    }

    /// Starts a single bounded best-effort final flush, then releases the timer.
    public func dispose() {
        guard !disposed else { return }
        disposed = true
        periodicTask?.cancel()
        periodicTask = nil
        retryTask?.cancel()
        // Keep at most the existing flight and one incrementally encoded final packet.
        queued = Array(queued.prefix(1))
        if flushTask != nil || queued.isEmpty { _ = packetize(consume: true, maxPackets: 1) }
        features = [:]; metrics = [:]; pendingCreatedAt = nil
        if flushTask == nil { flushTask = Task { await drain() } }
    }
}
