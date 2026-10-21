// craft-mirror — 다른 앱(Craft 맥 앱, 가짜 화면 위) 창 하나를 Chammo 창 안에 비춘다.
// ScreenCaptureKit 으로 그 창만 받아 프레임 IOSurface 를 그대로 CALayer.contents 에(복사·인코딩 없음, 10/16 스파이크: 명령→보임 44ms·CPU 1~5%).
// build.rs 가 정적 라이브러리로 빌드해 앱에 링크한다(앱 → C 함수 셋). 모두 메인 스레드에서 부른다.
//   craft_mirror_attach(NSWindow*, pid, 위 여백, 아래 여백) → 손잡이(없으면 nil) · craft_mirror_place(손잡이, x,y,w,h, 웹 innerHeight, 보임) — 스페이스 탭 칸에 얹기
//   craft_mirror_status(손잡이) → 0 기다림 · 1 비추는 중 · 2 화면 기록 권한 없음 · 3 그 앱 창 없음 · 4 멈춤
//   craft_mirror_detach(손잡이) — 받기를 멈추고 뷰를 뗀다
//   craft_mirror_point(손잡이, 이름들 JSON, 글) — 참모 손: 그 앱 손쉬운 사용 트리에서 이름으로 자리를 찾아 파란 손이 옮겨 가며 누르는 연출(실제 누름은 조작 채널)
//   craft_mirror_input(손잡이, 켬) · craft_mirror_set_input(손잡이, 콜백, ctx) — 개입: 켜면 비추기 칸 입력을 조작 채널 명령 JSON 으로 콜백에(끄면 잠금)
import AppKit
import ApplicationServices
import CoreImage
import CoreMedia
import QuartzCore
import ScreenCaptureKit

/// 비추기 뷰 — 개입 중이면 마우스·키를 비친 앱에 넘기고, 아니면 막고(잠금) 마우스를 올리면 안내 한 줄
/// 개입 입력을 앱(Rust)에 넘기는 C 함수 — (앱 손잡이, 조작 채널 명령 JSON)
public typealias CraftInputCB = @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>?) -> Void

final class MirrorView: NSView {
    weak var mirror: Mirror?
    var input = false { didSet { hint.isHidden = true; window?.invalidateCursorRects(for: self) } }
    let hint = CATextLayer()
    override var acceptsFirstResponder: Bool { input }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .mouseMoved, .activeAlways, .inVisibleRect], owner: self))
    }
    func showHint(_ on: Bool) {
        guard let layer else { return }
        if hint.superlayer !== layer {
            hint.string = Mirror.lockText
            hint.fontSize = 13; hint.font = NSFont.systemFont(ofSize: 13)
            hint.foregroundColor = NSColor(white: 0.9, alpha: 1).cgColor
            hint.backgroundColor = NSColor(red: 0.11, green: 0.11, blue: 0.13, alpha: 0.94).cgColor
            hint.cornerRadius = 10; hint.alignmentMode = .center; hint.contentsScale = 2; hint.zPosition = 20
            layer.addSublayer(hint)
        }
        let w = (Mirror.lockText as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 13)]).width + 32
        CATransaction.begin(); CATransaction.setDisableActions(true)
        hint.frame = CGRect(x: (bounds.width - w) / 2, y: 22, width: w, height: 30)
        hint.isHidden = !on || input
        CATransaction.commit()
    }
    override func mouseEntered(with e: NSEvent) { showHint(!input) }
    override func mouseExited(with e: NSEvent) { showHint(false) }
    override func mouseDown(with e: NSEvent) {
        if mirror?.handing == true { mirror?.activateApp(); return }  // 진짜 창을 넘겨준 동안 — 칸을 누르면 그 앱을 다시 앞으로
        if input { window?.makeFirstResponder(self); mirror?.forward(e, in: self) }
    }
    override func mouseUp(with e: NSEvent) { if input { mirror?.forward(e, in: self) } }
    override func mouseDragged(with e: NSEvent) { if input { mirror?.forward(e, in: self) } }
    override func mouseMoved(with e: NSEvent) { if input { mirror?.forward(e, in: self) } }
    override func rightMouseDown(with e: NSEvent) { if input { mirror?.forward(e, in: self) } }
    override func rightMouseUp(with e: NSEvent) { if input { mirror?.forward(e, in: self) } }
    override func scrollWheel(with e: NSEvent) { if input { mirror?.forward(e, in: self) } }
    override func keyDown(with e: NSEvent) { if input { mirror?.forward(e, in: self) } else { super.keyDown(with: e) } }
    override func keyUp(with e: NSEvent) { if input { mirror?.forward(e, in: self) } else { super.keyUp(with: e) } }
    override func flagsChanged(with e: NSEvent) { if input { mirror?.forward(e, in: self) } }
}

final class Mirror: NSObject, SCStreamOutput, SCStreamDelegate {
    static var lockText = "참모가 다루는 중 — 직접 만지려면 머리줄의 개입"
    let view = MirrorView()
    var stream: SCStream?
    var status: Int32 = 0
    var pid: pid_t = 0
    var srcFrame = CGRect.zero  // 비추는 앱 창 자리(전역 점 좌표) — 참모 손 자리 바꾸기
    var scale: CGFloat = 1
    var fitWork: DispatchWorkItem?
    var frameObs: NSObjectProtocol?
    var occObs: NSObjectProtocol?
    var paused = false  // 창이 안 보이면(가려짐·내려감·다른 데스크톱) 받기를 멈춘다 — 안 보는 동안 부하 0
    weak var window: NSWindow?
    let hand = Hand()

    init(window: NSWindow, pid: pid_t, top: CGFloat, bottom: CGFloat) {
        super.init()
        guard let content = window.contentView else { status = 4; return }
        // 웹뷰 옆(같은 부모)에 — Tauri 창은 웹뷰가 제목줄 밑까지 깔려 있어(10/16 실측 웹 748 · 내용 716) 자리는 contentLayoutRect 로
        let web = Mirror.findWeb(content) ?? content
        let host = web === content ? content : (web.superview ?? content)
        // 제목줄 아래 실제 내용 자리(창 좌표) → host 좌표. 웹뷰 프레임도 제목줄 밑까지 깔려 있을 수 있다
        let b = host.convert(window.contentLayoutRect, from: nil)
        let flipped = host.isFlipped
        view.frame = NSRect(x: b.minX, y: flipped ? b.minY + top : b.minY + bottom, width: b.width, height: max(0, b.height - top - bottom))
        view.autoresizingMask = [.width, .height]
        view.mirror = self
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor(calibratedWhite: 0.12, alpha: 1).cgColor
        view.layer?.contentsGravity = .resizeAspect
        view.isHidden = true  // 첫 프레임 전엔 숨긴다 — 그동안 웹 칸의 안내(권한·창 없음)가 보인다
        host.addSubview(view, positioned: .above, relativeTo: nil)
        // 보는 칸 크기 = 앱 창 크기(10/16 사용자 "비좁아터졌다") — 칸이 바뀌면 가짜 화면 속 앱 창도 같은 크기로(축소 비추기 아님)
        view.postsFrameChangedNotifications = true
        self.window = window
        occObs = NotificationCenter.default.addObserver(forName: NSWindow.didChangeOcclusionStateNotification, object: window, queue: .main) { [weak self] _ in self?.occlusionChanged() }
        frameObs = NotificationCenter.default.addObserver(forName: NSView.frameDidChangeNotification, object: view, queue: .main) { [weak self] _ in self?.scheduleFit() }
        if !CGPreflightScreenCaptureAccess() { status = 2; return }
        SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: false) { [weak self] content, _ in
            DispatchQueue.main.async { self?.start(content: content, pid: pid) }
        }
    }

    /// 창 안 WKWebView(머리줄·아래 줄을 그리는 웹) — 없으면 nil
    static func findWeb(_ v: NSView) -> NSView? {
        if let cls = NSClassFromString("WKWebView"), v.isKind(of: cls) { return v }
        for s in v.subviews { if let w = findWeb(s) { return w } }
        return nil
    }

    func start(content: SCShareableContent?, pid: pid_t) {
        guard let content else { status = 2; return }
        let wins = content.windows.filter { $0.owningApplication?.processID == pid && $0.frame.width > 300 }
        guard let w = wins.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) else { status = 3; return }
        self.pid = pid
        // 먼저 앱 창을 칸 크기로 — 그다음 그 크기로 받는다
        srcFrame = fitSource(to: view.bounds.size) ?? w.frame
        let filter = SCContentFilter(desktopIndependentWindow: w)
        capFilter = filter
        scale = CGFloat(filter.pointPixelScale)
        let cfg = config(srcFrame.size, slow: false)
        let s = SCStream(filter: filter, configuration: cfg, delegate: self)
        do {
            // 큐 이름은 scripts/release-check 가 실행 파일에서 찾는 표 — 비추기가 링크됐는지
            try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: DispatchQueue(label: "chammo.craft-mirror.frames"))
        } catch { status = 4; return }
        stream = s
        s.startCapture { [weak self] err in
            // 받기가 시작되기 전에 칸 크기가 바뀌었으면(새 창이 기본 크기로 커질 때) 그 맞추기는 건너뛰었다 — 한 번 더
            DispatchQueue.main.async { self?.status = err == nil ? 1 : 2; if err == nil { self?.scheduleFit(); self?.watchDrift(); self?.startAttach() } }
        }
    }

    func stream(_ s: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen,
              let atts = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let raw = atts.first?[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete,
              let px = CMSampleBufferGetImageBuffer(sb), let surf = CVPixelBufferGetIOSurface(px)?.takeUnretainedValue() else { return }
        // egui 앱은 안 바뀌어도 매 프레임 창 전체를 다시 그린다(dirtyRects = 창 전체, 10/16 실측) — 거친 표본으로 같은지 본다.
        // 같으면 안 그리고, 0.5초 넘게 같으면 받기를 초당 6장으로, 바뀌면 바로 60장으로(가만있을 때 WindowServer 부하)
        let sig = Mirror.signature(px)
        if sig == lastSig {
            still += 1
            if still == 30 && !slow { setRate(slow: true) }
            return
        }
        lastSig = sig
        still = 0
        if slow { setRate(slow: false) }
        DispatchQueue.main.async { [weak self] in
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            self?.view.layer?.contents = surf
            CATransaction.commit()
            if self?.hostHidden == false { self?.view.isHidden = false }
        }
    }

    var lastSig: [UInt32] = []
    var still = 0
    var slow = false

    /// 48x30 격자 픽셀 — 안 바뀐 프레임 알아보기(전체 비교보다 수백 배 싸다)
    static func signature(_ px: CVPixelBuffer) -> [UInt32] {
        CVPixelBufferLockBaseAddress(px, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(px, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(px) else { return [] }
        let w = CVPixelBufferGetWidth(px), h = CVPixelBufferGetHeight(px), bpr = CVPixelBufferGetBytesPerRow(px)
        var out = [UInt32](); out.reserveCapacity(48 * 30)
        for gy in 0..<30 { for gx in 0..<48 {
            out.append(base.load(fromByteOffset: (gy * h / 30) * bpr + (gx * w / 48) * 4, as: UInt32.self))
        } }
        return out
    }

    func setRate(slow s: Bool) {
        slow = s
        guard let st = stream else { return }
        st.updateConfiguration(config(srcFrame.size, slow: s || attachedNow), completionHandler: nil)  // 붙인 동안엔 밑 비추기는 느리게만
    }

    func stream(_ s: SCStream, didStopWithError error: Error) {
        DispatchQueue.main.async { self.status = 4 }
    }

    /// 창이 보이게 됐나·안 보이게 됐나 — 안 보이면 받기를 멈추고, 다시 보이면 이어 받는다
    func occlusionChanged() { updatePause() }

    /// 받기 멈춤 = 창이 가려졌거나 웹이 칸을 숨겼을 때(스페이스 탭이 뒤로·모달이 덮음) — 안 보는 동안 부하 0
    func updatePause() {
        guard let s = stream, let w = window else { return }
        let off = !w.occlusionState.contains(.visible) || hostHidden
        if off && !paused {
            paused = true
            s.stopCapture(completionHandler: nil)
        } else if !off && paused {
            paused = false
            s.startCapture(completionHandler: nil)
        }
    }

    /// 스페이스 탭 칸에 얹기 — 웹이 알려 준 자리(웹뷰 왼쪽 위 기준 CSS 점)와 보이는지. 따로 창은 이걸 안 부르고 창을 꽉 채운다
    var hostHidden = false
    func place(_ r: CGRect, vh: CGFloat, visible: Bool) {
        guard let host = view.superview else { return }
        let web = Mirror.findWeb(host) ?? host
        let wf = web === host ? host.bounds : web.frame
        view.autoresizingMask = []
        // 웹뷰는 제목줄 밑까지 깔려 있고 CSS 0 은 제목줄 아래다(10/16 실측 28점 위로 밀림) — 웹뷰 높이와 innerHeight 의 차이만큼 내린다
        let inset = vh > 0 ? max(0, wf.height - vh) : 0
        let y = host.isFlipped ? wf.minY + inset + r.minY : wf.maxY - inset - r.minY - r.height
        let f = NSRect(x: wf.minX + r.minX, y: y, width: max(0, r.width), height: max(0, r.height))
        if f != view.frame { view.frame = f }
        hostHidden = !visible || r.width < 40 || r.height < 40
        if hostHidden { view.isHidden = true } else if view.layer?.contents != nil { view.isHidden = false }
        updatePause()
        attacher?.shown = !hostHidden
    }

    /// 마지막 프레임을 JPEG 로 — 덮개(팝오버)가 칸을 덮어 비추기를 숨길 때 웹이 그 자리에 그림으로 깐다(검은 칸 대신)
    func still(to path: String) -> Bool {
        guard let obj = view.layer?.contents, CFGetTypeID(obj as CFTypeRef) == IOSurfaceGetTypeID() else { return false }
        let ci = CIImage(ioSurface: unsafeBitCast(obj as AnyObject, to: IOSurfaceRef.self))
        guard let cg = CIContext(options: [.useSoftwareRenderer: false]).createCGImage(ci, from: ci.extent),
              let data = NSBitmapImageRep(cgImage: cg).representation(using: .jpeg, properties: [.compressionFactor: 0.82]) else { return false }
        return (try? data.write(to: URL(fileURLWithPath: path))) != nil
    }

    /// 칸 크기가 바뀌었다 — 끌어서 바꾸는 동안은 기다렸다가(0.15초) 한 번
    /// 앱이 스스로 창 크기를 바꾸는지 지켜보기(1초마다, 보는 중일 때만) — 큰 문서를 열거나 창 제목이 바뀌며 앱이 창을 줄이면
    /// 칸 크기와 어긋나 가운데 여백이 생겼다(10/16 실사용 1000x14310 PSD). 어긋나면 다시 칸 크기로, 칸 크기마다 세 번까지(앱이 거절하면 그만)
    var driftTimer: Timer?
    var driftTries = 0
    var handing = false      // 개입 — 진짜 창을 사람 화면 칸 자리에 넘겨준 동안
    var homeFrame: CGRect?   // 돌려놓을 자리(Craft 가짜 화면)
    var homeScale: CGFloat?  // 돌려놓을 때 받기 배율
    var attacher: Attacher?  // 붙이기 모드(시험) — 진짜 창을 칸 자리에
    var attachHome: CGRect?  // 붙이기 전 자리(Craft 가짜 화면) — 뗄 때 돌려놓는다
    var capFilter: SCContentFilter?  // 받기를 다시 만들 때(붙이기 모드는 붙인 동안 받기를 버린다)
    var stopping = false
    var moveObs: NSObjectProtocol?
    func watchDrift() {
        driftTimer?.invalidate()
        driftTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in self?.checkDrift() }
    }

    /// 그 자리(전역 왼쪽 위 기준 점)가 있는 화면 배율
    static func screenScale(_ r: CGRect) -> CGFloat? {
        let top = NSScreen.screens.first?.frame.height ?? 0
        let p = NSPoint(x: r.midX, y: top - r.midY)
        return NSScreen.screens.first { $0.frame.contains(p) }?.backingScaleFactor
    }

    func checkDrift() {
        guard status == 1, !paused, !view.isHidden, !handing, !attachedNow else { return }
        guard let cur = Mirror.cgFrame(pid) else { return }
        // Craft 화면 배율이 바뀌었으면(Chammo 창이 1배·2배 화면을 오갈 때) 받기 픽셀도 — 안 바꾸면 그림이 작게·흐리게 그려진다
        if let sc = Mirror.screenScale(cur), sc != scale, let s = stream {
            scale = sc
            s.updateConfiguration(config(srcFrame.size, slow: false), completionHandler: nil)
        }
        if Mirror.drifted(cur.size, srcFrame.size), driftTries < 3 {
            driftTries += 1
            refit()
        }
    }

    /// 앱 창 크기가 우리가 맞춘 크기와 어긋났나(2점 넘게)
    static func drifted(_ now: CGSize, _ fitted: CGSize) -> Bool {
        abs(now.width - fitted.width) > 2 || abs(now.height - fitted.height) > 2
    }

    func scheduleFit() {
        driftTries = 0  // 칸 크기가 바뀌었다 — 다시 세 번까지
        if handing { moveToStage(); return }  // 넘겨준 동안엔 진짜 창이 칸을 따라간다
        if attachedNow { return }  // 붙인 동안엔 진짜 창이 칸 자리·크기(Attacher 가 옮긴다)
        fitWork?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.refit() }
        fitWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: w)
    }

    func refit() {
        guard status == 1, !attachedNow, let s = stream else { return }  // 붙인 동안엔 창이 칸 자리 — 가짜 화면 왼쪽 위로 끌고 가지 않게
        guard let f = fitSource(to: view.bounds.size) else { return }
        srcFrame = f
        canvas = nil  // 창 크기가 바뀌면 캔버스 자리도 바뀐다 — 다음 누를 때 다시
        s.updateConfiguration(config(f.size, slow: slow), completionHandler: nil)
    }

    /// 받기 설정 — 창 점 크기 × 화면 배율, 바뀌지 않는 동안은 초당 6장(slow)·바뀌면 60장
    func config(_ size: CGSize, slow: Bool) -> SCStreamConfiguration {
        let cfg = SCStreamConfiguration()
        cfg.width = Int(size.width * scale)
        cfg.height = Int(size.height * scale)
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: slow ? 6 : 60)
        cfg.queueDepth = 4
        cfg.showsCursor = false
        cfg.pixelFormat = kCVPixelFormatType_32BGRA
        return cfg
    }

    /// 앱 창(손쉬운 사용)을 그 크기로 — 자기 화면 왼쪽 위에 붙이고 화면보다 크면 줄인다. 실제 자리를 돌려준다
    func fitSource(to size: CGSize) -> CGRect? {
        guard size.width > 50, size.height > 50, Mirror.axOK() else { return nil }
        let app = AXUIElementCreateApplication(pid)
        var v: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &v) == .success, let wins = v as? [AXUIElement] else { return nil }
        func frame(_ e: AXUIElement) -> CGRect? {
            var pv: CFTypeRef?, sv: CFTypeRef?
            guard AXUIElementCopyAttributeValue(e, kAXPositionAttribute as CFString, &pv) == .success,
                  AXUIElementCopyAttributeValue(e, kAXSizeAttribute as CFString, &sv) == .success else { return nil }
            var p = CGPoint.zero, z = CGSize.zero
            AXValueGetValue(pv as! AXValue, .cgPoint, &p); AXValueGetValue(sv as! AXValue, .cgSize, &z)
            return CGRect(origin: p, size: z)
        }
        guard let win = wins.max(by: { (frame($0)?.width ?? 0) * (frame($0)?.height ?? 0) < (frame($1)?.width ?? 0) * (frame($1)?.height ?? 0) }),
              let cur = frame(win) else { return nil }
        // 앱 창이 있는 화면(가짜 화면) — 그 안에서만
        var ids = [CGDirectDisplayID](repeating: 0, count: 4), n: UInt32 = 0
        CGGetDisplaysWithPoint(CGPoint(x: cur.midX, y: cur.midY), 4, &ids, &n)
        let screen = n > 0 ? CGDisplayBounds(ids[0]) : cur
        let want = CGSize(width: min(size.width, screen.width), height: min(size.height, screen.height - 40))
        // 자리는 그대로(맥이 화면 가장자리에서 창을 안쪽으로 붙인다) — 커져서 화면 밖으로 나가면 그때만 화면 왼쪽 위로
        if cur.minX + want.width > screen.maxX || cur.minY + want.height > screen.maxY {
            var origin = CGPoint(x: screen.minX, y: screen.minY + 30)
            if let pv = AXValueCreate(.cgPoint, &origin) { AXUIElementSetAttributeValue(win, kAXPositionAttribute as CFString, pv) }
        }
        var sz = want
        if let sv = AXValueCreate(.cgSize, &sz) { AXUIElementSetAttributeValue(win, kAXSizeAttribute as CFString, sv) }
        // AX 는 요청한 값을 돌려줄 때가 있다 — 실제 자리는 창 목록에서(10/16: AX -4830 · 실제 -4800, 누르기가 30pt 빗나감)
        return Mirror.cgFrame(pid) ?? frame(win)
    }

    /// 손쉬운 사용 허용이 있나 — 묻지 않고 보기만. 없을 때 AX 를 부르면 맥이 'Chammo 가 이 컴퓨터를 제어하려고 합니다' 창을 띄운다(10/19 사용자 "왜 자꾸 뜨는 거임")
    static func axOK() -> Bool { AXIsProcessTrustedWithOptions(nil) }

    /// 그 앱의 가장 큰 보통 창 자리(창 목록 = 실제 값)
    static func cgFrame(_ pid: pid_t) -> CGRect? {
        guard let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] else { return nil }
        return list.filter { ($0[kCGWindowOwnerPID as String] as? pid_t) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 }
            .compactMap { d -> CGRect? in
                guard let b = d[kCGWindowBounds as String] as? NSDictionary else { return nil }
                return CGRect(dictionaryRepresentation: b as CFDictionary)
            }
            .filter { $0.width > 300 }
            .max { $0.width * $0.height < $1.width * $1.height }
    }

    /// 비추기 뷰 점 → 원본 창 점(창 왼쪽 위 기준). 칸 밖(여백)이면 nil
    func toSource(_ v: CGPoint) -> CGPoint? {
        let vb = view.bounds, sw = max(srcFrame.width, 1), sh = max(srcFrame.height, 1)
        let k = min(vb.width / sw, vb.height / sh)
        let ox = (vb.width - sw * k) / 2, oy = (vb.height - sh * k) / 2
        let p = CGPoint(x: (v.x - ox) / k, y: (vb.height - v.y - oy) / k)
        return (p.x >= 0 && p.y >= 0 && p.x <= sw && p.y <= sh) ? p : nil
    }

    /// 개입 중 사람 입력 → 그 앱 조작 채널 명령 JSON({method, params}) — 앱(Rust)이 받아 인증된 연결로 보낸다.
    /// CGEvent 를 그 앱에 직접 보내면 이동만 닿고 누르기는 egui 가 버린다(10/16 세 가지로 실측) — ui.click 은 먹는다
    var inputCB: CraftInputCB?
    var inputCtx: UnsafeMutableRawPointer?
    var downAt: CGPoint?
    var lastMove = 0.0
    var lastDrag = 0.0
    var dragged = false
    var inCanvas = false
    var stroke: [CGPoint] = []
    var canvas: CGRect?  // 캔버스 자리(원본 창 점) — 개입을 켤 때 손쉬운 사용 트리에서
    let strokeLayer = CAShapeLayer()

    /// 끄는 길 미리보기 — 떼면 ui.pointer 로 한 번에 들어가니 그동안 덮개에 얇은 선(가볍다)
    func drawStroke() {
        guard let layer = view.layer else { return }
        if strokeLayer.superlayer !== layer {
            strokeLayer.strokeColor = NSColor(red: 0.30, green: 0.55, blue: 1, alpha: 0.9).cgColor
            strokeLayer.fillColor = nil
            strokeLayer.lineWidth = 2
            strokeLayer.lineDashPattern = [6, 4]
            strokeLayer.zPosition = 15
            layer.addSublayer(strokeLayer)
        }
        let path = CGMutablePath()
        for (i, p) in stroke.enumerated() { let v = toView(p); if i == 0 { path.move(to: v) } else { path.addLine(to: v) } }
        CATransaction.begin(); CATransaction.setDisableActions(true)
        strokeLayer.frame = layer.bounds
        strokeLayer.path = path
        CATransaction.commit()
    }

    /// 캔버스 자리(원본 창 점) — 손쉬운 사용 트리에서 창 안에 보이는 가장 큰 칸(참모 손 '@canvas' 와 같은 훑기)
    func canvasRect(tries: Int = 4) -> CGRect? {
        // AccessKit 은 처음 물을 때 켜져 첫 조회가 빈다 — 잠깐씩 다시(10/16 실사용: 캔버스를 몰라 끌기가 클릭 여러 번으로 갔다)
        for i in 0...tries {
            let c = axScan([]).canvas
            if c != .zero { return c.offsetBy(dx: -srcFrame.minX, dy: -srcFrame.minY) }
            if i < tries { Thread.sleep(forTimeInterval: 0.25) }
        }
        return nil
    }

    func send(_ method: String, _ params: [String: Any]) {
        guard let cb = inputCB, let d = try? JSONSerialization.data(withJSONObject: ["method": method, "params": params]),
              let s = String(data: d, encoding: .utf8) else { return }
        s.withCString { cb(inputCtx, $0) }
    }

    static let keyNames: [UInt16: String] = [36: "Enter", 76: "Enter", 48: "Tab", 51: "Backspace", 117: "Delete", 53: "Escape", 49: "Space",
                                             123: "ArrowLeft", 124: "ArrowRight", 125: "ArrowDown", 126: "ArrowUp", 116: "PageUp", 121: "PageDown", 115: "Home", 119: "End"]

    /// 글자 → egui 키 이름(문장 부호는 이름으로)
    static func keyName(_ c: String) -> String {
        let marks: [String: String] = ["[": "OpenBracket", "]": "CloseBracket", "-": "Minus", "=": "Equals", "+": "Plus", ",": "Comma", ".": "Period",
                                       "/": "Slash", ";": "Semicolon", "'": "Quote", "`": "Backtick", "\\": "Backslash", " ": "Space"]
        return marks[c] ?? c
    }

    func forward(_ e: NSEvent, in v: NSView) {
        let f = e.modifierFlags
        switch e.type {
        case .keyDown:
            let mods: [String: Any] = ["command": f.contains(.command), "shift": f.contains(.shift), "alt": f.contains(.option), "ctrl": f.contains(.control)]
            if let name = Mirror.keyNames[e.keyCode] {
                send("ui.key", ["key": name].merging(mods) { a, _ in a })
                if name == "Space" && !f.contains(.command) && !f.contains(.control) { send("ui.type", ["text": " "]) }  // 글 칸엔 띄어쓰기
            } else if f.contains(.command) || f.contains(.control), let c = e.charactersIgnoringModifiers?.uppercased(), !c.isEmpty {
                send("ui.key", ["key": Mirror.keyName(c)].merging(mods) { a, _ in a })
            } else if let t = e.characters, !t.isEmpty {
                // 진짜 키처럼 둘 다 — 키(도구 단축키 b·v·[ ] 가 듣는 것) + 글자(글 칸이 받는 것). 한쪽만 보내면 단축키가 안 먹었다(10/16)
                if let c = e.charactersIgnoringModifiers, c.count == 1 { send("ui.key", ["key": Mirror.keyName(c.uppercased())].merging(mods) { a, _ in a }) }
                send("ui.type", ["text": t])
            }
            return
        case .keyUp, .flagsChanged:
            return
        default:
            break
        }
        guard let sp = toSource(v.convert(e.locationInWindow, from: nil)) else { return }
        let p: [String: Any] = ["x": (sp.x * 10).rounded() / 10, "y": (sp.y * 10).rounded() / 10]
        switch e.type {
        case .leftMouseDown, .rightMouseDown:
            downAt = sp
            dragged = false
            stroke = [sp]
            // 캔버스에서 누르면 도구 끌기(ui.pointer, 문서 좌표 — 앱이 바꾼다), 밖(패널·슬라이더)이면 끄는 길을 따라 ui.click.
            // 캔버스를 아직 모르면 지금 한 번 묻는다(수십 ms — 누를 때 한 번)
            if canvas == nil { canvas = canvasRect(tries: 0) }
            inCanvas = canvas.map { $0.contains(sp) } ?? false
        case .leftMouseDragged:
            guard let d = downAt else { return }
            if !dragged && hypot(d.x - sp.x, d.y - sp.y) < 5 { return }
            dragged = true
            if inCanvas {
                stroke.append(sp)
                drawStroke()
            } else {
                // egui 슬라이더는 누른 자리로 값이 옮겨 간다 — 끄는 동안 40ms 마다 그 자리를 눌러 끌기처럼(10/16)
                let now = CACurrentMediaTime()
                if now - lastDrag > 0.04 { lastDrag = now; send("ui.click", p) }
            }
        case .leftMouseUp, .rightMouseUp:
            if !dragged {
                var q = p
                q["button"] = e.type == .rightMouseUp ? "right" : "left"
                if e.clickCount > 1 { q["count"] = e.clickCount }
                send("ui.click", q)
            } else if inCanvas, let c = canvas {
                stroke.append(sp)
                send("__stroke", ["points": stroke.map { [($0.x * 10).rounded() / 10, ($0.y * 10).rounded() / 10] }, "canvas": [c.minX, c.minY, c.width, c.height]])
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in self?.strokeLayer.path = nil }
            } else {
                send("ui.click", p)
            }
            downAt = nil
            dragged = false
        case .mouseMoved:
            let now = CACurrentMediaTime()
            if now - lastMove > 0.05 { lastMove = now; send("ui.move", p) }  // 올라감 표시 — 초당 20번까지
        default:
            break
        }
    }

    /// 원본 창 점(창 왼쪽 위 기준) → 비추기 뷰 점(뷰는 아래가 원점, 비율 맞춰 가운데)
    func toView(_ p: CGPoint) -> CGPoint {
        let vb = view.bounds, sw = max(srcFrame.width, 1), sh = max(srcFrame.height, 1)
        let k = min(vb.width / sw, vb.height / sh)
        let ox = (vb.width - sw * k) / 2, oy = (vb.height - sh * k) / 2
        return CGPoint(x: ox + p.x * k, y: vb.height - (oy + p.y * k))
    }

    /// 이름들의 자리(원본 창 기준 가운데 점) — AccessKit 은 처음 물을 때 켜지니 비면 잠깐 뒤 다시
    /// 손쉬운 사용 트리 훑기 — 이름들의 자리(전역 점)와 창 안에 보이는 가장 큰 칸(캔버스). AccessKit 은 처음 물을 때 켜진다
    func axScan(_ names: [String]) -> (found: [String: CGRect], canvas: CGRect) {
        guard Mirror.axOK() else { return ([:], .zero) }
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
        var found: [String: CGRect] = [:]
        var canvas = CGRect.zero
        func attr<T>(_ e: AXUIElement, _ k: String) -> T? {
            var v: CFTypeRef?
            return AXUIElementCopyAttributeValue(e, k as CFString, &v) == .success ? v as? T : nil
        }
        func rect(_ e: AXUIElement) -> CGRect? {
            guard let pv: AXValue = attr(e, kAXPositionAttribute), let sv: AXValue = attr(e, kAXSizeAttribute) else { return nil }
            var p = CGPoint.zero, s = CGSize.zero
            AXValueGetValue(pv, .cgPoint, &p); AXValueGetValue(sv, .cgSize, &s)
            return CGRect(origin: p, size: s)
        }
        func walk(_ e: AXUIElement, _ d: Int) {
            let name = (attr(e, kAXTitleAttribute) as String?).flatMap { $0.isEmpty ? nil : $0 } ?? (attr(e, kAXDescriptionAttribute) as String?) ?? ""
            if !name.isEmpty, found[name] == nil, names.contains(name), let r = rect(e) { found[name] = r }
            // 창 안에 보이는 가장 큰 칸 = 주 작업 영역(@canvas) — 창·창 전체 묶음만 빼고(이름·역할은 안 가린다).
            // 10/20 12개 실측: '이름 없는 AXUnknown·폭 95% 미만'은 표(폭 99%)·문서 본문('문서1')·화면('캔버스')·라이트(AXButton 'Photo')를 놓쳐
            // 수식 입력줄·제목줄로 갔다. 창 밖으로 넘친 본문(문서·PDF 쪽)은 보이는 만큼만
            if (attr(e, kAXRoleAttribute) as String?) != "AXWindow", let r = rect(e)?.intersection(srcFrame), !r.isNull,
               !(r.width >= srcFrame.width * 0.95 && r.height >= srcFrame.height * 0.9), r.width * r.height > canvas.width * canvas.height { canvas = r }
            if d < 40, let kids: [AXUIElement] = attr(e, kAXChildrenAttribute) { for k in kids { walk(k, d + 1) } }
        }
        if let wins: [AXUIElement] = attr(app, kAXWindowsAttribute) { for w in wins { walk(w, 0) } }
        return (found, canvas)
    }

    /// 숫자 목록 — "1,2,3" · "[1, 2, 3]"
    static func nums(_ t: Substring) -> [CGFloat] {
        t.split(whereSeparator: { ",[] ".contains($0) }).compactMap { Double($0) }.map { CGFloat($0) }
    }

    /// 이름들의 자리(원본 창 기준 가운데 점) — 비면 잠깐 뒤 다시(AccessKit 이 첫 조회 뒤에 채워진다).
    /// 이름 말고도: '@canvas' 캔버스 · '@title' 제목줄 · '@bounds:[x,y,w,h]' 창 점 · '@doc:x,y,w,h|가운데x,가운데y,점당' 문서 좌표(캔버스 가운데 = 보기 가운데)
    func targets(_ names: [String], tries: Int = 3) -> [CGPoint] {
        let local = names.allSatisfy { $0 == "@title" || $0.hasPrefix("@bounds:") }
        var (found, canvas) = local ? ([:], .zero) : axScan(names)
        var left = local ? 0 : tries
        // AccessKit 은 처음 물을 때 창 머리 칸만 내놓는다 — 캔버스가 창의 10% 도 안 되면 덜 채워진 것(10/20 시험: 손이 왼쪽 위 구석으로)
        let wantCanvas = names.contains { $0 == "@canvas" || $0.hasPrefix("@doc:") }
        let thin = { (c: CGRect) in c.width * c.height < self.srcFrame.width * self.srcFrame.height * 0.1 }
        while ((found.isEmpty && canvas == .zero) || (wantCanvas && thin(canvas))) && left > 0 {
            Thread.sleep(forTimeInterval: 0.3)
            (found, canvas) = axScan(names)
            left -= 1
        }
        let mid = { (r: CGRect) in CGPoint(x: r.midX - self.srcFrame.minX, y: r.midY - self.srcFrame.minY) }
        return names.compactMap { n -> CGPoint? in
            if n == "@canvas" { return canvas == .zero ? nil : mid(canvas) }
            if n == "@title" { return CGPoint(x: srcFrame.width / 2, y: 14) }
            if n.hasPrefix("@bounds:") {
                let v = Mirror.nums(n.dropFirst(8))
                return v.count == 4 ? CGPoint(x: v[0] + v[2] / 2, y: v[1] + v[3] / 2) : nil
            }
            if n.hasPrefix("@doc:") {
                let parts = n.dropFirst(5).split(separator: "|")
                guard parts.count == 2, canvas != .zero else { return nil }
                let b = Mirror.nums(parts[0]), v = Mirror.nums(parts[1])
                guard b.count == 4, v.count == 3, v[2] > 0 else { return nil }
                let c = mid(canvas)
                return CGPoint(x: c.x + (b[0] + b[2] / 2 - v[0]) * v[2], y: c.y + (b[1] + b[3] / 2 - v[1]) * v[2])
            }
            return found[n].map(mid)
        }
    }

    func stop() {
        stopping = true
        attacher?.stop()  // 붙인 창을 떼어 Craft 화면으로
        attacher = nil
        if handing { handoff(false) }  // 칸이 사라지면 넘겨준 창도 Craft 화면으로 돌려놓는다
        fitWork?.cancel()
        driftTimer?.invalidate()
        for o in [frameObs, occObs].compactMap({ $0 }) { NotificationCenter.default.removeObserver(o) }
        stream?.stopCapture(completionHandler: nil)
        stream = nil
        view.removeFromSuperview()
    }
}

@_cdecl("craft_mirror_attach")
public func craftMirrorAttach(_ win: UnsafeMutableRawPointer?, _ pid: Int32, _ top: Double, _ bottom: Double) -> UnsafeMutableRawPointer? {
    guard let win else { return nil }
    let window = Unmanaged<NSWindow>.fromOpaque(win).takeUnretainedValue()
    let m = Mirror(window: window, pid: pid, top: top, bottom: bottom)
    return Unmanaged.passRetained(m).toOpaque()
}

@_cdecl("craft_mirror_status")
public func craftMirrorStatus(_ h: UnsafeMutableRawPointer?) -> Int32 {
    guard let h else { return 4 }
    return Unmanaged<Mirror>.fromOpaque(h).takeUnretainedValue().status
}

@_cdecl("craft_mirror_detach")
public func craftMirrorDetach(_ h: UnsafeMutableRawPointer?) {
    guard let h else { return }
    let m = Unmanaged<Mirror>.fromOpaque(h).takeRetainedValue()
    m.stop()
}

/// 참모 손 — 사람 커서와 다른 파란 손이 자리마다 옮겨 가 누르고(동그라미), 마지막 자리 옆에 짧은 글. 1.6초 뒤 사라진다
final class Hand {
    let root = CALayer()
    let arrow = CAShapeLayer()
    let chip = CATextLayer()
    var last: CGPoint?
    var nextAt: CFTimeInterval = 0  // 다음 손을 그려도 되는 때(연속 명령 — enqueue)
    var pulse: Timer?  // 머무는 손(긴 명령) — 1초마다 지난 시간·고리
    var holdStart: CFTimeInterval = 0
    var holdUntil: CFTimeInterval = 0
    var holdLabel = ""

    init() {
        let p = CGMutablePath()  // 커서 모양(끝이 왼쪽 위)
        p.move(to: CGPoint(x: 0, y: 0)); p.addLine(to: CGPoint(x: 0, y: -17)); p.addLine(to: CGPoint(x: 4.5, y: -12.5))
        p.addLine(to: CGPoint(x: 8, y: -19.5)); p.addLine(to: CGPoint(x: 10.5, y: -18.3)); p.addLine(to: CGPoint(x: 7.2, y: -11.6)); p.addLine(to: CGPoint(x: 13, y: -11.6)); p.closeSubpath()
        arrow.path = p
        arrow.fillColor = NSColor.white.cgColor
        arrow.strokeColor = NSColor(red: 0.18, green: 0.45, blue: 0.88, alpha: 1).cgColor
        arrow.lineWidth = 1.6
        arrow.lineJoin = .round
        arrow.shadowOpacity = 0.35; arrow.shadowRadius = 2; arrow.shadowOffset = CGSize(width: 0, height: -1)
        chip.fontSize = 12
        chip.font = NSFont.boldSystemFont(ofSize: 12)
        chip.foregroundColor = NSColor.white.cgColor
        chip.backgroundColor = NSColor(red: 0.18, green: 0.45, blue: 0.88, alpha: 1).cgColor
        chip.cornerRadius = 6
        chip.alignmentMode = .center
        chip.contentsScale = 2
        root.addSublayer(arrow); root.addSublayer(chip)
        root.opacity = 0
    }

    func ring(_ at: CGPoint, in layer: CALayer, delay: CFTimeInterval) {
        let r = CAShapeLayer()
        r.path = CGPath(ellipseIn: CGRect(x: -14, y: -14, width: 28, height: 28), transform: nil)
        r.position = at
        r.fillColor = nil
        r.strokeColor = NSColor(red: 0.30, green: 0.55, blue: 1, alpha: 1).cgColor
        r.lineWidth = 2
        r.opacity = 0
        layer.addSublayer(r)
        let s = CABasicAnimation(keyPath: "transform.scale"); s.fromValue = 0.5; s.toValue = 1.5
        let o = CAKeyframeAnimation(keyPath: "opacity"); o.values = [0, 1, 0]; o.keyTimes = [0, 0.15, 1]
        let g = CAAnimationGroup(); g.animations = [s, o]; g.duration = 0.55; g.beginTime = CACurrentMediaTime() + delay
        r.add(g, forKey: "ring")
        DispatchQueue.main.asyncAfter(deadline: .now() + delay + 0.6) { r.removeFromSuperlayer() }
    }

    func play(in view: NSView, to pts: [CGPoint], label: String) {
        guard let layer = view.layer else { return }
        if root.superlayer !== layer { layer.addSublayer(root) }
        root.frame = layer.bounds
        root.zPosition = 10
        let start = last ?? CGPoint(x: pts[0].x - 60, y: pts[0].y - 60)
        let step = 0.22  // 빨라도 된다(10/16 사용자) — 명령은 안 기다리고 손만 빠르게
        let move = CAKeyframeAnimation(keyPath: "position")
        move.values = ([start] + pts).map { NSValue(point: $0) }
        move.keyTimes = (0...pts.count).map { NSNumber(value: Double($0) / Double(pts.count)) }
        move.duration = step * Double(pts.count)
        move.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        CATransaction.begin(); CATransaction.setDisableActions(true)
        arrow.position = pts.last!
        root.opacity = 1
        setChip(label, at: pts.last!, in: layer)
        CATransaction.commit()
        arrow.add(move, forKey: "move")
        for (i, p) in pts.enumerated() { ring(p, in: root, delay: step * Double(i + 1) - 0.05) }
        last = pts.last
        let fade = CABasicAnimation(keyPath: "opacity"); fade.fromValue = 1; fade.toValue = 0
        fade.beginTime = CACurrentMediaTime() + move.duration + 1.6; fade.duration = 0.4; fade.fillMode = .forwards; fade.isRemovedOnCompletion = false
        root.add(fade, forKey: "fade")
    }

    func setChip(_ label: String, at p: CGPoint, in layer: CALayer) {
        let w = (label as NSString).size(withAttributes: [.font: NSFont.boldSystemFont(ofSize: 12)]).width + 16
        chip.string = label
        chip.isHidden = label.isEmpty
        chip.frame = CGRect(x: min(max(4, p.x - w - 8), layer.bounds.width - w - 4), y: max(4, p.y - 40), width: w, height: 20)
    }
}

@_cdecl("craft_mirror_point")
public func craftMirrorPoint(_ h: UnsafeMutableRawPointer?, _ namesJson: UnsafePointer<CChar>?, _ label: UnsafePointer<CChar>?, _ hold: Double) {
    guard let h, let namesJson else { return }
    let m = Unmanaged<Mirror>.fromOpaque(h).takeUnretainedValue()
    let names = (try? JSONSerialization.jsonObject(with: Data(String(cString: namesJson).utf8))) as? [String] ?? []
    let text = label.map { String(cString: $0) } ?? ""
    // AX 훑기(수십 ms)는 한 줄씩 차례로 뒤에서(순서가 섞이지 않게), 그리기는 메인에서
    Mirror.scanQ.async {
        let pts = m.status == 1 && !m.paused ? m.targets(names) : []  // 안 보는 중이면 연출 없이
        DispatchQueue.main.async { if !pts.isEmpty { m.hand.enqueue(in: m.view, to: pts.map(m.toView), label: text, hold: hold) } }
    }
}

extension Mirror {
    static let scanQ = DispatchQueue(label: "chammo.craft-mirror.hand")
}

extension Hand {
    func removeFade() { root.removeAnimation(forKey: "fade") }

    /// 연속 명령이면 손 자리가 바뀔 때마다 적어도 몇 프레임은 그려지게 — 앞 손이 시작한 지 minShow 가 안 됐으면 그만큼만 미룬다(속도는 그대로)
    static let minShow: CFTimeInterval = 0.07
    func enqueue(in view: NSView, to pts: [CGPoint], label: String, hold: Double = 0) {
        let now = CACurrentMediaTime()
        if hold > 0, pulse != nil, label == holdLabel {  // 머물기 이어 주기 — 같은 일이면 시간만 늘린다(자리·지난 시간 그대로)
            holdUntil = now + hold
            return
        }
        let at = max(now, nextAt)
        nextAt = at + Hand.minShow
        let go = { [weak self, weak view] in
            guard let self, let view else { return }
            self.stopHold()
            self.removeFade()
            self.play(in: view, to: pts, label: label)
            if hold > 0 { self.startHold(label, hold, in: view) }
        }
        if at <= now { go() } else { DispatchQueue.main.asyncAfter(deadline: .now() + (at - now), execute: go) }
    }

    /// 긴 명령(내보내기·렌더) — 손이 그 자리에 머물며 1초마다 글 옆 지난 시간(0:12), 2초마다 고리. 화면이 멈춘 것처럼 안 보이게(10/20).
    /// 이어 주기(scripts/craft 15초마다)가 끊겨 holdUntil 이 지나면 내린다 — 스크립트가 죽어도 손이 남지 않게
    func startHold(_ label: String, _ hold: Double, in view: NSView) {
        removeFade()
        holdStart = CACurrentMediaTime()
        holdUntil = holdStart + hold
        holdLabel = label
        pulse = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self, weak view] _ in
            guard let self, let layer = view?.layer, let at = self.last else { return }
            let now = CACurrentMediaTime()
            if now > self.holdUntil {
                self.stopHold()
                let f = CABasicAnimation(keyPath: "opacity"); f.fromValue = 1; f.toValue = 0; f.duration = 0.4; f.fillMode = .forwards; f.isRemovedOnCompletion = false
                self.root.add(f, forKey: "fade")
                return
            }
            let s = Int(now - self.holdStart)
            CATransaction.begin(); CATransaction.setDisableActions(true)
            self.setChip("\(self.holdLabel) \(s / 60):\(String(format: "%02d", s % 60))", at: at, in: layer)
            CATransaction.commit()
            if s % 2 == 0 { self.ring(at, in: self.root, delay: 0) }
        }
    }

    func stopHold() {
        pulse?.invalidate()
        pulse = nil
    }
}

@_cdecl("craft_mirror_input")
public func craftMirrorInput(_ h: UnsafeMutableRawPointer?, _ on: Int32) {
    guard let h else { return }
    // 개입 = 진짜 창 넘겨주기(10/16 사용자 — 비친 칸에 입력을 흘려 넣는 길은 단축키·호버·도구가 진짜 앱처럼 안 됐다, 실사용 세 번 실패)
    Unmanaged<Mirror>.fromOpaque(h).takeUnretainedValue().handoff(on != 0)
}

extension Mirror {
    /// 개입 켜기: 진짜 앱 창을 사람 화면의 이 칸 자리로 옮기고(조작 채널 ui.window.frame) 그 앱을 활성 — 키·마우스·단축키가 그 앱에서 그대로 먹는다
    /// (Chammo 는 활성이 아니라 ⌘W·⌘K 같은 앱 단축키가 가로챌 수 없다). 비추기는 밑에서 계속 — 사람이 채팅을 눌러 Chammo 가 앞으로 와도 칸엔 같은 그림.
    /// 끄기: 원래 자리(Craft 가짜 화면)로 되돌리고 Chammo 를 다시 활성
    func handoff(_ on: Bool) {
        if let a = attacher {
            // 붙인 동안엔 진짜 창이 이미 칸 자리 — 개입 = 입력 잠금 풀기 + 그 앱 앞으로, 돌려주기 = 잠그고 Chammo 앞으로
            a.lock = !on
            if on {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in self?.activateApp() }
            } else if ProcessInfo.processInfo.environment["CHAMMO_CRAFT_NO_ACTIVATE"] != "1" {
                NSApp.activate(ignoringOtherApps: true)
            }
            return
        }
        if on {
            guard !handing, status == 1 else { return }
            homeFrame = Mirror.cgFrame(pid)
            homeScale = scale
            handing = true
            moveToStage()
            // 넘겨받는 화면 배율로 받기(1배 외장이면 1배) — 안 바꾸면 밑에 깔린 비추기 그림이 작게 그려졌다
            if let r = stageRect(), let sc = view.window?.backingScaleFactor {
                scale = sc
                srcFrame = r
                stream?.updateConfiguration(config(r.size, slow: false), completionHandler: nil)
            }
            moveObs = NotificationCenter.default.addObserver(forName: NSWindow.didMoveNotification, object: view.window, queue: .main) { [weak self] _ in self?.moveToStage() }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in self?.activateApp() }  // 창이 옮겨진 뒤
        } else {
            guard handing else { return }
            handing = false
            if let o = moveObs { NotificationCenter.default.removeObserver(o); moveObs = nil }
            if let h = homeFrame {
                moveWindow(h)
                srcFrame = h
                ensureHome(h, tries: 3)
            }
            if let sc = homeScale { scale = sc }
            if ProcessInfo.processInfo.environment["CHAMMO_CRAFT_NO_ACTIVATE"] != "1" { NSApp.activate(ignoringOtherApps: true) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in self?.scheduleFit() }
        }
    }

    /// 칸 자리(전역 왼쪽 위 기준 점)
    func stageRect() -> CGRect? {
        guard let w = view.window else { return nil }
        let r = w.convertToScreen(view.convert(view.bounds, to: nil))
        let top = NSScreen.screens.first?.frame.height ?? 0
        return CGRect(x: r.minX, y: top - r.maxY, width: r.width, height: r.height)
    }

    func moveToStage() {
        guard handing, let r = stageRect(), r.width > 50, r.height > 50 else { return }
        if r.size != srcFrame.size { srcFrame = r; stream?.updateConfiguration(config(r.size, slow: false), completionHandler: nil) }
        srcFrame = r
        moveWindow(r)
    }

    /// 진짜 앱 창을 그 자리·크기로 — 창 자리 명령(ui.window.frame)은 참모 포토만 있어서, 나머지 12개는 창이 가짜 화면에 남아 개입해도
    /// 사람 입력이 비추기 그림에 떨어졌다(10/19 사용자 VectorCraft '클릭도 단축키도 안 먹음'). 손쉬운 사용(AX)으로도 같이 옮긴다
    func moveWindow(_ r: CGRect) {
        send("ui.window.frame", ["x": r.minX.rounded(), "y": r.minY.rounded(), "width": r.width.rounded(), "height": r.height.rounded()])
        guard Mirror.axOK() else { return }  // 허용 없으면 창 자리 명령만(참모 포토·WordCraft) — 묻는 창은 안 띄운다
        let app = AXUIElementCreateApplication(pid)
        var v: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &v) == .success, let wins = v as? [AXUIElement] else { return }
        func area(_ e: AXUIElement) -> CGFloat {
            var sv: CFTypeRef?
            guard AXUIElementCopyAttributeValue(e, kAXSizeAttribute as CFString, &sv) == .success else { return 0 }
            var z = CGSize.zero
            AXValueGetValue(sv as! AXValue, .cgSize, &z)
            return z.width * z.height
        }
        guard let win = wins.max(by: { area($0) < area($1) }) else { return }
        var origin = r.origin, size = r.size
        // 자리 → 크기 → 자리(화면 가장자리에서 크기를 바꾸면 맥이 자리를 안쪽으로 밀어서)
        if let pv = AXValueCreate(.cgPoint, &origin) { AXUIElementSetAttributeValue(win, kAXPositionAttribute as CFString, pv) }
        if let sv = AXValueCreate(.cgSize, &size) { AXUIElementSetAttributeValue(win, kAXSizeAttribute as CFString, sv) }
        if let pv = AXValueCreate(.cgPoint, &origin) { AXUIElementSetAttributeValue(win, kAXPositionAttribute as CFString, pv) }
    }

    /// 돌려준 창이 원래 화면(Craft 가짜 화면)에 있나 0.3초 뒤 보고, 아니면 다시 옮긴다 — 시험에서 한 번 EffectCraft 가 사람 화면 왼쪽 위(0,30)로
    /// 돌아갔다(10/19, 재현 안 됨 — 배율이 다른 화면을 오가며 앱이 스스로 자리를 다시 잡은 듯)
    func ensureHome(_ h: CGRect, tries: Int) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            guard let self, !self.handing, tries > 0 else { return }
            var ids = [CGDirectDisplayID](repeating: 0, count: 4), n: UInt32 = 0
            CGGetDisplaysWithPoint(CGPoint(x: h.midX, y: h.midY), 4, &ids, &n)
            guard n > 0, let cur = Mirror.cgFrame(self.pid) else { return }
            if CGDisplayBounds(ids[0]).contains(CGPoint(x: cur.midX, y: cur.midY)) { return }
            self.moveWindow(h)
            self.ensureHome(h, tries: tries - 1)
        }
    }

    func activateApp() {
        // 시험 앱 전용 — 사람이 쓰는 맥에서 시험할 때 키보드 포커스를 뺏지 않게(CHAMMO_CRAFT_NO_ACTIVATE=1)
        if ProcessInfo.processInfo.environment["CHAMMO_CRAFT_NO_ACTIVATE"] == "1" { return }
        guard let app = NSRunningApplication(processIdentifier: pid) else { return }
        if #available(macOS 14.0, *) { NSApp.yieldActivation(to: app) }  // 맥 14+ — 활성인 앱이 넘겨줘야 다른 앱이 앞으로 온다
        app.activate(options: [.activateAllWindows])
    }
}

@_cdecl("craft_mirror_set_input")
public func craftMirrorSetInput(_ h: UnsafeMutableRawPointer?, _ cb: CraftInputCB?, _ ctx: UnsafeMutableRawPointer?) {
    guard let h else { return }
    let m = Unmanaged<Mirror>.fromOpaque(h).takeUnretainedValue()
    m.inputCB = cb
    m.inputCtx = ctx
}

@_cdecl("craft_mirror_still")
public func craftMirrorStill(_ h: UnsafeMutableRawPointer?, _ path: UnsafePointer<CChar>?) -> Int32 {
    guard let h = h, let path = path else { return 0 }
    return Unmanaged<Mirror>.fromOpaque(h).takeUnretainedValue().still(to: String(cString: path)) ? 1 : 0
}

@_cdecl("craft_mirror_place")
public func craftMirrorPlace(_ h: UnsafeMutableRawPointer?, _ x: Double, _ y: Double, _ w: Double, _ hh: Double, _ vh: Double, _ visible: Int32) {
    guard let h else { return }
    Unmanaged<Mirror>.fromOpaque(h).takeUnretainedValue().place(CGRect(x: x, y: y, width: w, height: hh), vh: vh, visible: visible != 0)
}

/// 개발판 시험 전용 — 그 창에 마우스·키 이벤트를 앱 안에서 흘린다(창 hitTest 를 그대로 타서 실제 클릭과 같은 길).
/// 밖에서 보내는 이벤트(postToPid)는 활성 아닌 앱 창에 안 닿고, 진짜 커서를 쓰면 사람 화면을 뺏는다(10/16). gx·gy = 전역 왼쪽 위 기준 점
@_cdecl("craft_mirror_debug_event")
public func craftMirrorDebugEvent(_ win: UnsafeMutableRawPointer?, _ gx: Double, _ gy: Double, _ kind: Int32, _ chars: UnsafePointer<CChar>?) {
    guard let win else { return }
    let w = Unmanaged<NSWindow>.fromOpaque(win).takeUnretainedValue()
    let ph = NSScreen.screens.first?.frame.height ?? 0
    let loc = w.convertFromScreen(NSRect(x: gx, y: ph - gy, width: 0, height: 0)).origin
    let t = ProcessInfo.processInfo.systemUptime
    let types: [Int32: NSEvent.EventType] = [0: .leftMouseDown, 1: .leftMouseUp, 2: .leftMouseDragged, 3: .mouseMoved]
    if let type = types[kind], let e = NSEvent.mouseEvent(with: type, location: loc, modifierFlags: [], timestamp: t, windowNumber: w.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1) {
        w.sendEvent(e)
    } else if kind == 4, let chars, let e = NSEvent.keyEvent(with: .keyDown, location: loc, modifierFlags: [], timestamp: t, windowNumber: w.windowNumber, context: nil, characters: String(cString: chars), charactersIgnoringModifiers: String(cString: chars), isARepeat: false, keyCode: 0) {
        w.sendEvent(e)
    }
}

// 붙이기 모드(시험, CHAMMO_CRAFT_ATTACH=1) — 칸이 보이는 동안 진짜 앱 창을 칸 자리에(attach.swift Attacher), 비추기는 밑에서 느리게(덮일 때 깔 그림)
extension Mirror {
    static let attachMode = ProcessInfo.processInfo.environment["CHAMMO_CRAFT_ATTACH"] == "1"

    var attachedNow: Bool { attacher?.last?.visible == true }

    func startAttach() {
        // 명령 길(inputCB)은 Rust 가 ui.window.attach 를 아는 앱(참모 표)에만 미리 건다 — 모르는 앱에 붙였다고 치면 refit·개입이 꺼졌다(리뷰)
        guard Mirror.attachMode, attacher == nil, pid > 0, inputCB != nil else { return }
        // 원래 자리(Craft 가짜 화면)는 붙이기 전에 한 번만 — 떼고 곧바로 다시 붙이면 아직 칸 자리에 있는 창을 원래 자리로 잡았다(리뷰)
        attachHome = Mirror.cgFrame(pid)
        attacher = Attacher(view: view, pid: pid, shown: !hostHidden) { [weak self] s in self?.attachSink(s) }
    }

    /// 참모 앱 쪽 — 조작 채널 ui.window.attach(자리·층·잠금), 뗄 땐 원래 자리(Craft 가짜 화면)로 ui.window.frame
    func attachSink(_ s: AttachState) {
        if s.visible {
            send("ui.window.attach", ["on": true, "x": s.rect.minX, "y": s.rect.minY, "width": s.rect.width, "height": s.rect.height,
                                      "parent": s.parent, "front": s.front, "lock": s.lock])
            let resized = s.rect.size != srcFrame.size
            srcFrame = s.rect  // 참모 손 자리도 칸 자리 기준으로
            _ = resized
            dropStream()
        } else {
            send("ui.window.attach", ["on": false])
            if let h = attachHome {
                send("ui.window.frame", ["x": h.minX.rounded(), "y": h.minY.rounded(), "width": h.width.rounded(), "height": h.height.rounded()])
                srcFrame = h
            }
            remakeStream()
        }
    }
}

// 붙인 동안엔 받기(SCStream)를 아예 버린다 — 멈추기(stopCapture)만으론 맥이 그 창 신호등 자리에 '화면 기록 중' 알약(보라색)을 계속 그렸다(10/21 사용자 실측 25초).
// 덮일 때 깔 그림은 Rust 가 앱 ui.screenshot 한 장으로(craft_space_still), 떼면 같은 창으로 다시 만든다
extension Mirror {
    func dropStream() {
        guard let s = stream else { return }
        if !paused { s.stopCapture(completionHandler: nil) }
        stream = nil
        paused = false
    }

    func remakeStream() {
        guard !stopping, stream == nil, let f = capFilter else { return }
        let s = SCStream(filter: f, configuration: config(srcFrame.size, slow: slow), delegate: self)
        guard (try? s.addStreamOutput(self, type: .screen, sampleHandlerQueue: DispatchQueue(label: "chammo.craft-mirror.frames"))) != nil else { return }
        stream = s
        paused = false
        s.startCapture { [weak self] _ in DispatchQueue.main.async { self?.updatePause() } }
    }
}
