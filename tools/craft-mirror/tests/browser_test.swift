// 세션 브라우저 비추기 계산(browser.swift BrowserMirror) 시험 — 앱 빌드엔 안 들어간다. 돌리기:
//   swiftc -parse-as-library tools/craft-mirror/{mirror,attach,browser}.swift tools/craft-mirror/tests/browser_test.swift -o /tmp/browser-test && /tmp/browser-test
import AppKit

@main
struct BrowserTest {
    static func main() {
        var failed = false
        func check(_ c: Bool, _ m: String) { print(c ? "ok  " : "FAIL", m); if !c { failed = true } }
        // 크롬 창 1400x968, 툴바 88점 → 페이지 1400x880 만 받는다
        check(BrowserMirror.pageRect(CGSize(width: 1400, height: 968), top: 88) == CGRect(x: 0, y: 88, width: 1400, height: 880), "툴바 밑 페이지만")
        check(BrowserMirror.pageRect(CGSize(width: 800, height: 600), top: -5) == CGRect(x: 0, y: 0, width: 800, height: 600), "음수 top 은 0")
        check(BrowserMirror.pageRect(CGSize(width: 800, height: 60), top: 90).height == 2, "툴바가 창보다 크면 2점만 남긴다(빈 받기 금지)")
        let a = CGRect(x: -2886, y: 1004, width: 1400, height: 968)
        check(!BrowserMirror.otherWindow(a, CGRect(x: -2886, y: 1004, width: 1100, height: 700)), "크기만 바뀌면 같은 창(앱이 칸 크기로)")
        check(BrowserMirror.otherWindow(a, CGRect(x: -2600, y: 1100, width: 500, height: 600)), "자리가 다르면 다른 창(팝업)")
        check(BrowserMirror.distance(a, a) == 0, "같은 창 거리 0")
        // 칸 1000x700 에 페이지 800x700 — 가운데 800x700, 양옆 100 씩
        let r = BrowserMirror.fit(CGSize(width: 800, height: 700), in: CGSize(width: 1000, height: 700))
        check(r == CGRect(x: 100, y: 0, width: 800, height: 700), "그림 자리는 비율 유지 가운데")
        // 칸이 페이지와 2점 안쪽으로만 다르면(칸은 소수 점, 페이지는 정수 px) 꽉 채운다 — 비율 맞춤 여백이 칸 왼쪽 끝 1px 어두운 줄로 보였다(10-28 사용자)
        check(BrowserMirror.fit(CGSize(width: 780, height: 694), in: CGSize(width: 781.5, height: 694)) == CGRect(x: 0, y: 0, width: 781.5, height: 694), "1.5점 차이는 꽉 채움")
        check(BrowserMirror.fills(CGSize(width: 780, height: 694), in: CGSize(width: 781.5, height: 695.5)), "가로세로 둘 다 2점 안쪽이면 채움")
        check(!BrowserMirror.fills(CGSize(width: 780, height: 694), in: CGSize(width: 790, height: 694)), "10점 차이(창 크기를 맞추는 중)는 비율 유지")
        check(!BrowserMirror.fills(.zero, in: CGSize(width: 10, height: 10)), "페이지 크기 모름은 채움 아님")
        // 아래 원점 뷰(높이 700): 그림 왼쪽 위 = (100, 700) → (0,0), 가운데 → (0.5, 0.5), 그림 밖 → nil
        check(BrowserMirror.ratio(CGPoint(x: 100, y: 700), in: r, flipped: false, height: 700) == CGPoint(x: 0, y: 0), "왼쪽 위는 0,0")
        check(BrowserMirror.ratio(CGPoint(x: 500, y: 350), in: r, flipped: false, height: 700) == CGPoint(x: 0.5, y: 0.5), "가운데는 0.5")
        check(BrowserMirror.ratio(CGPoint(x: 50, y: 350), in: r, flipped: false, height: 700) == nil, "그림 밖(여백)은 안 보낸다")
        check(BrowserMirror.ratio(CGPoint(x: 500, y: 175), in: r, flipped: true, height: 700) == CGPoint(x: 0.5, y: 0.25), "위 원점 뷰도")
        // 덮였을 때 깔 마지막 그림 — 그림 길(CGImage)도 읽는다
        let cs = CGColorSpaceCreateDeviceRGB()
        let ctx = CGContext(data: nil, width: 4, height: 3, bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        let img = ctx.makeImage()!
        check(BrowserMirror.image(of: img)?.width == 4, "그림 길 CGImage 도 마지막 그림")
        check(BrowserMirror.image(of: nil) == nil && BrowserMirror.image(of: "x" as NSString) == nil, "그림 아닌 건 없음")
        // 그림 길 페이지 크기 — 일꾼이 아는 페이지 점 크기(screencast deviceWidth)로. 모르면 예전처럼 2배로 짐작
        // 가린 크롬이 1배 화면이면 1400x880 그림을 700x440 페이지로 읽어 칸 크기를 못 맞췄다(10-28 사용자 흐림)
        check(BrowserMirror.castPage(CGSize(width: 1400, height: 880), css: CGSize(width: 1400, height: 880)) == CGSize(width: 1400, height: 880), "1배 그림")
        check(BrowserMirror.castPage(CGSize(width: 2800, height: 1760), css: CGSize(width: 1400, height: 880)) == CGSize(width: 1400, height: 880), "2배 그림")
        check(BrowserMirror.castPage(CGSize(width: 2800, height: 1760), css: .zero) == CGSize(width: 1400, height: 880), "모르면 2배로 짐작")
        check(BrowserMirror.castPage(CGSize(width: 2800, height: 1760), css: CGSize(width: 900, height: 900)) == CGSize(width: 1400, height: 880), "비율이 다른 옛 크기(탭이 바뀜)는 안 믿는다")
        check(BrowserMirror.mods([.command, .shift]) == 12 && BrowserMirror.mods([.option, .control]) == 3, "CDP 보조 키 번호")
        exit(failed ? 1 : 0)
    }
}
