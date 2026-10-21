// 붙이기 상태 계산(attach.swift Attacher.state) 시험 — 앱 빌드엔 안 들어간다. 돌리기:
//   swiftc -parse-as-library tools/craft-mirror/attach.swift tools/craft-mirror/tests/attach_test.swift -o /tmp/attach-test && /tmp/attach-test
import AppKit

@main
struct AttachTest {
    static func main() {
        var failed = false
        func check(_ c: Bool, _ m: String) { print(c ? "ok  " : "FAIL", m); if !c { failed = true } }
        let r = CGRect(x: -3000.4, y: 1100.6, width: 900.2, height: 600)
        var s = Attacher.state(rect: r, shown: true, windowVisible: true, frontPid: 10, me: 10, target: 20, lock: true, parent: 5)
        check(s.visible && s.front && s.lock && s.parent == 5, "칸 보이고 Chammo 가 앞 → 붙임·떠 있는 층")
        check(s.rect == r.integral, "자리는 정수로")
        s = Attacher.state(rect: r, shown: true, windowVisible: true, frontPid: 20, me: 10, target: 20, lock: false, parent: 5)
        check(s.front, "붙인 앱이 앞이어도 떠 있는 층")
        s = Attacher.state(rect: r, shown: true, windowVisible: true, frontPid: 99, me: 10, target: 20, lock: true, parent: 5)
        check(s.visible && !s.front, "다른 앱이 앞 → 보통 층")
        s = Attacher.state(rect: r, shown: false, windowVisible: true, frontPid: 10, me: 10, target: 20, lock: true, parent: 5)
        check(!s.visible, "칸이 숨거나 덮이면 뗀다")
        s = Attacher.state(rect: r, shown: true, windowVisible: false, frontPid: 10, me: 10, target: 20, lock: true, parent: 5)
        check(!s.visible, "Chammo 창이 가려지거나 내려가면 뗀다")
        s = Attacher.state(rect: CGRect(x: 0, y: 0, width: 30, height: 600), shown: true, windowVisible: true, frontPid: 10, me: 10, target: 20, lock: true, parent: 5)
        check(!s.visible, "칸이 너무 작으면 뗀다")
        s = Attacher.state(rect: nil, shown: true, windowVisible: true, frontPid: 10, me: 10, target: 20, lock: true, parent: 5)
        check(!s.visible, "자리를 모르면 뗀다")
        exit(failed ? 1 : 0)
    }
}
