// chammo-vdisplay — 세션 크롬을 띄울 눈에 안 보이는 가짜 화면(2026-10-03 사용자 "가상 모니터 개지린다").
// 이 프로세스가 살아 있는 동안만 화면이 있다: 입력(stdin)이 닫히거나(=앱이 꺼짐) SIGTERM 이면 지우고 끝난다.
//   chammo-vdisplay --probe            → 이 macOS 에서 되나(0 = 됨, 3 = 비공개 API 없음)
//   chammo-vdisplay [--width W --height H] [--hidpi] [--name 이름] [--vendor N] [--serial N]
//     --hidpi = 같은 점 크기에 2배 픽셀(레티나) — Craft 맥 앱 비추기 전용 화면(10/16, vendor 를 앱 화면 0x4348 과 다르게: 같으면 맥이 앞 화면을 뺀다)
//     → 만들고 한 줄 JSON {"displayID":…,"bounds":[x,y,w,h]} 을 찍은 뒤 입력이 닫힐 때까지 산다
// 자리: 지금 화면들 전체 네모의 오른쪽 아래 모서리에 모서리만 닿게 — 변을 맞대지 않아 마우스가 넘어갈 길이 거의 없다.
// 배치는 이번 로그인만(forSession) — 재시동하면 흔적 없음
import Foundation
import CoreGraphics

func out(_ o: [String: Any]) {
  if let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) { print(s); fflush(stdout) }
}
let args = CommandLine.arguments
func arg(_ k: String, _ d: Int) -> Int { if let i = args.firstIndex(of: k), i + 1 < args.count, let v = Int(args[i + 1]) { return v }; return d }

let available = NSClassFromString("CGVirtualDisplay") != nil && NSClassFromString("CGVirtualDisplayDescriptor") != nil
if args.contains("--test") { exit(selfTest()) }
if args.contains("--probe") { out(["available": available]); exit(available ? 0 : 3) }
guard available else { out(["error": "no CGVirtualDisplay"]); exit(3) }

func displays() -> [(CGDirectDisplayID, CGRect)] {
  var n: UInt32 = 0
  CGGetActiveDisplayList(0, nil, &n)
  var ids = [CGDirectDisplayID](repeating: 0, count: Int(n))
  CGGetActiveDisplayList(n, &ids, &n)
  return ids.map { ($0, CGDisplayBounds($0)) }
}

let w = arg("--width", 1440), h = arg("--height", 900)
let hidpi = args.contains("--hidpi")
func sarg(_ k: String, _ d: String) -> String { if let i = args.firstIndex(of: k), i + 1 < args.count { return args[i + 1] }; return d }
let before = displays()
let desc = CGVirtualDisplayDescriptor()
desc.queue = DispatchQueue.global(qos: .userInitiated)
desc.name = sarg("--name", "Chammo agents")
desc.maxPixelsWide = UInt32(hidpi ? w * 2 : w)
desc.maxPixelsHigh = UInt32(hidpi ? h * 2 : h)
desc.sizeInMillimeters = CGSize(width: Double(w) * 0.26, height: Double(h) * 0.26)
desc.productID = UInt32(arg("--vendor", 0x4348))
desc.vendorID = UInt32(arg("--vendor", 0x4348))
desc.serialNum = UInt32(arg("--serial", 1))
desc.terminationHandler = { _, _ in exit(0) }
guard let display = CGVirtualDisplay(descriptor: desc) else { out(["error": "create failed"]); exit(4) }
let settings = CGVirtualDisplaySettings()
settings.hiDPI = hidpi ? 1 : 0
settings.modes = hidpi
  ? [CGVirtualDisplayMode(width: UInt32(w), height: UInt32(h), refreshRate: 60)!, CGVirtualDisplayMode(width: UInt32(w * 2), height: UInt32(h * 2), refreshRate: 60)!]
  : [CGVirtualDisplayMode(width: UInt32(w), height: UInt32(h), refreshRate: 60)!]
guard display.apply(settings) else { out(["error": "applySettings failed"]); exit(5) }
let id = display.displayID

func others() -> [CGRect] { displays().filter { $0.0 != id }.map { $0.1 } }

/// 자리 — 실제 화면 바깥 모서리 한 점, 핫코너 구석은 피해서(place.swift pickOrigin). 이미 그 자리면 안 건드린다(재구성 콜백이 다시 부르므로)
func place() {
  let dock = UserDefaults(suiteName: "com.apple.dock")
  let size = CGSize(width: CGDisplayBounds(id).width, height: CGDisplayBounds(id).height)
  guard let o = pickOrigin(others(), size: size, hot: hotCorners { dock?.integer(forKey: $0) ?? 0 }) else { return }
  let b = CGDisplayBounds(id)
  if b.origin == o { return }
  var cfg: CGDisplayConfigRef?
  guard CGBeginDisplayConfiguration(&cfg) == .success, let cfg = cfg else { return }
  CGConfigureDisplayOrigin(cfg, id, Int32(o.x), Int32(o.y))
  CGCompleteDisplayConfiguration(cfg, .forSession)
}
func report() {
  let b = CGDisplayBounds(id)
  out(["displayID": Int(id), "bounds": [Int(b.minX), Int(b.minY), Int(b.width), Int(b.height)]])
}
place()
Thread.sleep(forTimeInterval: 0.5)
let moved = before.filter { (bid, r) in CGDisplayBounds(bid) != r }.map { Int($0.0) }
let b0 = CGDisplayBounds(id)
out(["displayID": Int(id), "bounds": [Int(b0.minX), Int(b0.minY), Int(b0.width), Int(b0.height)], "othersMoved": moved])

// 화면 배치가 바뀌면(외장 모니터 빠짐·꽂힘·해상도) 다시 모서리 한 점에 — 맥이 가짜 화면을 남은 화면 변에 붙여 버린다
var pending = false
CGDisplayRegisterReconfigurationCallback({ _, flags, _ in
  if flags.contains(.beginConfigurationFlag) || pending { return }
  pending = true
  DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { pending = false; place(); report() }
}, nil)

// 커서 막이 — 커서가 안 보이는 가짜 화면에 들어가면 바로 보이는 화면 안으로(권한 필요 없는 CGWarpMouseCursorPosition)
let guardTimer = DispatchSource.makeTimerSource(queue: .main)
guardTimer.schedule(deadline: .now(), repeating: .milliseconds(16))
guardTimer.setEventHandler {
  guard let p = CGEvent(source: nil)?.location, let q = rescue(p, virtual: CGDisplayBounds(id), others: others()) else { return }
  CGWarpMouseCursorPosition(q)
  CGAssociateMouseAndMouseCursorPosition(1)
}
guardTimer.resume()

// 창 수 — 5초마다 {"windows":n}(일반 창, 가려진·최소화한 것도). 앱이 0 이 2분 이어지면 화면을 내린다(10/20 유니버설 컨트롤 커서가 갇힘)
let countTimer = DispatchSource.makeTimerSource(queue: .main)
countTimer.schedule(deadline: .now() + 1, repeating: .seconds(5))
countTimer.setEventHandler {
  let list = (CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]]) ?? []
  let rects = list.compactMap { w -> CGRect? in
    guard (w[kCGWindowLayer as String] as? Int) == 0, let b = w[kCGWindowBounds as String] as? NSDictionary else { return nil }
    return CGRect(dictionaryRepresentation: b as CFDictionary)
  }
  out(["windows": windowsInside(rects, CGDisplayBounds(id))])
}
countTimer.resume()

// 입력이 닫히면(앱이 꺼짐) 끝 — 프로세스가 끝나면 가짜 화면도 사라진다
signal(SIGTERM) { _ in exit(0) }
signal(SIGINT) { _ in exit(0) }
// 입력 줄 'scale 1|2' — 레티나 화면을 살린 채 배율만 바꾼다(같은 점 크기, 창은 그 자리 그대로). Chammo 창이 있는 화면 배율을 따라가려고(10/16 사용자:
// 1배 외장 모니터에서 2배 화면을 비추면 앱 캔버스가 진짜 앱의 절반 크기로 보였다 — 앱 배율이 기기 픽셀 기준이라)
func setScale(_ want: Int) {
  let opts = [kCGDisplayShowDuplicateLowResolutionModes: kCFBooleanTrue] as CFDictionary
  guard hidpi, let modes = CGDisplayCopyAllDisplayModes(id, opts) as? [CGDisplayMode],
        let m = modes.first(where: { $0.width == w && $0.height == h && $0.pixelWidth == w * want }) else { out(["error": "no mode for scale \(want)"]); return }
  var cfg: CGDisplayConfigRef?
  guard CGBeginDisplayConfiguration(&cfg) == .success, let cfg = cfg else { return }
  CGConfigureDisplayWithDisplayMode(cfg, id, m, nil)
  CGCompleteDisplayConfiguration(cfg, .forSession)
  report()
}
// 입력 줄 'linger <pid> …' — Chammo 가 꺼질 때 저장 중인 Craft 앱 pid. 입력이 닫혀도 그 앱들이 저장하고 꺼질 때까지(최대 5분) 화면을 살려 둔다 —
// 안 그러면 화면이 먼저 사라져 저장 중인 창이 사람 화면으로 튀었다(2026-10-19 끄기 QA)
var lingering: [pid_t] = []
DispatchQueue.global().async {
  while let line = readLine() {
    let p = line.split(separator: " ")
    if p.count == 2, p[0] == "scale", let n = Int(p[1]), n == 1 || n == 2 { DispatchQueue.main.async { setScale(n) } }
    if let pids = lingerPids(line) { lingering = pids }
  }
  let end = Date().addingTimeInterval(300)
  while Date() < end && lingering.contains(where: { kill($0, 0) == 0 }) { usleep(300_000) }
  exit(0)
}
withExtendedLifetime(display) { CFRunLoopRun() }
