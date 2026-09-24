import Combine
import SwiftUI
import TogglyCore
import TogglySwiftUI
import TogglyCombine
#if canImport(UIKit)
import TogglyUIKit
#endif

@MainActor
final class HostOwner: ObservableObject {
    static let shared = HostOwner()
    @Published var result = "starting"
    private var subscriptions = Set<AnyCancellable>()
    private let options = ProcessInfo.processInfo.arguments
    let service: TogglyService

    private init() {
        let key: String? = options.contains("--keyless") ? nil : "local-apple-fixture"
        service = TogglyService(config: TogglyConfig(
            appKey: key, environment: "Fixture",
            baseURI: "http://127.0.0.1:8766/base",
            identity: "private-user", featureDefaults: ["On": true, "Off": false],
            refreshInterval: 0, verifySignatures: false,
            enableVariants: options.contains("--variants"),
            enableLiveUpdates: false,
            enableTelemetry: !options.contains("--optout"),
            metricsBaseUrl: "http://127.0.0.1:8766/base",
            telemetryFlushIntervalMs: 60_000))
    }

    func run() async {
        _ = await service.initialize()
        await service.registerContext("Order") { entity in
            let color = (entity as? String) ?? "red"
            return TogglyEntityContext(kind: "Order", key: "local-order", attributes: ["Color": color])
        }
        let direct = await service.isFeatureOn("On")
        let off = await service.isFeatureOff("Off")
        let any = await service.evaluateFeatureGate(featureKeys: ["Off", "On"], requirement: .any)
        let negated = await service.evaluateFeatureGate(featureKeys: ["Off"], negate: true)
        let local = await service.isEnabled("OrderGate")
        let entity = await service.isEnabled("OrderGate", context: "blue", kind: "Order")
        #if canImport(UIKit)
        let uikit = await FeatureFlagAsync.isEnabled("On", service: service)
        #else
        let uikit = true
        #endif
        let publisher = await service.featureFlagPublisher("On")
        publisher.sink { value in print("ACCEPTANCE combine=\(value)") }.store(in: &subscriptions)
        let variant = await service.getVariant("Checkout")
        let variantValue = await service.getVariantValue("Checkout")
        print("ACCEPTANCE direct=\(direct) off=\(off) any=\(any) negate=\(negated) local=\(local) entity=\(entity) uikit=\(uikit) variant=\(variant?.name ?? "nil") value=\(String(describing: variantValue))")
        result = "direct:\(direct) off:\(off) any:\(any) negate:\(negated) local:\(local) entity:\(entity) uikit:\(uikit) variant:\(variant?.name ?? "nil")"
        await service.recordUsage("Checkout", variant: variant?.name ?? "sample")
        await service.recordView("Checkout", variant: variant?.name ?? "sample")
        await service.incrementCounter("orders", value: 2)
        await service.setGauge("cart", value: 3.5)
        await service.flushTelemetry()
        print("ACCEPTANCE flushed")
        if options.contains("--identity") { await replaceIdentity() }
        if options.contains("--dispose") { await dispose() }
        if options.contains("--pending-background") {
            await service.recordUsage("Checkout", variant: "background")
            result = "pending-background"
        }
    }

    func replaceIdentity() async {
        _ = await service.setIdentity("next-user")
        await service.recordUsage("Checkout", variant: "after-identity")
        await service.flushTelemetry()
        result = "identity-replaced"
    }

    func onPhase(_ phase: ScenePhase) async {
        switch phase {
        case .background: await service.setAppState(.background)
        case .active: await service.setAppState(.active)
        default: break
        }
        print("ACCEPTANCE phase=\(phase)")
    }

    func dispose() async {
        await service.recordView("Checkout", variant: "dispose")
        await service.dispose()
        subscriptions.removeAll()
        result = "disposed"
        print("ACCEPTANCE disposed")
    }
}

struct HostView: View {
    @StateObject private var owner = HostOwner.shared
    @FeatureFlag("On", service: HostOwner.shared.service) private var swiftUIOn
    @FeatureVariant("Checkout", service: HostOwner.shared.service) private var swiftUIVariant
    @Environment(\.scenePhase) private var phase

    var body: some View {
        VStack {
            Text("Public Apple telemetry host")
            Text(owner.result).accessibilityIdentifier("result")
            Text("SwiftUI:\(String(swiftUIOn)) Variant:\(swiftUIVariant?.name ?? "nil")")
            FeatureView("On", service: owner.service) {
                Text("enabled").accessibilityIdentifier("enabled")
            } else: {
                Text("disabled")
            }
            Button("Replace identity") { Task { await owner.replaceIdentity() } }
            Button("Dispose") { Task { await owner.dispose() } }
        }
        .task { await owner.run() }
        .onChange(of: phase) { newPhase in Task { await owner.onPhase(newPhase) } }
    }
}

@main
struct PublicAppleHostApp: App {
    var body: some Scene { WindowGroup { HostView() } }
}
