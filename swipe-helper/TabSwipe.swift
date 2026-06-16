// TabSwipe - three-finger swipe left/right to switch Chrome tabs.
// Companion helper for the TabView extension. Reads raw trackpad touches via the
// private MultitouchSupport framework (browser pages never receive these events,
// so this cannot live inside the extension itself) and posts Ctrl+Tab /
// Ctrl+Shift+Tab when Chrome is the frontmost app.
//
// Build: ./build.sh   Run: open TabSwipe.app
// Flags: --fingers N (default 3), --natural (invert direction), --verbose

import Cocoa
import ApplicationServices

// MARK: - MultitouchSupport private framework bindings

typealias MTDeviceRef = UnsafeMutableRawPointer

struct MTPoint { var x: Float = 0; var y: Float = 0 }
struct MTVector { var position = MTPoint(); var velocity = MTPoint() }
struct MTTouch {
    var frame: Int32 = 0
    var timestamp: Double = 0
    var identifier: Int32 = 0
    var state: Int32 = 0
    var fingerID: Int32 = 0
    var handID: Int32 = 0
    var normalized = MTVector()
    var zTotal: Float = 0
    var field9: Int32 = 0
    var angle: Float = 0
    var majorAxis: Float = 0
    var minorAxis: Float = 0
    var absolute = MTVector()
    var field14: Int32 = 0
    var field15: Int32 = 0
    var zDensity: Float = 0
}

typealias MTContactCallback = @convention(c) (
    UnsafeMutableRawPointer?, UnsafeMutableRawPointer?, Int32, Double, Int32
) -> Int32
typealias MTDeviceCreateListFn = @convention(c) () -> Unmanaged<CFArray>
typealias MTRegisterContactFrameCallbackFn = @convention(c) (MTDeviceRef, MTContactCallback) -> Void
typealias MTDeviceStartFn = @convention(c) (MTDeviceRef, Int32) -> Void

// MARK: - Config

var fingerCount = 3
var natural = false
var verbose = false

var argIter = CommandLine.arguments.dropFirst().makeIterator()
while let arg = argIter.next() {
    switch arg {
    case "--fingers": if let v = argIter.next(), let n = Int(v) { fingerCount = n }
    case "--natural": natural = true
    case "--verbose": verbose = true
    default: break
    }
}

// MARK: - Sensitivity config (live-reloaded from disk; edit via tabswipe-config.py)
// threshold: fraction of trackpad width the fingers must travel for one switch.
// minSpeed : minimum travel speed in width-fractions/second. A swipe is a fast
//            flick; a deliberate three-finger DRAG is slow, so a speed floor lets
//            both coexist. 0 disables the speed gate (distance only).
struct SwipeConfig {
    var threshold: Float = 0.20
    var minSpeed: Float = 0.0
}
var config = SwipeConfig()

let configPath = NSString(string: "~/Library/Application Support/TabSwipe/config.json")
    .expandingTildeInPath
var configMTime: Double = -1

func loadConfig() {
    let fm = FileManager.default
    guard let attrs = try? fm.attributesOfItem(atPath: configPath),
          let mtime = (attrs[.modificationDate] as? Date)?.timeIntervalSince1970 else { return }
    if mtime == configMTime { return }   // unchanged since last load
    configMTime = mtime
    guard let data = fm.contents(atPath: configPath),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
    if let t = obj["threshold"] as? Double { config.threshold = Float(t) }
    if let s = obj["minSpeed"] as? Double { config.minSpeed = Float(s) }
    if let f = obj["fingers"] as? Int { fingerCount = f }
    if verbose { print("config: threshold=\(config.threshold) minSpeed=\(config.minSpeed) fingers=\(fingerCount)") }
}

let browserBundleIDs: Set<String> = [
    "com.google.Chrome",
    "com.google.Chrome.beta",
    "com.google.Chrome.dev",
    "com.google.Chrome.canary",
]

// On/off flag written by the native-messaging host when the user toggles the
// "Tab Swipe" item in the TabView extension's right-click menu. Missing == on.
let flagPath = NSString(string: "~/Library/Application Support/TabSwipe/enabled")
    .expandingTildeInPath

func swipeEnabled() -> Bool {
    guard let s = try? String(contentsOfFile: flagPath, encoding: .utf8) else { return true }
    return s.trimmingCharacters(in: .whitespacesAndNewlines) != "0"
}

// MARK: - Tab switching

enum SwipeDirection { case left, right }

func frontmostIsBrowser() -> Bool {
    guard let bid = NSWorkspace.shared.frontmostApplication?.bundleIdentifier else { return false }
    return browserBundleIDs.contains(bid)
}

func postCtrlTab(shift: Bool) {
    let src = CGEventSource(stateID: .hidSystemState)
    let tabKey: CGKeyCode = 48
    var flags: CGEventFlags = .maskControl
    if shift { flags.insert(.maskShift) }
    guard let down = CGEvent(keyboardEventSource: src, virtualKey: tabKey, keyDown: true),
          let up = CGEvent(keyboardEventSource: src, virtualKey: tabKey, keyDown: false) else { return }
    down.flags = flags
    up.flags = flags
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
}

func fireSwipe(_ direction: SwipeDirection) {
    guard frontmostIsBrowser() else {
        if verbose { print("swipe \(direction) ignored, Chrome not frontmost") }
        return
    }
    // swipe right -> tab to the right (Ctrl+Tab); --natural inverts
    let goRight = (direction == .right) != natural
    postCtrlTab(shift: !goRight)
    if verbose { print("swipe \(direction) -> \(goRight ? "next" : "previous") tab") }
}

// MARK: - Gesture detection (globals: callback is a C function pointer, single touch thread)

var gestureActive = false
var gestureAllowed = true
var anchorX: Float = 0
var anchorTime: Double = 0

let touchCallback: MTContactCallback = { _, touchesRaw, numTouches, ts, _ in
    guard let touchesRaw else { return 0 }
    let n = Int(numTouches)
    let touches = touchesRaw.bindMemory(to: MTTouch.self, capacity: max(n, 1))
    if n == fingerCount {
        var sum: Float = 0
        for i in 0..<n { sum += touches[i].normalized.position.x }
        let avg = sum / Float(n)
        if !gestureActive {
            gestureActive = true
            anchorX = avg
            anchorTime = ts
            gestureAllowed = swipeEnabled()   // check the on/off flag once per gesture
            loadConfig()                      // pick up any sensitivity change
        } else if gestureAllowed {
            let dx = avg - anchorX
            if abs(dx) >= config.threshold {
                let dt = ts - anchorTime
                let speed = dt > 0 ? abs(dx) / Float(dt) : Float.greatestFiniteMagnitude
                if speed >= config.minSpeed {
                    fireSwipe(dx > 0 ? .right : .left)
                }
                if verbose {
                    print("dx=\(dx) speed=\(speed)/s thr=\(config.threshold) min=\(config.minSpeed) -> \(speed >= config.minSpeed ? "FIRE" : "ignore (too slow = drag)")")
                }
                // Re-anchor whether or not it fired, so a slow drag keeps resetting
                // its baseline instead of slowly accumulating into a trigger.
                anchorX = avg
                anchorTime = ts
            }
        }
    } else {
        gestureActive = false
    }
    return 0
}

// MARK: - Startup

if ProcessInfo.processInfo.environment["TABSWIPE_NO_PROMPT"] == nil {
    let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    if !AXIsProcessTrustedWithOptions(opts) {
        print("Accessibility permission needed to send tab-switch keystrokes.")
        print("Grant it in System Settings > Privacy & Security > Accessibility, then relaunch.")
    }
}

guard let handle = dlopen(
    "/System/Library/PrivateFrameworks/MultitouchSupport.framework/MultitouchSupport", RTLD_NOW
) else {
    fatalError("Could not load MultitouchSupport framework")
}
guard let createListSym = dlsym(handle, "MTDeviceCreateList"),
      let registerSym = dlsym(handle, "MTRegisterContactFrameCallback"),
      let startSym = dlsym(handle, "MTDeviceStart") else {
    fatalError("Could not resolve MultitouchSupport symbols")
}

let createList = unsafeBitCast(createListSym, to: MTDeviceCreateListFn.self)
let register = unsafeBitCast(registerSym, to: MTRegisterContactFrameCallbackFn.self)
let start = unsafeBitCast(startSym, to: MTDeviceStartFn.self)

let deviceList = createList().takeRetainedValue()
let deviceCount = CFArrayGetCount(deviceList)
guard deviceCount > 0 else {
    print("No multitouch devices found. If you have a trackpad, grant Input Monitoring")
    print("in System Settings > Privacy & Security and relaunch.")
    exit(1)
}

for i in 0..<deviceCount {
    let dev = MTDeviceRef(mutating: CFArrayGetValueAtIndex(deviceList, i)!)
    register(dev, touchCallback)
    start(dev, 0)
}

loadConfig()
print("TabSwipe listening on \(deviceCount) trackpad(s), \(fingerCount)-finger swipe, threshold \(config.threshold), minSpeed \(config.minSpeed)")
RunLoop.main.run()
