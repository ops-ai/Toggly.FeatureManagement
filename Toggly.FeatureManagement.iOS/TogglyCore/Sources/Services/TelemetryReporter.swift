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
        case metric(String, Double)
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
        var input = [UInt8](data)
        var output = [UInt8](repeating: 0, count: Int(deflateBound(&stream, uLong(input.count))))
        let status = input.withUnsafeMutableBufferPointer { source in
            output.withUnsafeMutableBufferPointer { target in
                stream.next_in = source.baseAddress
                stream.avail_in = uInt(source.count)
                stream.next_out = target.baseAddress
                stream.avail_out = uInt(target.count)
                return deflate(&stream, Z_FINISH)
            }
        }
        guard status == Z_STREAM_END else { return nil }
        return Data(output.prefix(Int(stream.total_out)))
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
        let exactBatches = upperBytes + queuedBytes > 262_144 ? makeBatches() : nil
        let exactBytes = exactBatches?.reduce(0) { $0 + $1.retainedBytes } ?? 0
        if entries + queuedEntries > 2_000 ||
           (exactBatches != nil && (exactBatches!.isEmpty || exactBytes + queuedBytes > 262_144)) {
            undo()
            diagnose("telemetry_buffer_limit")
        } else {
            if pendingCreatedAt == nil { pendingCreatedAt = clock() }
            startTimerIfNeeded()
        }
    }

    // Compute on demand: rejected or drained names never enter an owner-lifetime catalog.
    private func encodedNameLength(_ name: String) -> Int {
        2 + name.utf8.reduce(0) { size, byte in
            size + (byte < 32 ? 6 : (byte == 34 || byte == 92 || byte == 47 ? 2 : 1))
        }
    }

    private var header: [String: Any] {
        var value: [String: Any] = ["k": appKey, "e": environment]
        if let field = attribution.field, let identity = attribution.value { value[field] = identity }
        return value
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
        guard !features.isEmpty || !metrics.isEmpty else { return }
        queued += makeBatches()
        features = [:]; metrics = [:]; pendingCreatedAt = nil
    }

    private func hasQueuedKind(_ key: String, counter: Bool) -> Bool {
        queued.contains { $0.metricKinds[key] == counter }
    }

    // Resource diagnostics are counts only, including retained accounting keys.
    func retainedResources() -> (entries: Int, bytes: Int) {
        let pending = makeBatches()
        let batches = queued + pending
        return (batches.reduce(0) { $0 + $1.entries }, batches.reduce(0) { $0 + $1.retainedBytes })
    }

    private func pendingResources() -> (entries: Int, upperBytes: Int) {
        var entries = 0
        var upperBytes = 0
        let headerBytes = (try? JSONSerialization.data(withJSONObject: header).count) ?? Int.max / 4
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
        let first = Delta(checks: min(delta.checks, 1_000_000),
                          used: min(delta.used, 1_000_000),
                          viewed: min(delta.viewed, 1_000_000))
        var object = header
        object["f"] = [key: [variant: first.values]]
        return ((try? JSONSerialization.data(withJSONObject: object).count) ?? Int.max) <= 49_152
    }

    private func singleMetricFits(_ key: String, value: Double) -> Bool {
        var object = header
        object["m"] = [key: value]
        return ((try? JSONSerialization.data(withJSONObject: object).count) ?? Int.max) <= 49_152
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

    private func makeBatches() -> [Batch] {
        let createdAt = pendingCreatedAt ?? clock()
        var items: [Item] = []
        for feature in features.keys.sorted() {
            for variant in (features[feature] ?? [:]).keys.sorted() {
                guard var delta = features[feature]?[variant] else { continue }
                while delta.checks > 0 || delta.used > 0 || delta.viewed > 0 {
                    let piece = Delta(checks: min(delta.checks, 1_000_000), used: min(delta.used, 1_000_000), viewed: min(delta.viewed, 1_000_000))
                    items.append(.feature(feature, variant, piece))
                    delta.checks -= piece.checks; delta.used -= piece.used; delta.viewed -= piece.viewed
                    if items.count > 2_000 { return [] }
                }
            }
        }
        for key in metrics.keys.sorted() {
            guard let metric = metrics[key] else { continue }
            switch metric {
            case .counter(var value):
                repeat {
                    let piece = min(value, 1_000_000)
                    items.append(.metric(key, Double(piece)))
                    value -= piece
                } while value > 0 && items.count <= 2_000
            case .gauge(let value): items.append(.metric(key, value))
            }
            if items.count > 2_000 { return [] }
        }
        var result: [Batch] = []
        var featureMap: [String: [String: [Int64]]] = [:]
        var metricMap: [String: Double] = [:]
        var entryCount = 0
        func encode() -> Data? {
            var object = header
            if !featureMap.isEmpty { object["f"] = featureMap }
            if !metricMap.isEmpty { object["m"] = metricMap }
            return try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        }
        func finish() {
            if entryCount > 0, let data = encode() { result.append(Batch(data: data, entries: entryCount, createdAt: createdAt,
                metricKinds: Dictionary(uniqueKeysWithValues: metricMap.keys.map { key in
                    let counter: Bool
                    if case .counter? = metrics[key] { counter = true } else { counter = false }
                    return (key, counter)
                }))) }
            featureMap = [:]; metricMap = [:]; entryCount = 0
        }
        for item in items {
            func insert() {
                switch item {
                case .feature(let key, let variant, let delta): featureMap[key, default: [:]][variant] = delta.values
                case .metric(let key, let value): metricMap[key] = value
                }
                entryCount += 1
            }
            let collision: Bool
            switch item {
            case .feature(let key, let variant, _):
                collision = featureMap[key]?[variant] != nil || (featureMap[key]?.count ?? 0) >= 16
            case .metric(let key, _): collision = metricMap[key] != nil
            }
            if collision { finish() }
            let priorFeatures = featureMap
            let priorMetrics = metricMap
            let priorCount = entryCount
            insert()
            if (encode()?.count ?? Int.max) > 49_152 || entryCount > 2_000 {
                featureMap = priorFeatures; metricMap = priorMetrics; entryCount = priorCount
                finish()
                insert()
            }
            if (encode()?.count ?? Int.max) > 49_152 { return [] }
        }
        finish()
        return result
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
            if !disposed, let compressed = try? compressor(batch.data) {
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
        // Preserve the in-flight envelope and at most one final pending envelope.
        let final = makeBatches().first
        features = [:]; metrics = [:]; pendingCreatedAt = nil
        if flushTask != nil {
            queued = Array(queued.prefix(1))
            if let final { queued.append(final) }
        } else {
            queued = Array(queued.prefix(1))
            if queued.isEmpty, let final { queued = [final] }
            flushTask = Task { await drain() }
        }
    }
}
