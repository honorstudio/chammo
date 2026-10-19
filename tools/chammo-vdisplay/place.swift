// 자리 계산 — 순수 함수(화면을 안 건드린다). 좌표는 CoreGraphics 전역(주 화면 왼쪽 위 원점, y 아래로)
import CoreGraphics

/// 구석 종류 — 맥 핫코너 이름(wvous-tl/tr/bl/br)과 같다
enum Corner: String, CaseIterable { case br, bl, tr, tl }

/// 가짜 화면 자리(왼쪽 위) — 실제 화면의 바깥 모서리에 대각선으로 한 점만 닿게(변을 맞대지 않아 마우스가 넘어갈 길이 그 점뿐).
/// 핫코너가 걸린 종류의 구석은 피한다 — 가짜 화면이 닿은 구석은 맥이 구석으로 안 쳐서 핫코너가 안 됐다(2026-10-03 사용자 실측, 오른쪽 아래 '빠른 메모').
/// 순서: 핫코너 없는 br → bl → tr → tl, 같은 종류면 가장 바깥 구석. 다 막히면 핫코너 구석이라도. 화면이 없으면 nil
func pickOrigin(_ displays: [CGRect], size: CGSize, hot: Set<Corner>) -> CGPoint? {
  func valid(_ r: CGRect) -> Bool {
    for d in displays {
      let i = r.intersection(d)
      if !i.isNull && (i.width > 0 || i.height > 0) { return false } // 겹치거나 변을 맞댄다
    }
    return true
  }
  func candidates(_ c: Corner) -> [(score: CGFloat, origin: CGPoint)] {
    displays.compactMap { d in
      let (p, o, score): (CGPoint, CGPoint, CGFloat) = {
        switch c {
        case .br: return (CGPoint(x: d.maxX, y: d.maxY), CGPoint(x: d.maxX, y: d.maxY), d.maxX + d.maxY)
        case .bl: return (CGPoint(x: d.minX, y: d.maxY), CGPoint(x: d.minX - size.width, y: d.maxY), -d.minX + d.maxY)
        case .tr: return (CGPoint(x: d.maxX, y: d.minY), CGPoint(x: d.maxX, y: d.minY - size.height), d.maxX - d.minY)
        case .tl: return (CGPoint(x: d.minX, y: d.minY), CGPoint(x: d.minX - size.width, y: d.minY - size.height), -d.minX - d.minY)
        }
      }()
      _ = p
      return valid(CGRect(origin: o, size: size)) ? (score, o) : nil
    }
  }
  for pass in [false, true] {
    for c in Corner.allCases where pass || !hot.contains(c) {
      if let best = candidates(c).max(by: { $0.score < $1.score }) { return best.origin }
    }
  }
  return nil
}

/// 맥 핫코너가 걸린 구석(값 0·1 = 없음)
func hotCorners(_ read: (String) -> Int) -> Set<Corner> {
  Set(Corner.allCases.filter { read("wvous-\($0.rawValue)-corner") > 1 })
}

/// 커서 막이 — 커서가 가짜 화면 안에 들어가면 보이는 화면 안 가장 가까운 점(1px 안쪽)으로. 밖이면 nil
func rescue(_ p: CGPoint, virtual v: CGRect, others: [CGRect]) -> CGPoint? {
  guard v.contains(p), !others.isEmpty else { return nil }
  var best: CGPoint?
  var bestD = CGFloat.infinity
  for r in others where r.width >= 2 && r.height >= 2 {
    let q = CGPoint(x: min(max(p.x, r.minX), r.maxX - 1), y: min(max(p.y, r.minY), r.maxY - 1))
    let d = hypot(q.x - p.x, q.y - p.y)
    if d < bestD { bestD = d; best = q }
  }
  return best
}

/// 'linger <pid> …' 줄 → pid 들(빈 줄이면 비우기), 다른 줄이면 nil
func lingerPids(_ line: String) -> [pid_t]? {
  let p = line.split(separator: " ")
  guard p.first == "linger" else { return nil }
  let pids = p.dropFirst().map { pid_t($0) }
  return pids.contains(nil) ? nil : pids.compactMap { $0 }
}

/// --test — 도우미를 빌드한 뒤 앱 테스트(Rust)가 부른다. 실패하면 1
func selfTest() -> Int32 {
  var fails = 0
  func eq(_ a: CGPoint?, _ b: CGPoint?, _ msg: String) { if a != b { print("FAIL \(msg): \(String(describing: a)) != \(String(describing: b))"); fails += 1 } }
  let main = CGRect(x: 0, y: 0, width: 1920, height: 1080)
  let book = CGRect(x: -1470, y: 0, width: 1470, height: 956)
  let vs = CGSize(width: 1440, height: 900)
  // 핫코너가 없으면 메인 오른쪽 아래 모서리(가장 바깥 br)
  eq(pickOrigin([main, book], size: vs, hot: []), CGPoint(x: 1920, y: 1080), "두 화면·핫코너 없음")
  // 사용자 배치 — 오른쪽 아래가 핫코너(빠른 메모)면 왼쪽 아래 종류 중 가장 바깥: 맥북 왼쪽 아래 모서리에 대각선으로
  eq(pickOrigin([main, book], size: vs, hot: [.br]), CGPoint(x: -1470 - 1440, y: 956), "오른쪽 아래 핫코너 피함")
  // 외장 모니터를 빼면 맥북 혼자(0,0) — 핫코너 피해 왼쪽 아래
  eq(pickOrigin([CGRect(x: 0, y: 0, width: 1470, height: 956)], size: vs, hot: [.br]), CGPoint(x: -1440, y: 956), "맥북 혼자")
  eq(pickOrigin([CGRect(x: 0, y: 0, width: 1470, height: 956)], size: vs, hot: []), CGPoint(x: 1470, y: 956), "맥북 혼자·핫코너 없음")
  // 네 구석 다 핫코너면 그래도 둔다(br)
  eq(pickOrigin([main], size: vs, hot: Set(Corner.allCases)), CGPoint(x: 1920, y: 1080), "다 핫코너")
  // ㄱ자 배치(외장이 맥북 오른쪽 아래) — 전체 네모의 빈 구석이 아니라 실제 화면 모서리, 변을 맞대지 않는 자리만
  let low = CGRect(x: 1470, y: 956, width: 1920, height: 1080), top = CGRect(x: 0, y: 0, width: 1470, height: 956)
  let o = pickOrigin([top, low], size: vs, hot: [])!
  let r = CGRect(origin: o, size: vs)
  for d in [top, low] { let i = r.intersection(d); if !i.isNull && (i.width > 0 || i.height > 0) { print("FAIL ㄱ자 변 맞댐"); fails += 1 } }
  eq(o, CGPoint(x: 3390, y: 2036), "ㄱ자 배치 — 아래 외장 오른쪽 아래")
  eq(pickOrigin([], size: vs, hot: []), nil, "화면 없음")
  eq(hotCorners { $0 == "wvous-br-corner" ? 14 : 1 } == [.br] ? CGPoint.zero : nil, CGPoint.zero, "핫코너 읽기(1 = 없음)")
  let v = CGRect(x: 1920, y: 1080, width: 1440, height: 900)
  eq(rescue(CGPoint(x: 1925, y: 1085), virtual: v, others: [main, book]), CGPoint(x: 1919, y: 1079), "모서리로 넘어감 → 메인 모서리 안쪽")
  eq(rescue(CGPoint(x: 3000, y: 1900), virtual: v, others: [main, book]), CGPoint(x: 1919, y: 1079), "깊이 들어감")
  eq(rescue(CGPoint(x: 1000, y: 500), virtual: v, others: [main, book]), nil, "보이는 화면 안은 그대로")
  eq(rescue(CGPoint(x: 1920, y: 1080), virtual: v, others: [main, book]), CGPoint(x: 1919, y: 1079), "모서리 한 점")
  // linger — Chammo 가 꺼질 때 저장 중인 Craft pid 를 넘기면 그 앱들이 꺼질 때까지 화면을 살려 둔다
  if lingerPids("linger 101 202") != [101, 202] { print("FAIL linger 두 pid"); fails += 1 }
  if lingerPids("linger") != [] { print("FAIL linger 비움"); fails += 1 }
  if lingerPids("scale 2") != nil || lingerPids("linger x") != nil { print("FAIL linger 아닌 줄"); fails += 1 }
  print(fails == 0 ? "ok" : "\(fails) failed")
  return fails == 0 ? 0 : 1
}
