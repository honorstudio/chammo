// 아이맥 진짜 입력기 시험 창 — 문서 편집기 묶음(doc-table 하네스 정적 빌드)을 보이는 WKWebView 에 띄우고, 두벌식 키 코드를 이 프로세스에만 넣는다
// (CGEvent postToPid — 시스템 전체 키가 아니라서 아이맥 진짜 Chammo 로 새지 않는다). 키는 입력기(지금 고른 한글 2벌식)를 그대로 거친다.
// imac-probe <url> <steps.json> <out.json> — 단계: {"js": "..."} / {"keys": "qwerty 글자들", "gap": 초} / {"key": 키코드} / {"wait": 초}
// 끝나면 out.json 에 결과 줄을 쓰고 창을 남겨 둔다(캡처용) — 부른 쪽이 끈다
import AppKit
import Carbon
import WebKit

let a = CommandLine.arguments
let steps = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: a[2]))) as! [[String: Any]]
let app = NSApplication.shared
app.setActivationPolicy(.regular)
class KeyWin: NSWindow { override var canBecomeKey: Bool { true } }
let win = KeyWin(contentRect: NSRect(x: 80, y: 120, width: 900, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
win.title = "ime-probe"
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 900, height: 700), configuration: WKWebViewConfiguration())
win.contentView = web
web.load(URLRequest(url: URL(string: a[1])!))
var results: [Any] = []
// 두벌식 자판 자리(QWERTY 글자 → 키 코드)
let codes: [Character: UInt16] = ["a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
  "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45, "m": 46, " ": 49]
// CGEvent 를 이 프로세스에만(postToPid) — 합성 NSEvent(postEvent)는 입력기를 안 거쳐 영문 그대로 들어갔다(11-17 실측)
let source = CGEventSource(stateID: .hidSystemState)
let KBD = Int(ProcessInfo.processInfo.environment["KBD"] ?? "40") ?? 40
func post(_ code: UInt16, _ ch: String) {
  for down in [true, false] {
    guard let e = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { continue }
    e.setIntegerValueField(.keyboardEventKeyboardType, value: Int64(KBD)) // 사람 키보드처럼 키보드 종류를 싣는다
    e.postToPid(getpid())
  }
}
func js(_ s: String, _ done: @escaping (Any?) -> Void) {
  web.callAsyncJavaScript(s, arguments: [:], in: nil, in: .page) { r in switch r { case .success(let v): done(v); case .failure(let e): done("ERR \(e)") } }
}
func src() -> String { let s = TISCopyCurrentKeyboardInputSource().takeRetainedValue(); return (Unmanaged<CFString>.fromOpaque(TISGetInputSourceProperty(s, kTISPropertyInputSourceID)).takeUnretainedValue() as String) }
var i = 0
func finish() {
  let d = try! JSONSerialization.data(withJSONObject: ["input": src(), "results": results])
  try! d.write(to: URL(fileURLWithPath: a[3]))
  print("DONE")
  fflush(stdout)
}
func next() {
  if i >= steps.count { finish(); return }
  let s = steps[i]; i += 1
  // 단계마다 다시 활성화하면 입력기 상태가 끊겨 첫 음절이 'ㄱㅔ'로 풀렸다(11-17) — 앞 앱이 아닐 때만
  if !NSApp.isActive { NSApp.activate(ignoringOtherApps: true); win.makeKeyAndOrderFront(nil) }
  if let v = s["js"] as? String { js(v) { r in results.append(r ?? NSNull()); next() }; return }
  if let v = s["wait"] as? Double { DispatchQueue.main.asyncAfter(deadline: .now() + v) { next() }; return }
  let gap = (s["gap"] as? Double) ?? 0.1
  if let v = s["key"] as? Int { post(UInt16(v), v == 36 ? "\r" : v == 48 ? "\t" : ""); DispatchQueue.main.asyncAfter(deadline: .now() + gap) { next() }; return }
  if let v = s["keys"] as? String {
    var t = 0.0
    for c in v { let code = codes[c]!; DispatchQueue.main.asyncAfter(deadline: .now() + t) { post(code, String(c)) }; t += gap }
    DispatchQueue.main.asyncAfter(deadline: .now() + t + 0.05) { next() }
    return
  }
  next()
}
NSApp.activate(ignoringOtherApps: true)
win.makeKeyAndOrderFront(nil)
DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { next() }
DispatchQueue.main.asyncAfter(deadline: .now() + 240) { finish(); exit(2) }
app.run()
