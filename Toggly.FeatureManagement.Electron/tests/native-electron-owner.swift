// Test-only macOS supervisor owns admission, the command and native retirement.
// The unreaped child pins its PID/group; native apps retain launch identity.
import AppKit
import Darwin

// A dead Node parent must not terminate the guardian before native cleanup.
signal(SIGPIPE, SIG_IGN)

func normalized(_ path: String) -> String { path.replacingOccurrences(of: "/private/var/", with: "/var/") }
let root = normalized(URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath().path)
let bundle = normalized(URL(fileURLWithPath: CommandLine.arguments[2]).resolvingSymlinksInPath().path)
let lifetime = Double(CommandLine.arguments[3])!
struct Launch: Decodable { let command: String; let args: [String]; let token: String }
let launch = try JSONDecoder().decode(Launch.self, from: Data(contentsOf: ownConfigURL()))
func ownConfigURL() -> URL { URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().appendingPathComponent("launch.json") }
func event(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print("\n\(launch.token)\(String(decoding: data, as: UTF8.self))"); fflush(stdout)
}
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
var commandPID: pid_t = 0
var commandReaped = false
var admitted = false
var commandResult: [String: Any]?
// waitid(WNOWAIT) observes completion without releasing PID/group ownership.
// The child is reaped only after its group is signaled and native cleanup ends.
func commandExited() -> Bool {
    guard commandPID != 0, !commandReaped else { return true }
    var info = siginfo_t()
    if waitid(P_PID, id_t(commandPID), &info, WEXITED | WNOHANG | WNOWAIT) != 0 {
        fputs("Cannot observe retained command\n", stderr); retire(); return false
    }
    guard info.si_pid == commandPID else { return false }
    if commandResult == nil {
        commandResult = info.si_code == CLD_EXITED ? ["code": info.si_status] : ["signal": info.si_status]
        event(["exit": commandResult!])
    }
    return true
}
func admit() {
    guard !retiring, !admitted else { return }
    admitted = true
    var attributes: posix_spawnattr_t?
    var actions: posix_spawn_file_actions_t?
    posix_spawnattr_init(&attributes); posix_spawn_file_actions_init(&actions)
    defer { posix_spawnattr_destroy(&attributes); posix_spawn_file_actions_destroy(&actions) }
    posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETPGROUP))
    posix_spawnattr_setpgroup(&attributes, 0)
    // Never let a child retain the parent's liveness pipe.
    posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0)
    let argv = ([launch.command] + launch.args).map { strdup($0) } + [nil]
    let envp = ProcessInfo.processInfo.environment.map { strdup("\($0.key)=\($0.value)") } + [nil]
    defer { argv.forEach { free($0) }; envp.forEach { free($0) } }
    guard chdir(root) == 0 else { event(["launchError": "chdir failed"]); retire(); return }
    let code = argv.withUnsafeBufferPointer { args in envp.withUnsafeBufferPointer { env in
        posix_spawnp(&commandPID, launch.command, &actions, &attributes, args.baseAddress!, env.baseAddress!)
    } }
    if code != 0 {
        commandPID = 0
        event(["launchError": code == ENOENT ? "ENOENT" : String(cString: strerror(code))]); retire()
    } else { event(["admitted": commandPID]) }
}
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
    if admitted && commandExited() { retire() }
    guard retiring else { return }
    // commandPID is our own, still-unreaped child, never a caller/marker PID.
    // Retire launch authority before considering an empty native inventory.
    let exitedBeforeSignal = commandExited()
    if commandPID != 0 && !commandReaped {
        // macOS returns EPERM for a group containing only our unreaped zombie.
        // A live retained child must never use that exception.
        if kill(-commandPID, SIGKILL) != 0 && errno != ESRCH && !(errno == EPERM && exitedBeforeSignal) {
            fputs("Cannot retire retained command group\n", stderr); finish(3)
        }
    }
    let commandClosed = commandExited()
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
    if living == 0 && commandClosed {
        if emptySince == nil { emptySince = Date() }
        // Drain launch notifications and allow Chromium helpers to observe the
        // terminated parent's IPC endpoint before the guardian exits.
        if Date().timeIntervalSince(emptySince!) >= 0.3 {
            if commandPID != 0 {
                var status: Int32 = 0
                guard waitpid(commandPID, &status, 0) == commandPID else { finish(3) }
                commandReaped = true
            }
            finish(0)
        }
    } else { emptySince = nil }
    if Date() >= retirementDeadline! { fputs("Native owner retirement exceeded deadline\n", stderr); finish(3) }
}

let observer = NSWorkspace.shared.notificationCenter.addObserver(
    forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main
) { _ in tick() }
FileHandle.standardInput.readabilityHandler = { handle in
    let data = handle.availableData
    if data.isEmpty { handle.readabilityHandler = nil }
    DispatchQueue.main.async {
        if data.isEmpty { retire() }
        else if String(decoding: data, as: UTF8.self).contains("GO\n") { admit() }
        else { retire() }
    }
}
let timer = Timer.scheduledTimer(withTimeInterval: 0.02, repeats: true) { _ in tick() }
event(["ready": true])
RunLoop.main.run()
