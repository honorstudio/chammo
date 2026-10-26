use super::*;
use crate::phone_tunnel as tun;
use serde_json::json;
use std::time::{Duration, Instant};

fn v(n: u8, len: usize) -> Vec<u8> {
    let mut b = vec![n; len];
    if len == 65 {
        b[0] = 4;
    }
    b
}

#[test]
fn 숫자와_봉함은_정해진_값이다_폰_TS_와_같은_기준() {
    // 파이썬 hashlib 로 따로 계산한 값(ADR 0014) — 폰 쪽 시험(phone-web/link.test)도 같은 값을 본다
    let (pt, mt, sign, np, nm) = (v(1, 65), v(2, 65), v(3, 32), v(5, 16), v(6, 16));
    assert_eq!(hex(&commit(&pt, &np)), "428a4f53eb71855eac1a221ec8fd681433c897c42ffe888a3e0293ac13a04d64");
    assert_eq!(sas(&pt, &mt, &sign, b"d9", &np, &nm), 113_836, "기기 id 도 숫자에 든다(재리뷰 3)");
    assert_eq!(hex(&commit_m(&mt, &nm)), "6e20d412184215ea55b70bbc65640879effd9720806b16ba783471353ae4885b", "컴퓨터도 nM 을 먼저 봉한다(리뷰 2차 심각)");
    assert_eq!(sas_text(892_263), "892 263");
    assert_eq!(sas_text(5), "000 005", "앞 0 을 채운다");
}

#[test]
fn 어느_한_바이트라도_바뀌면_숫자가_바뀐다() {
    let (pt, mt, sign, np, nm) = (v(1, 65), v(2, 65), v(3, 32), v(5, 16), v(6, 16));
    let base = sas(&pt, &mt, &sign, b"d9", &np, &nm);
    assert_ne!(sas(&pt, &mt, &sign, b"d8", &np, &nm), base, "기기 id 를 바꿔 끼우면");
    let mut mt2 = mt.clone();
    mt2[40] ^= 1;
    assert_ne!(sas(&pt, &mt2, &sign, b"d9", &np, &nm), base, "컴퓨터 열쇠를 바꿔 끼우면");
    let mut pt2 = pt.clone();
    pt2[9] ^= 1;
    assert_ne!(sas(&pt2, &mt, &sign, b"d9", &np, &nm), base, "폰 열쇠를 바꿔 끼우면");
    let mut s2 = sign.clone();
    s2[0] ^= 1;
    assert_ne!(sas(&pt, &mt, &s2, b"d9", &np, &nm), base, "서명 열쇠를 바꿔 끼우면");
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// 진짜 P-256 점 — 씨앗의 공개 열쇠(seal_with 가 맨 앞에 일회용 공개 열쇠를 붙인다)
fn point(seed: u8) -> Vec<u8> {
    tun::seal_with(&[seed; 32], &[0u8; 12], &P256_G, b"").unwrap()[..65].to_vec()
}
fn phone_x() -> Vec<u8> {
    point(7)
}
fn mac_x() -> Vec<u8> {
    point(9)
}
/// P-256 생성점(압축 안 함)
const P256_G: [u8; 65] = [
    4, 0x6b, 0x17, 0xd1, 0xf2, 0xe1, 0x2c, 0x42, 0x47, 0xf8, 0xbc, 0xe6, 0xe5, 0x63, 0xa4, 0x40, 0xf2, 0x77, 0x03, 0x7d, 0x81, 0x2d, 0xeb, 0x33, 0xa0, 0xf4, 0xa1, 0x39, 0x45, 0xd8, 0x98, 0xc2, 0x96, 0x4f, 0xe3, 0x42, 0xe2, 0xfe,
    0x1a, 0x7f, 0x9b, 0x8e, 0xe7, 0xeb, 0x4a, 0x7c, 0x0f, 0x9e, 0x16, 0x2b, 0xce, 0x33, 0x57, 0x6b, 0x31, 0x5e, 0xce, 0xcb, 0xb6, 0x40, 0x68, 0x37, 0xbf, 0x51, 0xf5,
];

const SIGN: &str = "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM"; // [3;32]
const DEV: &str = "11111111-2222-3333-4444-555555555555";

fn hello(np: &[u8]) -> Value {
    let x = phone_x();
    json!({ "sign": SIGN, "x": tun::b64(&x), "ua": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)", "commit": tun::b64(&commit(&x, np)), "dev": DEV })
}

#[test]
fn 순서대로면_양쪽이_같은_숫자를_본다() {
    let l = Links::default();
    let t0 = Instant::now();
    let np = [5u8; 16];
    let mt = mac_x();
    let cm = l.first("k1", &hello(&np), SIGN, DEV, &mt, t0).expect("link1");
    let (n, h, nm) = l.reveal("k1", &np, &mt, t0).expect("link3");
    assert_eq!(cm, commit_m(&mt, &nm), "link2 의 commit 이 link4 에서 여는 nM 과 맞는다");
    assert_eq!(n, sas(&phone_x(), &mt, &tun::unb64(SIGN).unwrap(), DEV.as_bytes(), &np, &nm), "폰이 계산하는 것과 같은 식");
    assert_eq!(h.name, "iPhone");
    assert_eq!(h.dev, DEV);
    assert_eq!(l.shown("k1", t0).map(|(s, _)| s), Some(n));
}

#[test]
fn 순서를_어기면_버린다() {
    let l = Links::default();
    let t0 = Instant::now();
    let np = [5u8; 16];
    assert!(l.reveal("k1", &np, &mac_x(), t0).is_err(), "commit 없이 온 link3");
    l.first("k1", &hello(&np), SIGN, DEV, &mac_x(), t0).unwrap();
    assert!(l.first("k1", &hello(&np), SIGN, DEV, &mac_x(), t0).is_err(), "같은 두드리기의 두 번째 link1 — nM 을 다시 뽑게 두지 않는다");
    assert!(l.reveal("k1", &[6u8; 16], &mac_x(), t0).is_err(), "commit 과 다른 nP");
    assert!(l.shown("k1", t0).is_none(), "틀린 nP 뒤엔 숫자가 없다");
    assert!(l.reveal("k1", &np, &mac_x(), t0).is_err(), "한 번 틀리면 그 두드리기는 끝");
}

#[test]
fn 한_번만_연다() {
    let l = Links::default();
    let t0 = Instant::now();
    let np = [5u8; 16];
    l.first("k1", &hello(&np), SIGN, DEV, &mac_x(), t0).unwrap();
    l.reveal("k1", &np, &mac_x(), t0).unwrap();
    assert!(l.reveal("k1", &np, &mac_x(), t0).is_err(), "숫자는 한 번만");
}

#[test]
fn 남의_상자·모양이_틀린_인사는_안_받는다() {
    let l = Links::default();
    let t0 = Instant::now();
    let np = [5u8; 16];
    assert!(l.first("k1", &hello(&np), "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", DEV, &mac_x(), t0).is_err(), "허브가 확인한 열쇠와 상자 속 sign 이 다르면(옮겨 실은 상자)");
    let mut h = hello(&np);
    h["commit"] = json!("AAAA");
    assert!(l.first("k2", &h, SIGN, DEV, &mac_x(), t0).is_err(), "commit 32바이트 아님");
    let mut h = hello(&np);
    h["x"] = json!(tun::b64(&v(1, 65)));
    assert!(l.first("k3", &h, SIGN, DEV, &mac_x(), t0).is_err(), "곡선 위 점이 아닌 x");
    assert!(l.first("k4", &hello(&np), SIGN, "../x", &mac_x(), t0).is_err(), "기기 id 모양");
}

#[test]
fn 십분이_지나면_없던_일() {
    let l = Links::default();
    let t0 = Instant::now();
    let np = [5u8; 16];
    l.first("k1", &hello(&np), SIGN, DEV, &mac_x(), t0).unwrap();
    let late = t0 + LINK_TTL + Duration::from_secs(1);
    assert!(l.reveal("k1", &np, &mac_x(), late).is_err());
    let l = Links::default();
    l.first("k1", &hello(&np), SIGN, DEV, &mac_x(), t0).unwrap();
    l.reveal("k1", &np, &mac_x(), t0).unwrap();
    assert!(l.shown("k1", late).is_none(), "카드도 10분");
}

#[test]
fn 카드와_묶고_한_번만_꺼낸다() {
    let l = Links::default();
    let t0 = Instant::now();
    let np = [5u8; 16];
    l.first("k1", &hello(&np), SIGN, DEV, &mac_x(), t0).unwrap();
    l.reveal("k1", &np, &mac_x(), t0).unwrap();
    l.card("k1", "ab12cd34");
    assert!(l.take_card("zz", t0).is_none());
    let (k, h) = l.take_card("ab12cd34", t0).expect("허용한 카드의 두드리기");
    assert_eq!(k, "k1");
    assert_eq!(h.x, phone_x());
    assert!(l.take_card("ab12cd34", t0).is_none(), "두 번 못 꺼낸다(두 번 허용 = 토큰 둘)");
}

#[test]
fn 상자_속_기기_id_가_허브가_말한_기기와_같아야_한다() {
    // 리뷰 4: 털린 중계가 숫자가 맞는 카드에 다른 기기 id 를 붙이지 못하게 — 폰이 자기 id 를 봉한 상자에 넣는다
    let l = Links::default();
    let t0 = Instant::now();
    assert!(l.first("k1", &hello(&[5u8; 16]), SIGN, "22222222-2222-4222-8222-222222222222", &mac_x(), t0).is_err());
    let mut h = hello(&[5u8; 16]);
    h.as_object_mut().unwrap().remove("dev");
    assert!(l.first("k2", &h, SIGN, DEV, &mac_x(), t0).is_err(), "상자에 기기 id 가 없으면");
}

#[test]
fn 기기마다_두드리기_하나_새_것이_옛_것을_닫는다() {
    let l = Links::default();
    let t0 = Instant::now();
    let np = [5u8; 16];
    l.first("k1", &hello(&np), SIGN, DEV, &mac_x(), t0).unwrap();
    l.reveal("k1", &np, &mac_x(), t0).unwrap();
    l.card("k1", "c1");
    let closed = l.first_replacing("k2", &hello(&np), SIGN, DEV, &mac_x(), t0).unwrap().1;
    assert_eq!(closed, Some("c1".to_string()), "옛 두드리기의 카드를 닫으라고 알려 준다");
    assert!(l.take_card("c1", t0).is_none(), "옛 카드로는 못 허용");
}

#[test]
fn nM_내주기는_컴퓨터_전체로_10분에_5번() {
    // 리뷰 2차 심각: 중계가 link1 을 되풀이해 nM 을 공짜로 받아 가며 숫자를 맞추지 못하게 — link1 때 센다(기기 상관없이)
    let l = Links::default();
    let t0 = Instant::now();
    let np = [5u8; 16];
    let devs = ["11111111-0000-4000-8000-000000000001", "11111111-0000-4000-8000-000000000002", "11111111-0000-4000-8000-000000000003", "11111111-0000-4000-8000-000000000004", "11111111-0000-4000-8000-000000000005", "11111111-0000-4000-8000-000000000006"];
    for (i, d) in devs.iter().enumerate().take(5) {
        let mut h = hello(&np);
        h["dev"] = json!(d);
        assert!(l.first(&format!("k{i}"), &h, SIGN, d, &mac_x(), t0).is_ok(), "{i}");
    }
    let mut h = hello(&np);
    h["dev"] = json!(devs[5]);
    assert!(l.first("k9", &h, SIGN, devs[5], &mac_x(), t0).is_err(), "여섯째 link1 은 거부 — 다른 기기여도");
    let later = t0 + LINK_TTL + Duration::from_secs(1);
    assert!(l.first("ka", &h, SIGN, devs[5], &mac_x(), later).is_ok(), "10분 지나면 다시");
}

#[test]
fn 한도에_걸린_다시_두드리기는_옛_링크와_카드를_건드리지_않는다() {
    // 재리뷰 1: 한도·바쁨 검사 전에 옛 것을 지우면 중계가 진짜 카드를 계속 죽이거나 5칸을 태워 막을 수 있었다
    let l = Links::default();
    let t0 = Instant::now();
    let np = [5u8; 16];
    l.first("k0", &hello(&np), SIGN, DEV, &mac_x(), t0).unwrap();
    l.reveal("k0", &np, &mac_x(), t0).unwrap();
    assert!(l.card("k0", "c0"));
    for i in 1..5 {
        let d = format!("11111111-0000-4000-8000-00000000000{i}");
        let mut h = hello(&np);
        h["dev"] = json!(d);
        l.first(&format!("k{i}"), &h, SIGN, &d, &mac_x(), t0).unwrap();
    }
    assert!(l.first_replacing("kz", &hello(&np), SIGN, DEV, &mac_x(), t0).is_err(), "컴퓨터 한도(5)");
    assert!(l.take_card("c0", t0).is_some(), "한도에 걸린 다시 두드리기는 진짜 카드를 못 죽인다");
}

#[test]
fn 끊긴_두드리기엔_카드를_못_묶는다() {
    // 재리뷰 2: reveal 과 card 사이에 두드리기가 끊기면 카드가 묶이지 않고 떠 있었다 — 부른 쪽이 그 카드를 닫는다
    let l = Links::default();
    let t0 = Instant::now();
    let np = [5u8; 16];
    l.first("k1", &hello(&np), SIGN, DEV, &mac_x(), t0).unwrap();
    l.reveal("k1", &np, &mac_x(), t0).unwrap();
    l.drop_knock("k1");
    assert!(!l.card("k1", "c1"));
}

#[test]
fn 숫자_단계는_카드를_먼저_쓰고_그다음_nM_을_내준다() {
    // 재리뷰 5: 카드 쓰기가 실패하면 nM 을 내주지 않고 두드리기를 닫는다
    let l = Links::default();
    let t0 = Instant::now();
    let np = [5u8; 16];
    l.first("k1", &hello(&np), SIGN, DEV, &mac_x(), t0).unwrap();
    assert!(l.link3("k1", &np, &mac_x(), t0, |_, _| None).is_err(), "카드 못 띄움 → nM 없음");
    assert!(l.link3("k1", &np, &mac_x(), t0, |_, _| Some("c1".into())).is_err(), "그 두드리기는 끝");
    l.first("k2", &hello(&np), SIGN, DEV, &mac_x(), t0).unwrap();
    let mut wrote = None;
    let (nm, card, x) = l.link3("k2", &np, &mac_x(), t0, |h, n| { wrote = Some((h.dev.clone(), n)); Some("c2".into()) }).unwrap();
    assert_eq!(x, phone_x(), "link4 는 숫자에 든 그 폰 열쇠로 봉한다");
    assert_eq!(card, "c2");
    assert_eq!(wrote.unwrap().0, DEV, "카드를 쓴 뒤에야 nM 이 돌아온다");
    assert_eq!(l.first("k3", &hello(&np), SIGN, "11111111-0000-4000-8000-000000000009", &mac_x(), t0).ok().map(|_| ()), None, "기기 id 상자 대조는 그대로");
    let _ = nm;
}

#[test]
fn 숫자_카드는_기기마다_10분에_3장_nP_길이·재생도_죽인다() {
    let l = Links::default();
    let t0 = Instant::now();
    let np = [5u8; 16];
    for i in 0..3 {
        let k = format!("k{i}");
        l.first(&k, &hello(&np), SIGN, DEV, &mac_x(), t0).unwrap();
        assert!(l.reveal(&k, &np, &mac_x(), t0).is_ok(), "{i}");
    }
    l.first("k3", &hello(&np), SIGN, DEV, &mac_x(), t0).unwrap();
    assert!(l.reveal("k3", &np, &mac_x(), t0).is_err(), "같은 기기 넷째 숫자는 막는다(컴퓨터 한도 5 안이어도)");
    let l = Links::default();
    l.first("k1", &hello(&np), SIGN, DEV, &mac_x(), t0).unwrap();
    assert!(l.reveal("k1", &np[..15], &mac_x(), t0).is_err(), "nP 길이 틀림");
    assert!(l.reveal("k1", &np, &mac_x(), t0).is_err(), "틀린 뒤엔 맞는 nP 도 끝");
}

#[test]
fn 셈은_메모리라_앱을_다시_켜면_비어_있다() {
    // 받아들인 대가(ADR 0014): 한도 셈은 메모리 — 앱 재시작이 리셋한다. 재시작은 사람 화면에 보이는 일이라 받아들인다
    let l = Links::default();
    let t0 = Instant::now();
    let np = [5u8; 16];
    for i in 0..5 {
        let d = format!("11111111-0000-4000-8000-00000000000{i}");
        let mut h = hello(&np);
        h["dev"] = json!(d);
        l.first(&format!("k{i}"), &h, SIGN, &d, &mac_x(), t0).unwrap();
    }
    assert!(l.first("k9", &hello(&np), SIGN, DEV, &mac_x(), t0).is_err());
    let restarted = Links::default();
    assert!(restarted.first("k9", &hello(&np), SIGN, DEV, &mac_x(), t0).is_ok());
}
