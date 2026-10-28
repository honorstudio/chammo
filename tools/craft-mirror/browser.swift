// 세션 브라우저 비추기(2026-10-27 인앱 브라우저 A) — 가짜 화면 위 세션 크롬 창 하나를 스페이스 칸에 그대로(SCK IOSurface → CALayer, 복사·인코딩 0).
// Craft 비추기(mirror.swift)와 같은 받기 길이지만 크롬은 다르게 다룬다:
//   - 어떤 창: 앱(Rust)이 CDP 로 지금 탭의 창 자리(전역 점)를 알려 주고, 그 자리와 맞는 창을 받는다(팝업 창으로 탭이 넘어가면 다시 고른다)
//   - 툴바(탭 줄·주소창)는 잘라 낸다: 위 top 점만큼 sourceRect 밖으로 — 칸 머리줄이 우리 탭·뒤로·앞으로를 그린다
//   - 크기는 앱이 CDP(Browser.setWindowBounds)로 세션 도구가 안 돌 때만 바꾼다(spike A2 — 좌표 도구가 빗나감). 여기선 창 크기를 따라 받기만 바꾼다
// 모두 메인 스레드에서 부른다. browser_mirror_attach(NSWindow*, pid) → 손잡이 · browser_mirror_place(손잡이, 칸 x,y,w,h, innerHeight, 보임, 창 x,y,w,h, top)
// · browser_mirror_status · browser_mirror_blind(받기는 켜졌는데 2초째 한 장도 안 옴 — 앱이 screencast 그림으로 내려간다) · browser_mirror_still · browser_mirror_detach
// · browser_mirror_set_input(손잡이, 콜백, ctx) — 칸 위 마우스·휠을 페이지 비율 좌표(0~1) 입력 JSON {events, focus} 으로 앱에(키·한글은 웹 숨은 글칸이 받는다)
// · browser_mirror_cursor(손잡이, x, y) — 참모 커서: 참모가 누른 자리(페이지 비율)로 커서가 옮겨 가 잠깐 머문다(spike A4)
public typealias BrowserInputCB = @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>?) -> Void

/// 비추기 뷰 — 마우스·휠을 받아 앱에 넘긴다. 첫 응답자는 안 된다(키는 웹뷰가 받아 숨은 글칸으로 — 한글 조합을 웹이 이미 다룬다)
final class BrowserMirrorView: NSView {
    weak var mirror: BrowserMirror?
    override var acceptsFirstResponder: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseMoved, .activeAlways, .inVisibleRect], owner: self))
    }
    override func mouseDown(with e: NSEvent) { mirror?.mouse("mousePressed", e, focus: true) }
    override func mouseUp(with e: NSEvent) { mirror?.mouse("mouseReleased", e) }
    override func mouseDragged(with e: NSEvent) { mirror?.mouse("mouseMoved", e) }
    override func mouseMoved(with e: NSEvent) { mirror?.mouse("mouseMoved", e) }
    override func rightMouseDown(with e: NSEvent) { mirror?.mouse("mousePressed", e, focus: true) }
    override func rightMouseUp(with e: NSEvent) { mirror?.mouse("mouseReleased", e) }
    override func otherMouseDown(with e: NSEvent) { mirror?.mouse("mousePressed", e) }
    override func otherMouseUp(with e: NSEvent) { mirror?.mouse("mouseReleased", e) }
    override func scrollWheel(with e: NSEvent) { mirror?.wheel(e) }
}

import AppKit
import CoreImage
import ImageIO
import CoreMedia
import QuartzCore
import ScreenCaptureKit

final class BrowserMirror: NSObject, SCStreamOutput, SCStreamDelegate {
    let view = BrowserMirrorView()
    var inputCB: BrowserInputCB?
    var inputCtx: UnsafeMutableRawPointer?
    var lastMove: CFTimeInterval = 0
    let cursor = CAShapeLayer()
    weak var window: NSWindow?
    let pid: pid_t
    var stream: SCStream?
    var status: Int32 = 0       // craft_mirror_status 와 같은 번호: 0 기다림 · 1 비추는 중 · 2 권한 없음 · 3 창 없음 · 4 멈춤
    var winFrame = CGRect.zero  // 받는 크롬 창(전역 점, 왼쪽 위 원점)
    var top: CGFloat = 0        // 잘라 낼 툴바 높이(점)
    var scale: CGFloat = 2
    var paused = false
    var hostHidden = true
    var picking = false
    var occObs: NSObjectProtocol?
    var liveAt: CFTimeInterval = 0  // 받기를 (다시) 켠 때 — 그 뒤 한 장이라도 왔나(gotFrame)
    var gotFrame = false
    static let framesQ = DispatchQueue(label: "chammo.browser-mirror.frames")

    init(window: NSWindow, pid: pid_t) {
        self.pid = pid
        super.init()
        self.window = window
        guard let content = window.contentView else { status = 4; return }
        let web = Mirror.findWeb(content) ?? content
        let host = web === content ? content : (web.superview ?? content)
        view.mirror = self
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor(calibratedWhite: 0.12, alpha: 1).cgColor
        view.layer?.contentsGravity = .resizeAspect
        view.isHidden = true  // 첫 프레임 전엔 숨긴다 — 그동안 웹 칸의 안내가 보인다
        host.addSubview(view, positioned: .above, relativeTo: nil)
        occObs = NotificationCenter.default.addObserver(forName: NSWindow.didChangeOcclusionStateNotification, object: window, queue: .main) { [weak self] _ in self?.updatePause() }
        if !CGPreflightScreenCaptureAccess() { status = 2 }
    }

    /// 칸 자리(웹뷰 왼쪽 위 기준 CSS 점)·보임 + 받을 창 자리·툴바 높이 — 웹이 바뀔 때·0.5초마다 알려 준다
    func place(_ r: CGRect, vh: CGFloat, visible: Bool, win: CGRect, top: CGFloat) {
        guard let host = view.superview else { return }
        let web = Mirror.findWeb(host) ?? host
        let wf = web === host ? host.bounds : web.frame
        let inset = vh > 0 ? max(0, wf.height - vh) : 0  // 웹뷰가 제목줄 밑까지 깔린 만큼(mirror.swift place 와 같은 까닭)
        let y = host.isFlipped ? wf.minY + inset + r.minY : wf.maxY - inset - r.minY - r.height
        // 기기 픽셀 바깥쪽으로 — 소수 점 자리를 안쪽으로 반올림하면 칸 끝에 웹 칸 바탕이 머리카락만큼 비친다
        let f = host.backingAlignedRect(NSRect(x: wf.minX + r.minX, y: y, width: max(0, r.width), height: max(0, r.height)), options: .alignAllEdgesOutward)
        if f != view.frame { view.frame = f }
        hostHidden = !visible || r.width < 40 || r.height < 40
        if hostHidden { view.isHidden = true } else if view.layer?.contents != nil { view.isHidden = false }
        if status == 2 { return }
        if win.width > 50, win.height > top + 50 {
            if stream == nil || BrowserMirror.otherWindow(winFrame, win) {
                retarget(win, top: top)
            } else if win.size != winFrame.size || top != self.top {
                winFrame = win
                self.top = top
                stream?.updateConfiguration(config(), completionHandler: nil)
            }
        }
        updateGravity()
        updatePause()
    }

    /// 다른 창인가 — 자리가 크게 다르면(팝업 창·새 창으로 탭이 넘어감). 크기만 바뀐 건 같은 창(앱이 칸 크기로 바꿨다)
    static func otherWindow(_ a: CGRect, _ b: CGRect) -> Bool {
        abs(a.minX - b.minX) > 4 || abs(a.minY - b.minY) > 4
    }

    /// 그 자리의 크롬 창을 새로 받는다 — 맞는 창이 없으면 그 pid 의 가장 큰 보통 창
    func retarget(_ win: CGRect, top: CGFloat) {
        if picking { return }
        picking = true
        winFrame = win
        self.top = top
        SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: false) { [weak self] content, _ in
            DispatchQueue.main.async { self?.start(content) }
        }
    }

    func start(_ content: SCShareableContent?) {
        picking = false
        guard let content else { status = 2; return }
        // 크롬은 화면마다 메뉴줄 창(층 > 0)이 있어 층 0 만(교훈 lesson-session-chrome)
        let wins = content.windows.filter { $0.owningApplication?.processID == pid && $0.windowLayer == 0 && $0.frame.width > 100 }
        let near = wins.min { BrowserMirror.distance($0.frame, winFrame) < BrowserMirror.distance($1.frame, winFrame) }
        guard let w = near.flatMap({ BrowserMirror.distance($0.frame, winFrame) < 40 ? $0 : nil })
                ?? wins.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) else { status = 3; return }
        winFrame = w.frame
        let filter = SCContentFilter(desktopIndependentWindow: w)
        scale = CGFloat(filter.pointPixelScale)
        stream?.stopCapture(completionHandler: nil)
        let s = SCStream(filter: filter, configuration: config(), delegate: self)
        do {
            try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: BrowserMirror.framesQ)
        } catch { status = 4; return }
        stream = s
        paused = false
        s.startCapture { [weak self] err in
            DispatchQueue.main.async {
                self?.status = err == nil ? 1 : 2
                self?.liveAt = CACurrentMediaTime()
                self?.gotFrame = false
                self?.updatePause()
            }
        }
    }

    static func distance(_ a: CGRect, _ b: CGRect) -> CGFloat {
        abs(a.minX - b.minX) + abs(a.minY - b.minY) + abs(a.width - b.width) / 4 + abs(a.height - b.height) / 4
    }

    /// 받기 설정 — 툴바 밑 페이지 자리만, 화면 배율 그대로(가짜 화면이 레티나면 2배). 바뀌면 SCK 가 알아서 60장, 안 바뀌면 안 보낸다
    func config() -> SCStreamConfiguration {
        let page = BrowserMirror.pageRect(winFrame.size, top: top)
        let cfg = SCStreamConfiguration()
        cfg.sourceRect = page
        cfg.width = max(2, Int(page.width * scale))
        cfg.height = max(2, Int(page.height * scale))
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 60)
        cfg.queueDepth = 4
        cfg.showsCursor = false
        cfg.pixelFormat = kCVPixelFormatType_32BGRA
        return cfg
    }

    /// 창 안 페이지 자리(창 왼쪽 위 기준 점) — 위 툴바만 뺀다
    static func pageRect(_ win: CGSize, top: CGFloat) -> CGRect {
        let t = min(max(0, top), max(0, win.height - 2))
        return CGRect(x: 0, y: t, width: win.width, height: win.height - t)
    }

    func stream(_ s: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen,
              let atts = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let raw = atts.first?[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete,
              let px = CMSampleBufferGetImageBuffer(sb), let surf = CVPixelBufferGetIOSurface(px)?.takeUnretainedValue() else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            self.view.layer?.contents = surf
            CATransaction.commit()
            self.gotFrame = true
            if !self.hostHidden { self.view.isHidden = false }
        }
    }

    func stream(_ s: SCStream, didStopWithError error: Error) {
        DispatchQueue.main.async { if self.stream === s { self.status = 4; self.stream = nil } }
    }

    /// 안 보는 동안(칸 숨김·앱 창 가려짐) 받기를 멈춘다 — 부하 0. 다시 열면 첫 그림까지 0.06초 안(spike A5)
    func updatePause() {
        guard let s = stream, let w = window else { return }
        let off = !w.occlusionState.contains(.visible) || hostHidden
        if off && !paused {
            paused = true
            s.stopCapture(completionHandler: nil)
        } else if !off && paused {
            paused = false
            liveAt = CACurrentMediaTime()
            gotFrame = false
            s.startCapture(completionHandler: nil)
        }
    }

    /// 받기는 켜졌는데 2초째 한 장도 없다 — 가린 창·그림 멈춘 창(10-28 까만 칸). 켜면 첫 그림은 0.06초 안이라 넉넉하다(spike A5)
    func blind() -> Bool {
        status == 1 && stream != nil && !paused && !gotFrame && liveAt > 0 && CACurrentMediaTime() - liveAt > 2
    }

    /// 마지막 그림 → JPEG. SCK 는 IOSurface, 그림 길(헤드리스·가린 크롬 screencast)은 CGImage 다 — 그림 길을 못 읽어 메뉴를 열면 칸이 까맸다(10-28 사용자)
    func still(to path: String) -> Bool {
        guard let cg = BrowserMirror.image(of: view.layer?.contents),
              let data = NSBitmapImageRep(cgImage: cg).representation(using: .jpeg, properties: [.compressionFactor: 0.82]) else { return false }
        return (try? data.write(to: URL(fileURLWithPath: path))) != nil
    }

    static func image(of obj: Any?) -> CGImage? {
        guard let obj else { return nil }
        let t = CFGetTypeID(obj as CFTypeRef)
        if t == CGImage.typeID { return (obj as! CGImage) }
        guard t == IOSurfaceGetTypeID() else { return nil }
        let ci = CIImage(ioSurface: unsafeBitCast(obj as AnyObject, to: IOSurfaceRef.self))
        return CIContext(options: [.useSoftwareRenderer: false]).createCGImage(ci, from: ci.extent)
    }

    /// 그림이 놓인 자리(뷰 안, 비율 유지 가운데) — 칸 크기 = 페이지 크기면 뷰 전체
    func contentRect() -> CGRect {
        let page = stream == nil && headlessPage.width > 0 ? headlessPage : BrowserMirror.pageRect(winFrame.size, top: top).size
        return BrowserMirror.fit(page, in: view.bounds.size)
    }

    static func fit(_ page: CGSize, in box: CGSize) -> CGRect {
        guard page.width > 0, page.height > 0, box.width > 0, box.height > 0, !fills(page, in: box) else { return CGRect(origin: .zero, size: box) }
        let s = min(box.width / page.width, box.height / page.height)
        let w = page.width * s, h = page.height * s
        return CGRect(x: (box.width - w) / 2, y: (box.height - h) / 2, width: w, height: h)
    }

    /// 칸과 페이지가 가로세로 2점 안쪽으로만 다른가 — 칸은 소수 점이고 페이지는 정수 px 라(크기 맞춤도 2점 안쪽은 안 바꾼다, browser_pane resize_due)
    /// 비율 맞춤이 양옆에 머리카락 여백을 남겨 칸 끝에 1px 어두운 줄이 보였다(10-28 사용자). 이만큼은 늘려 꽉 채운다
    static func fills(_ page: CGSize, in box: CGSize) -> Bool {
        page.width > 0 && page.height > 0 && abs(box.width - page.width) <= 2 && abs(box.height - page.height) <= 2
    }

    /// 그림 늘리기 — 꽉 채울 땐 늘림(여백 없음), 아니면 비율 유지(창 크기를 맞추는 사이 잠깐)
    func updateGravity() {
        let page = stream == nil && headlessPage.width > 0 ? headlessPage : BrowserMirror.pageRect(winFrame.size, top: top).size
        let g: CALayerContentsGravity = BrowserMirror.fills(page, in: view.bounds.size) ? .resize : .resizeAspect
        if view.layer?.contentsGravity != g { view.layer?.contentsGravity = g }
    }

    /// 뷰 좌표(아래 원점) → 페이지 비율(위 원점, 0~1). 그림 밖이면 nil
    static func ratio(_ p: CGPoint, in r: CGRect, flipped: Bool, height: CGFloat) -> CGPoint? {
        let y = flipped ? p.y : height - p.y
        let top = flipped ? r.minY : height - r.maxY
        let x = (p.x - r.minX) / r.width, yy = (y - top) / r.height
        return (0...1).contains(x) && (0...1).contains(yy) ? CGPoint(x: x, y: yy) : nil
    }

    /// CDP 보조 키 — Alt 1 · Ctrl 2 · Meta 4 · Shift 8
    static func mods(_ f: NSEvent.ModifierFlags) -> Int {
        (f.contains(.option) ? 1 : 0) | (f.contains(.control) ? 2 : 0) | (f.contains(.command) ? 4 : 0) | (f.contains(.shift) ? 8 : 0)
    }

    func send(_ events: [[String: Any]], focus: Bool = false) {
        guard let cb = inputCB, let data = try? JSONSerialization.data(withJSONObject: ["events": events, "focus": focus]),
              let text = String(data: data, encoding: .utf8) else { return }
        text.withCString { cb(inputCtx, $0) }
    }

    func mouse(_ type: String, _ e: NSEvent, focus: Bool = false) {
        guard status == 1, let p = BrowserMirror.ratio(view.convert(e.locationInWindow, from: nil), in: contentRect(), flipped: view.isFlipped, height: view.bounds.height) else { return }
        // 지나가는 이동은 초당 60번까지만
        if type == "mouseMoved" {
            let now = CACurrentMediaTime()
            if now - lastMove < 1.0 / 60 { return }
            lastMove = now
        }
        let button = e.type == .rightMouseDown || e.type == .rightMouseUp ? "right" : e.type == .otherMouseDown || e.type == .otherMouseUp ? "middle"
            : type == "mouseMoved" && e.type != .leftMouseDragged ? "none" : "left"
        var ev: [String: Any] = ["kind": "mouse", "type": type, "x": p.x, "y": p.y, "button": button, "modifiers": BrowserMirror.mods(e.modifierFlags)]
        if type != "mouseMoved" { ev["clickCount"] = max(1, e.clickCount) }
        send([ev], focus: focus)
    }

    func wheel(_ e: NSEvent) {
        guard status == 1, let p = BrowserMirror.ratio(view.convert(e.locationInWindow, from: nil), in: contentRect(), flipped: view.isFlipped, height: view.bounds.height) else { return }
        // 맥 '자연스러운 스크롤' 값은 내용이 움직이는 쪽 — CDP 는 굴리는 쪽이라 뒤집는다. 휠(정밀 아님)은 한 칸이 1이라 키운다
        let k: CGFloat = e.hasPreciseScrollingDeltas ? 1 : 40
        send([["kind": "mouse", "type": "mouseWheel", "x": p.x, "y": p.y, "deltaX": -e.scrollingDeltaX * k, "deltaY": -e.scrollingDeltaY * k, "modifiers": BrowserMirror.mods(e.modifierFlags)]])
    }

    /// 그림 길 페이지 크기(점) — 일꾼이 아는 페이지 크기(css)가 그림과 비율이 같으면 그것, 모르면 2배로 짐작(헤드리스 --force-device-scale-factor=2).
    /// 가린 크롬은 그 창이 놓인 화면 배율(1배·2배)로 그려서 늘 2배로 읽으면 1배 그림이 반쪽 페이지가 돼 칸이 늘려 그렸다(10-28 사용자 흐림)
    static func castPage(_ img: CGSize, css: CGSize) -> CGSize {
        let guess = CGSize(width: img.width / 2, height: img.height / 2)
        guard css.width > 0, css.height > 0, img.width > 0, img.height > 0 else { return guess }
        let s = img.width / css.width
        return s >= 0.5 && abs(img.height / css.height - s) <= 0.05 * s ? css : guess
    }

    /// 그림 길 한 장(JPEG, 6단계) — 비출 창이 없어(헤드리스·가린 크롬) 일꾼이 받은 screencast 를 같은 칸에. css = 그 그림의 페이지 점 크기(모르면 0)
    var headlessPage = CGSize.zero
    func frame(_ data: Data, css: CGSize) {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return }
        headlessPage = BrowserMirror.castPage(CGSize(width: img.width, height: img.height), css: css)
        updateGravity()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        view.layer?.contents = img
        CATransaction.commit()
        status = 1
        if !hostHidden { view.isHidden = false }
    }

    /// 참모 커서 — 페이지 비율 자리로 옮겨 가고(0.15초) 1.6초 뒤 흐려진다. 웹이 아니라 이 층에 그려 덮개 문제가 없다
    func showCursor(_ rx: CGFloat, _ ry: CGFloat) {
        guard let layer = view.layer else { return }
        if cursor.superlayer !== layer {
            let path = CGMutablePath()
            // 화살 — 시안 A 참모 색 커서(16점), 흰 테두리
            path.move(to: CGPoint(x: 0, y: 0)); path.addLine(to: CGPoint(x: 0, y: 17)); path.addLine(to: CGPoint(x: 4.5, y: 12.5))
            path.addLine(to: CGPoint(x: 8, y: 19.5)); path.addLine(to: CGPoint(x: 10.5, y: 18.3)); path.addLine(to: CGPoint(x: 7.2, y: 11.5))
            path.addLine(to: CGPoint(x: 13, y: 11.5)); path.closeSubpath()
            cursor.path = path
            cursor.fillColor = NSColor(red: 0.30, green: 0.55, blue: 1.0, alpha: 1).cgColor
            cursor.strokeColor = NSColor.white.cgColor
            cursor.lineWidth = 1.4
            cursor.lineJoin = .round
            cursor.bounds = CGRect(x: 0, y: 0, width: 14, height: 20)
            cursor.anchorPoint = CGPoint(x: 0, y: 1)
            cursor.isGeometryFlipped = !view.isFlipped
            cursor.shadowOpacity = 0.35; cursor.shadowRadius = 2; cursor.shadowOffset = CGSize(width: 0, height: -1)
            cursor.zPosition = 30
            cursor.opacity = 0
            layer.addSublayer(cursor)
        }
        let r = contentRect()
        let x = r.minX + rx * r.width
        let y = view.isFlipped ? r.minY + ry * r.height : r.maxY - ry * r.height
        CATransaction.begin()
        CATransaction.setAnimationDuration(cursor.opacity == 0 ? 0 : 0.15)
        cursor.position = CGPoint(x: x, y: y)
        CATransaction.commit()
        cursor.removeAnimation(forKey: "fade")
        cursor.opacity = 1
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 1; fade.toValue = 0; fade.beginTime = CACurrentMediaTime() + 1.6; fade.duration = 0.4
        fade.fillMode = .forwards; fade.isRemovedOnCompletion = false
        cursor.add(fade, forKey: "fade")
    }

    func stop() {
        if let o = occObs { NotificationCenter.default.removeObserver(o) }
        stream?.stopCapture(completionHandler: nil)
        stream = nil
        view.removeFromSuperview()
    }
}

@_cdecl("browser_mirror_attach")
public func browserMirrorAttach(_ win: UnsafeMutableRawPointer?, _ pid: Int32) -> UnsafeMutableRawPointer? {
    guard let win else { return nil }
    let window = Unmanaged<NSWindow>.fromOpaque(win).takeUnretainedValue()
    return Unmanaged.passRetained(BrowserMirror(window: window, pid: pid)).toOpaque()
}

@_cdecl("browser_mirror_place")
public func browserMirrorPlace(_ h: UnsafeMutableRawPointer?, _ x: Double, _ y: Double, _ w: Double, _ hh: Double, _ vh: Double, _ visible: Int32,
                               _ wx: Double, _ wy: Double, _ ww: Double, _ wh: Double, _ top: Double) {
    guard let h else { return }
    Unmanaged<BrowserMirror>.fromOpaque(h).takeUnretainedValue()
        .place(CGRect(x: x, y: y, width: w, height: hh), vh: vh, visible: visible != 0, win: CGRect(x: wx, y: wy, width: ww, height: wh), top: top)
}

@_cdecl("browser_mirror_status")
public func browserMirrorStatus(_ h: UnsafeMutableRawPointer?) -> Int32 {
    guard let h else { return 4 }
    return Unmanaged<BrowserMirror>.fromOpaque(h).takeUnretainedValue().status
}

@_cdecl("browser_mirror_blind")
public func browserMirrorBlind(_ h: UnsafeMutableRawPointer?) -> Int32 {
    guard let h else { return 0 }
    return Unmanaged<BrowserMirror>.fromOpaque(h).takeUnretainedValue().blind() ? 1 : 0
}

@_cdecl("browser_mirror_still")
public func browserMirrorStill(_ h: UnsafeMutableRawPointer?, _ path: UnsafePointer<CChar>?) -> Int32 {
    guard let h, let path else { return 0 }
    return Unmanaged<BrowserMirror>.fromOpaque(h).takeUnretainedValue().still(to: String(cString: path)) ? 1 : 0
}

@_cdecl("browser_mirror_detach")
public func browserMirrorDetach(_ h: UnsafeMutableRawPointer?) {
    guard let h else { return }
    Unmanaged<BrowserMirror>.fromOpaque(h).takeRetainedValue().stop()
}

@_cdecl("browser_mirror_set_input")
public func browserMirrorSetInput(_ h: UnsafeMutableRawPointer?, _ cb: BrowserInputCB?, _ ctx: UnsafeMutableRawPointer?) {
    guard let h else { return }
    let m = Unmanaged<BrowserMirror>.fromOpaque(h).takeUnretainedValue()
    m.inputCB = cb
    m.inputCtx = ctx
}

@_cdecl("browser_mirror_cursor")
public func browserMirrorCursor(_ h: UnsafeMutableRawPointer?, _ rx: Double, _ ry: Double) {
    guard let h else { return }
    Unmanaged<BrowserMirror>.fromOpaque(h).takeUnretainedValue().showCursor(CGFloat(rx), CGFloat(ry))
}

@_cdecl("browser_mirror_frame")
public func browserMirrorFrame(_ h: UnsafeMutableRawPointer?, _ bytes: UnsafePointer<UInt8>?, _ len: Int, _ cssW: Double, _ cssH: Double) {
    guard let h, let bytes, len > 0 else { return }
    Unmanaged<BrowserMirror>.fromOpaque(h).takeUnretainedValue().frame(Data(bytes: bytes, count: len), css: CGSize(width: cssW, height: cssH))
}
