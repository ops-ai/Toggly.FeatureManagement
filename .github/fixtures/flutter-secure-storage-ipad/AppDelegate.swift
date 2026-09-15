import Flutter
import UIKit
import Security

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var probeChannel: FlutterMethodChannel?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "Ops1187KeychainProbe")!
    probeChannel = FlutterMethodChannel(name: "ops1187.keychain", binaryMessenger: registrar.messenger())
    probeChannel?.setMethodCallHandler { call, result in
      if call.method == "log", let line = call.arguments as? String {
        fputs(line + "\n", stderr)
        fflush(stderr)
        result(nil)
        return
      }
      guard call.method == "protected" else { result(FlutterMethodNotImplemented); return }
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "ops1187.ipad.verified",
        kSecAttrAccount as String: "host.unrelated",
        kSecReturnAttributes as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne
      ]
      var item: CFTypeRef?
      let status = SecItemCopyMatching(query as CFDictionary, &item)
      let attributes = item as? [String: Any]
      // Returns only a boolean; no key data, access group, or device identifiers.
      result(status == errSecSuccess &&
        attributes?[kSecAttrAccessible as String] as? String == kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String)
    }
  }
}
