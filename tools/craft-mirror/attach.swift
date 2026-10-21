// craft-mirror attach — 다른 앱 창을 이 앱 창의 칸 자리에 '붙인다'(2026-10-21 시험, docs/plans/craft-attach.md).
// 맥은 다른 프로세스 창을 자식 창으로 못 붙이고, 그 창의 층·순서는 그 앱만 바꿀 수 있다 — 그래서 여기선 칸 자리(전역 왼쪽 위 기준 점)·
// 보임·앞(이 앱이나 붙인 앱이 활성)·잠금을 계산해 바뀔 때만 sink 에 넘기고, 옮기기는 sink 가 그 앱에 맞는 길로 한다
// (참모 앱 = 조작 채널 ui.window.attach, 나중에 세션 크롬). 앱 종류는 모른다
import AppKit

struct AttachState: Equatable {
    var rect: CGRect   // 칸 자리 — 전역 점, 주 화면 왼쪽 위 0,0
    var visible: Bool  // 붙일까(칸이 보이고 창이 보이고 덮이지 않음)
    var front: Bool    // 이 앱이나 붙인 앱이 활성 — 떠 있는 층, 아니면 보통 층으로 부모 창 바로 위
    var lock: Bool     // 사람 입력을 막나(참모가 다루는 중)
    var parent: Int    // 부모 창 번호(이 앱 창)
}

final class Attacher {
    weak var view: NSView?
    let pid: pid_t
    let sink: (AttachState) -> Void
    /// 웹이 알려 준 칸 보임(탭이 뒤로·팝오버가 덮음이면 false)
    var shown = false { didSet { push() } }
    var lock = true { didSet { push() } }
    private(set) var last: AttachState?
    private var frontPid: pid_t?
    private var obs: [(NotificationCenter, NSObjectProtocol)] = []

    init(view: NSView, pid: pid_t, shown: Bool, sink: @escaping (AttachState) -> Void) {
        self.view = view
        self.pid = pid
        self.sink = sink
        self.shown = shown
        defer { flush() }
        let nc = NotificationCenter.default, ws = NSWorkspace.shared.notificationCenter
        if let w = view.window {
            for n in [NSWindow.didMoveNotification, NSWindow.didResizeNotification, NSWindow.didChangeOcclusionStateNotification,
                      NSWindow.didMiniaturizeNotification, NSWindow.didDeminiaturizeNotification, NSWindow.didChangeScreenNotification] {
                obs.append((nc, nc.addObserver(forName: n, object: w, queue: .main) { [weak self] _ in self?.push() }))
            }
        }
        view.postsFrameChangedNotifications = true
        obs.append((nc, nc.addObserver(forName: NSView.frameDidChangeNotification, object: view, queue: .main) { [weak self] _ in self?.push() }))
        // 앞 앱이 바뀌면 층을 바꾼다 — 이 앱·붙인 앱이 앞이면 떠 있는 층, 다른 앱이 앞이면 보통 층(그 앱 위에 뜨지 않게)
        // 앞 앱은 알림이 준 앱으로 기억한다 — frontmostApplication 을 바로 읽으면 바뀌기 전 값이 나와 다른 앱이 앞인데 떠 있는 층에 남았다(10/21 실측)
        frontPid = NSWorkspace.shared.frontmostApplication?.processIdentifier
        obs.append((ws, ws.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] n in
            if let app = n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication { self?.frontPid = app.processIdentifier }
            self?.push()
        }))
    }

    /// 뷰 자리 → 전역 점(주 화면 왼쪽 위 0,0)
    static func globalRect(of v: NSView) -> CGRect? {
        guard let w = v.window else { return nil }
        let r = w.convertToScreen(v.convert(v.bounds, to: nil))
        let top = NSScreen.screens.first?.frame.height ?? 0
        return CGRect(x: r.minX, y: top - r.maxY, width: r.width, height: r.height)
    }

    /// 지금 붙일 상태 — 같으면 안 보낸다
    static func state(rect: CGRect?, shown: Bool, windowVisible: Bool, frontPid: pid_t?, me: pid_t, target: pid_t, lock: Bool, parent: Int) -> AttachState {
        guard let r = rect else { return AttachState(rect: .zero, visible: false, front: false, lock: lock, parent: parent) }
        let front = frontPid == me || frontPid == target
        let visible = shown && windowVisible && r.width >= 40 && r.height >= 40
        return AttachState(rect: r.integral, visible: visible, front: front, lock: lock, parent: parent)
    }

    func current() -> AttachState {
        let w = view?.window
        // 붙인 동안엔 가림(occlusion)을 안 본다 — 붙인 창도 Chammo 창을 가려서, 나머지가 다른 앱에 덮이면 붙였다 뗐다를 되풀이했다(리뷰).
        // 전체 화면이면 안 붙인다 — 다른 앱 창은 그 스페이스에 못 들어간다
        let attached = last?.visible == true
        let winVisible = w.map { $0.isVisible && !$0.isMiniaturized && !$0.styleMask.contains(.fullScreen) && (attached || $0.occlusionState.contains(.visible)) } ?? false
        return Attacher.state(rect: view.flatMap(Attacher.globalRect), shown: shown, windowVisible: winVisible,
                              frontPid: frontPid, me: getpid(), target: pid, lock: lock, parent: w?.windowNumber ?? 0)
    }

    private var queued = false
    /// 알림마다 부른다 — 한 프레임(16ms) 안의 것은 마지막 하나로 모은다(창 끌기 걸음마다 명령이 나갔다, 리뷰)
    func push() {
        guard !queued else { return }
        queued = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.016) { [weak self] in
            self?.queued = false
            self?.flush()
        }
    }

    private var stopped = false

    func flush() {
        guard !stopped else { return }  // 뗀 뒤 늦게 도는 모아 보내기가 다시 붙이지 않게
        let s = current()
        guard s != last else { return }
        // 안 보이는 동안 자리만 바뀐 건 보내지 않는다(떼어 둔 창을 또 옮기지 않게)
        if let l = last, !l.visible, !s.visible { last = s; return }
        last = s
        sink(s)
    }

    /// 떼기 — 붙어 있었으면 안 보임을 한 번 넘기고 알림을 끊는다
    func stop() {
        stopped = true
        for (c, o) in obs { c.removeObserver(o) }
        obs = []
        if var s = last, s.visible {
            s.visible = false
            last = s
            sink(s)
        }
    }
}
