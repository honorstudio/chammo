// 문서 E2E 용 시스템 WKWebView — 화면 밖 창(사용자 화면에 안 뜸, 가림 감지 끔)에 진짜 NSEvent 마우스·편집 명령(copy:·paste:)을 단계대로 넣는다.
// wk <url> <steps.json> — 결과는 한 줄씩 "R <json>". 클립보드는 시작 때 담아 두고 끝나면 되돌린다.
// 단계: {"js": "..."} 결과 출력 / {"xy": "js → [x,y,…]"} 좌표 담기(마우스 단계에 번호로) / {"wait": 초} / {"move"|"down"|"up": 번호|[x,y], "clicks": n}
//       {"cmd": "copy"|"paste"|"cut"} / {"pb": 1} 클립보드 종류·글 출력 / {"pbset": {"plain": 글}} 클립보드에 맨 글
//       {"key": 키코드, "chars": 글자, "mods": ["shift"|"cmd"]} 키 누름·뗌
import AppKit
import WebKit
var fakeButtons = 0
let blk: @convention(block) (AnyObject) -> Int = { _ in fakeButtons }
method_setImplementation(class_getClassMethod(NSEvent.self, #selector(getter: NSEvent.pressedMouseButtons))!, imp_implementationWithBlock(blk))
let a = CommandLine.arguments
let steps = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: a[2]))) as! [[String: Any]]
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
app.appearance = NSAppearance(named: .aqua)
class KeyWin: NSWindow { override var canBecomeKey: Bool { true } }
let W: CGFloat = 900, H: CGFloat = 700
let win = KeyWin(contentRect: NSRect(x: -6000, y: -6000, width: W, height: H), styleMask: [.borderless], backing: .buffered, defer: false)
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: W, height: H), configuration: WKWebViewConfiguration())
let occ = Selector(("_setWindowOcclusionDetectionEnabled:"))
if web.responds(to: occ) { typealias F = @convention(c) (AnyObject, Selector, Bool) -> Void; unsafeBitCast(web.method(for: occ), to: F.self)(web, occ, false) }
win.contentView = web
win.orderFrontRegardless(); win.makeKey(); win.makeFirstResponder(web)
web.load(URLRequest(url: URL(string: a[1])!))
let pb = NSPasteboard.general
let saved = (pb.pasteboardItems ?? []).map { it in it.types.compactMap { t in it.data(forType: t).map { (t, $0) } } }
func restorePB() { pb.clearContents(); let items = saved.map { pairs -> NSPasteboardItem in let it = NSPasteboardItem(); for (t, d) in pairs { it.setData(d, forType: t) }; return it }; if !items.isEmpty { pb.writeObjects(items) } }
func out(_ v: Any) { if let d = try? JSONSerialization.data(withJSONObject: ["v": v]), let s = String(data: d, encoding: .utf8) { print("R " + s); fflush(stdout) } }
var P: [Double] = []
func pt(_ v: Any?) -> [Double]? { if let a = v as? [Double] { return a }; if let k = v as? Int, P.count >= 2 * k + 2 { return [P[2 * k], P[2 * k + 1]] }; return nil }
var evn = 0
func key(_ code: UInt16, _ chars: String, _ mods: NSEvent.ModifierFlags, _ up: Bool) {
  let e = NSEvent.keyEvent(with: up ? .keyUp : .keyDown, location: .zero, modifierFlags: mods, timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: win.windowNumber, context: nil, characters: chars, charactersIgnoringModifiers: chars, isARepeat: false, keyCode: code)!
  if up { web.keyUp(with: e) } else { web.keyDown(with: e) }
}
func mouse(_ t: NSEvent.EventType, _ p: [Double], _ clicks: Int) {
  evn += 1
  let e = NSEvent.mouseEvent(with: t, location: NSPoint(x: p[0], y: Double(H) - p[1]), modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                             windowNumber: win.windowNumber, context: nil, eventNumber: evn, clickCount: clicks, pressure: t == .leftMouseUp ? 0 : 1)!
  switch t { case .leftMouseDown: web.mouseDown(with: e); case .leftMouseDragged: web.mouseDragged(with: e); default: web.mouseUp(with: e) }
}
func js(_ s: String, _ done: @escaping (Any?) -> Void) {
  web.callAsyncJavaScript(s, arguments: [:], in: nil, in: .page) { r in switch r { case .success(let v): done(v); case .failure(let e): done("ERR \(e)") } }
}
var i = 0
func next() {
  if i >= steps.count { restorePB(); exit(0) }
  let s = steps[i]; i += 1
  let clicks = (s["clicks"] as? Int) ?? 1
  if let v = s["js"] as? String { js(v) { r in out(r ?? NSNull()); next() }; return }
  if let v = s["xy"] as? String { js(v) { r in P = (r as? [Any])?.compactMap { ($0 as? NSNumber)?.doubleValue } ?? []; next() }; return }
  if let v = s["wait"] as? Double { DispatchQueue.main.asyncAfter(deadline: .now() + v) { next() }; return }
  // 버튼 안 누른 이동도 끌기 사건으로 — 화면 밖·비활성 창은 mouseMoved 를 페이지에 안 넘긴다(누른 단추 0 이라 hover 와 같다)
  if let v = pt(s["move"]) { mouse(.leftMouseDragged, v, clicks) }
  if let v = pt(s["down"]) { fakeButtons = 1; mouse(.leftMouseDown, v, clicks) }
  if let v = pt(s["drag"]) { mouse(.leftMouseDragged, v, clicks) }
  if let v = pt(s["up"]) { fakeButtons = 0; mouse(.leftMouseUp, v, clicks) }
  if let v = s["cmd"] as? String { _ = NSApp.sendAction(Selector(v + ":"), to: web, from: nil) }
  if let v = s["key"] as? Int {
    var m: NSEvent.ModifierFlags = []
    for x in (s["mods"] as? [String]) ?? [] { if x == "shift" { m.insert(.shift) }; if x == "cmd" { m.insert(.command) } }
    let ch = (s["chars"] as? String) ?? ""
    key(UInt16(v), ch, m, false); key(UInt16(v), ch, m, true)
  }
  if let v = s["pbset"] as? [String: String] { pb.clearContents(); pb.setString(v["plain"] ?? "", forType: .string) }
  if s["pb"] != nil { var m: [String: String] = [:]; for it in pb.pasteboardItems ?? [] { for t in it.types { m[t.rawValue] = it.string(forType: t) ?? "<bin>" } }; out(m) }
  DispatchQueue.main.asyncAfter(deadline: .now() + ((s["gap"] as? Double) ?? 0.05)) { next() }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { next() }
DispatchQueue.main.asyncAfter(deadline: .now() + 90) { restorePB(); print("시간 넘김"); exit(2) }
app.run()
