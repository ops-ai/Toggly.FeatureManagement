// Test-only macOS guardian. Retained NSRunningApplication objects survive loss
// of the Node launcher's later ps inventory; no caller-supplied PID is trusted.
import AppKit
import Darwin

// A dead Node parent must not terminate the guardian before native cleanup.
signal(SIGPIPE, SIG_IGN)

func normalized(_ path: String) -> String { path.replacingOccurrences(of: "/private/var/", with: "/var/") }
let root = normalized(URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath().path)
let bundle = normalized(URL(fileURLWithPath: CommandLine.arguments[2]).resolvingSymlinksInPath().path)
let lifetime = Double(CommandLine.arguments[3])!
let ownDirectory = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
func finish(_ status: Int32) -> Never {
    // A dead Node parent cannot remove the guardian's private compiled image.
    // Derive this exact directory from our executable, never from caller data.
    var result = status
    if ownDirectory.lastPathComponent.hasPrefix("toggly-electron-native-owner-") {
        do { try FileManager.default.removeItem(at: ownDirectory) }
        catch { fputs("Native guardian directory cleanup failed\n", stderr); if result == 0 { result = 3 } }
    }
    exit(result)
}

func arguments(_ pid: pid_t) -> [String] {
    var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
    var size = 0
    guard sysctl(&mib, UInt32(mib.count), nil, &size, nil, 0) == 0 else { return [] }
    var data = [UInt8](repeating: 0, count: size)
    guard sysctl(&mib, UInt32(mib.count), &data, &size, nil, 0) == 0, size > 4 else { return [] }
    let argc = data.withUnsafeBytes { $0.loadUnaligned(as: Int32.self) }
    var offset = 4
    while offset < size && data[offset] != 0 { offset += 1 }
    while offset < size && data[offset] == 0 { offset += 1 }
    var result: [String] = []
    while offset < size && result.count < argc {
        let start = offset
        while offset < size && data[offset] != 0 { offset += 1 }
        result.append(String(decoding: data[start..<offset], as: UTF8.self))
        offset += 1
    }
    return result
}

struct Owner {
    let app: NSRunningApplication
    let birth: Date
    let executable: URL
}
var owners: [pid_t: Owner] = [:]
var retiring = false
var retirementDeadline: Date?
var emptySince: Date?
let started = Date()

func discover() {
    for app in NSWorkspace.shared.runningApplications {
        guard let executable = app.executableURL?.resolvingSymlinksInPath(),
              normalized(executable.path).hasPrefix(bundle + "/Contents/"),
              let birth = app.launchDate, birth >= started.addingTimeInterval(-1),
              !app.isTerminated else { continue }
        let installedHere = bundle.hasPrefix(root + "/")
        let scopedArgument = arguments(app.processIdentifier).map(normalized).contains { arg in
            arg == root || arg.hasPrefix(root + "/") || arg.hasSuffix("=" + root) || arg.contains("=" + root + "/")
        }
        guard installedHere || scopedArgument else { continue }
        if owners[app.processIdentifier]?.birth != birth {
            owners[app.processIdentifier] = Owner(app: app, birth: birth, executable: executable)
            print("OWNED \(app.processIdentifier)"); fflush(stdout)
        }
    }
}
func retire() {
    if !retiring { retiring = true; retirementDeadline = Date().addingTimeInterval(10) }
}
func tick() {
    discover()
    if Date().timeIntervalSince(started) >= lifetime { retire() }
    guard retiring else { return }
    var living = 0
    for (pid, owner) in owners {
        // Retained application identity plus a fresh native birth/executable
        // check prevents signaling a reused PID. No ps or marker-file lookup.
        guard !owner.app.isTerminated,
              let current = NSRunningApplication(processIdentifier: pid),
              !current.isTerminated,
              current.launchDate == owner.birth,
              current.executableURL?.resolvingSymlinksInPath() == owner.executable else { continue }
        living += 1
        _ = owner.app.forceTerminate()
    }
    if living == 0 {
        if emptySince == nil { emptySince = Date() }
        // Drain launch notifications and allow Chromium helpers to observe the
        // terminated parent's IPC endpoint before the guardian exits.
        if Date().timeIntervalSince(emptySince!) >= 0.3 { finish(0) }
    } else { emptySince = nil }
    if Date() >= retirementDeadline! { fputs("Native owner retirement exceeded deadline\n", stderr); finish(3) }
}

let observer = NSWorkspace.shared.notificationCenter.addObserver(
    forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main
) { _ in tick() }
FileHandle.standardInput.readabilityHandler = { handle in
    let data = handle.availableData
    if data.isEmpty { handle.readabilityHandler = nil }
    DispatchQueue.main.async { retire() }
}
let timer = Timer.scheduledTimer(withTimeInterval: 0.02, repeats: true) { _ in tick() }
print("READY"); fflush(stdout)
RunLoop.main.run()
