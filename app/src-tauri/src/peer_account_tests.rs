use super::*;
use crate::phone_tunnel as tun;

fn me() -> Mine {
    Mine { account: "acct-me".into(), device: "dev-mac".into() }
}

fn seen(at: u64, ids: &[&str]) -> Seen {
    Seen { mine: me(), at_ms: at, computers: ids.iter().map(|i| (i.to_string(), String::new())).collect(), phones: vec![] }
}

const NOW: u64 = 10_000_000;

#[test]
fn 같은_계정_허용_컴퓨터면_통과_1분_안이면_fresh() {
    let s = seen(NOW - 1_000, &["dev-pc", "dev-imac"]);
    assert_eq!(judge(Some("dev-pc"), Some(&me()), Some(&s), NOW), Verdict::Same { fresh: true });
    assert!(judge(Some("dev-pc"), Some(&me()), Some(&s), NOW).strict());
    // 묵은 목록(10분 안)은 보통 길만 — 결제·운영은 안 된다
    let old = seen(NOW - FRESH_MS - 1, &["dev-pc"]);
    let v = judge(Some("dev-pc"), Some(&me()), Some(&old), NOW);
    assert_eq!(v, Verdict::Same { fresh: false });
    assert!(v.ok() && !v.strict());
}

#[test]
fn 상대가_로그아웃했거나_다른_계정이면_멈춘다() {
    // 로그아웃 = 서버가 그 기기를 끊어 목록에서 빠짐. 다른 계정으로 로그인 = 새 기기 id(목록에 없음)
    let s = seen(NOW, &["dev-imac"]);
    assert_eq!(judge(Some("dev-pc"), Some(&me()), Some(&s), NOW), Verdict::Other);
}

#[test]
fn 묶이지_않은_옛_짝은_멈춘다_빈_칸_모양_틀린_칸도() {
    let s = seen(NOW, &["dev-pc"]);
    for b in [None, Some(""), Some("dev pc"), Some("a/../b"), Some(&*"x".repeat(65))] {
        assert_eq!(judge(b, Some(&me()), Some(&s), NOW), Verdict::Unbound, "{b:?}");
    }
}

#[test]
fn 내가_로그아웃했으면_아무것도_안_된다() {
    assert_eq!(judge(Some("dev-pc"), None, Some(&seen(NOW, &["dev-pc"])), NOW), Verdict::NoLogin);
}

#[test]
fn 내_계정이_바뀌면_옛_목록은_안_믿는다() {
    let other = Mine { account: "acct-other".into(), device: "dev-mac2".into() };
    assert_eq!(judge(Some("dev-pc"), Some(&other), Some(&seen(NOW, &["dev-pc"])), NOW), Verdict::Unknown);
}

#[test]
fn 서버를_10분_넘게_못_물으면_확인_못_함() {
    assert_eq!(judge(Some("dev-pc"), Some(&me()), Some(&seen(NOW - GRACE_MS - 1, &["dev-pc"])), NOW), Verdict::Unknown);
    assert_eq!(judge(Some("dev-pc"), Some(&me()), None, NOW), Verdict::Unknown);
}

#[test]
fn 내_기기_id_를_대는_짝은_거절() {
    assert_eq!(judge(Some("dev-mac"), Some(&me()), Some(&seen(NOW, &["dev-mac"])), NOW), Verdict::Other);
}

#[test]
fn 오류_글은_account_머리로_오가고_화면_한_줄이_있다() {
    assert_eq!(Verdict::Other.err(), "account:other");
    assert_eq!(paused("account:unbound"), Some("unbound"));
    assert_eq!(paused("  account:other  "), Some("other"));
    assert_eq!(paused("pair"), None);
    assert!(word("other").contains("계정이 바뀌어 연결이 멈췄어요"));
    assert!(word("unbound").contains("재연결"));
}

#[test]
fn 서버_목록_읽기_모양_틀린_줄은_뺀다() {
    let v = serde_json::json!({ "computers": [ { "id": "dev-pc", "tunnelPub": "X" }, { "id": "bad id" }, { "name": "no id" }, { "id": "dev-imac" } ] });
    assert_eq!(computers_of(&v), vec![("dev-pc".to_string(), "X".to_string()), ("dev-imac".to_string(), String::new())]);
    assert!(computers_of(&serde_json::json!({ "status": "pending" })).is_empty());
}

// ── 짝지을 때 증명 — 진짜 P-256 열쇠로

fn key(n: u8) -> p256::SecretKey {
    tun::secret_from_seed(&[n; 32]).unwrap()
}

fn pubb64(k: &p256::SecretKey) -> String {
    tun::b64(&tun::public_of(k))
}

const CTX: &str = "0123456789abcdef0123456789abcdef";

/// 맥(dev-mac, 열쇠 1)·PC(dev-pc, 열쇠 2)·아이맥(dev-imac, 열쇠 3) — 셋 다 같은 계정
fn world() -> (Mine, Mine, Vec<(String, String)>, Vec<(String, String)>) {
    let mac = me();
    let pc = Mine { account: "acct-me".into(), device: "dev-pc".into() };
    let mac_sees = vec![("dev-pc".to_string(), pubb64(&key(2))), ("dev-imac".to_string(), pubb64(&key(3)))];
    let pc_sees = vec![("dev-mac".to_string(), pubb64(&key(1))), ("dev-imac".to_string(), pubb64(&key(3)))];
    (mac, pc, mac_sees, pc_sees)
}

fn agree_of(n: u8) -> impl Fn(&[u8]) -> Option<[u8; 32]> {
    move |x| tun::agree(&key(n), x).ok()
}

#[test]
fn 증명_왕복_같은_계정이면_서로_확인된다() {
    let (mac, pc, mac_sees, pc_sees) = world();
    // PC 가 맥에게 요청 — 맥이 PC 계정 목록에 있어야 만든다
    let b = make(&pc, "dev-mac", CTX, &pc_sees, &agree_of(2)).unwrap();
    assert_eq!(b.device, "dev-pc");
    let resp = verify(&mac, &b, CTX, &mac_sees, &agree_of(1)).unwrap();
    assert!(check_reply(&pc, "dev-mac", CTX, &resp, &pc_sees, &agree_of(2)));
}

#[test]
fn 다른_계정_기기면_증명을_못_만들고_못_받는다() {
    let (mac, pc, _mac_sees, pc_sees) = world();
    // 다른 계정으로 바뀐 PC — 그 계정 목록엔 맥이 없다
    assert_eq!(make(&pc, "dev-mac", CTX, &[], &agree_of(2)), Err(Verdict::Other));
    // 맥 목록에 PC 가 없다(로그아웃·다른 계정) — 증명이 맞아도 거절
    let b = make(&pc, "dev-mac", CTX, &pc_sees, &agree_of(2)).unwrap();
    assert_eq!(verify(&mac, &b, CTX, &[("dev-imac".into(), pubb64(&key(3)))], &agree_of(1)), Err(Verdict::Other));
}

#[test]
fn 내_다른_컴퓨터_id_를_빌려_대면_증명이_안_맞는다() {
    let (mac, _pc, mac_sees, _) = world();
    // 열쇠 9 를 가진 가짜가 '나는 아이맥(dev-imac)' 이라고 — 아이맥 열쇠가 없어서 맥이 계산한 맥과 다르다
    let fake = Mine { account: "acct-me".into(), device: "dev-imac".into() };
    let b = make(&fake, "dev-mac", CTX, &[("dev-mac".into(), pubb64(&key(1)))], &agree_of(9)).unwrap();
    assert_eq!(verify(&mac, &b, CTX, &mac_sees, &agree_of(1)), Err(Verdict::Other));
}

#[test]
fn 다른_짝짓기에_재생하거나_칸을_비우면_거절() {
    let (mac, pc, mac_sees, pc_sees) = world();
    let b = make(&pc, "dev-mac", CTX, &pc_sees, &agree_of(2)).unwrap();
    assert!(verify(&mac, &b, "fedcba9876543210fedcba9876543210", &mac_sees, &agree_of(1)).is_err(), "다른 요청 번호");
    assert!(verify(&mac, &Bind { device: String::new(), proof: b.proof.clone() }, CTX, &mac_sees, &agree_of(1)).is_err(), "기기 칸 비움");
    assert!(verify(&mac, &Bind { device: b.device.clone(), proof: String::new() }, CTX, &mac_sees, &agree_of(1)).is_err(), "증명 칸 비움");
    assert!(verify(&mac, &Bind { device: "dev-mac".into(), proof: b.proof.clone() }, CTX, &mac_sees, &agree_of(1)).is_err(), "내 기기 id");
    assert!(verify(&mac, &b, "", &mac_sees, &agree_of(1)).is_err(), "빈 ctx");
    // 답 증명을 요청 증명으로 되돌려 써도 안 맞는다(역할 글이 다르다)
    let resp = verify(&mac, &b, CTX, &mac_sees, &agree_of(1)).unwrap();
    assert!(verify(&mac, &Bind { device: "dev-pc".into(), proof: resp.clone() }, CTX, &mac_sees, &agree_of(1)).is_err());
    assert!(!check_reply(&pc, "dev-mac", CTX, &b.proof, &pc_sees, &agree_of(2)), "요청 증명을 답으로");
    assert!(!check_reply(&pc, "dev-mac", CTX, "", &pc_sees, &agree_of(2)));
}

#[test]
fn 로그인_안_했거나_허용_대기면_내_계정이_없다() {
    use crate::team_relay::{Account, TeamState};
    let mut st = TeamState { device_id: "dev-mac".into(), key_account: "k".into(), account: Some(Account { id: "acct-me".into(), ..Default::default() }), ..Default::default() };
    assert_eq!(mine_of(&st), Some(me()));
    st.pending = true;
    assert_eq!(mine_of(&st), None);
    st.pending = false;
    st.revoked = true;
    assert_eq!(mine_of(&st), None);
    st.revoked = false;
    st.account = None;
    assert_eq!(mine_of(&st), None, "초대 코드만 쓴 옛 기기");
    st.account = Some(Account::default());
    assert_eq!(mine_of(&st), None, "계정 id 빈 칸");
}

#[test]
fn 보유_증명은_그_열쇠_시각_길에_묶인다() {
    let (mac_k, pc_k) = (key(1), key(2));
    // PC 가 만든 것 — 맥이 PC 공개 열쇠로 합의해 확인
    let s_pc = tun::agree(&pc_k, &tun::public_of(&mac_k)).unwrap();
    let s_mac = tun::agree(&mac_k, &tun::public_of(&pc_k)).unwrap();
    let h = live_make(&s_pc, "dev-pc", "dev-mac", NOW, "GET", "/api/direct?x=1");
    assert!(live_ok(&s_mac, "dev-pc", "dev-mac", &h, "GET", "/api/direct", NOW + 1_000), "쿼리는 안 본다");
    assert!(!live_ok(&s_mac, "dev-pc", "dev-mac", &h, "POST", "/api/direct", NOW), "다른 방법");
    assert!(!live_ok(&s_mac, "dev-pc", "dev-mac", &h, "GET", "/api/peer-direct-answer", NOW), "다른 길");
    assert!(!live_ok(&s_mac, "dev-imac", "dev-mac", &h, "GET", "/api/direct", NOW), "다른 기기라고 우김");
    assert!(!live_ok(&s_mac, "dev-pc", "dev-mac", &h, "GET", "/api/direct", NOW + LIVE_SKEW_MS + 1), "2분 넘은 재생");
    // 열쇠가 없는(데이터를 지운) 기기가 다른 열쇠로 만든 것
    let s_fake = tun::agree(&key(9), &tun::public_of(&mac_k)).unwrap();
    assert!(!live_ok(&s_mac, "dev-pc", "dev-mac", &live_make(&s_fake, "dev-pc", "dev-mac", NOW, "GET", "/api/direct"), "GET", "/api/direct", NOW));
    for bad in ["", ".", "abc", &format!("{NOW}."), &format!("x.{}", "0".repeat(64)), &format!("{NOW}.{}", "0".repeat(64))] {
        assert!(!live_ok(&s_mac, "dev-pc", "dev-mac", bad, "GET", "/api/direct", NOW), "{bad}");
    }
}

// ── 폰 줄(11-09 2차) — 컴퓨터 브라우저로 폰 화면을 열어 만든 줄이 계정 확인 없이 결제 카드에 답할 수 있었다

fn seen_phones(at: u64, phones: &[&str]) -> Seen {
    Seen { mine: me(), at_ms: at, computers: vec![], phones: phones.iter().map(|p| p.to_string()).collect() }
}

#[test]
fn 폰_직통_줄은_계정을_확인할_길이_없어_unbound() {
    // 로그인했든 안 했든, 목록이 있든 없든 — 중계 기기 id 가 없으면
    assert_eq!(judge_phone(None, Some(&me()), Some(&seen_phones(NOW, &["ph-1"])), NOW), Verdict::Unbound);
    assert_eq!(judge_phone(None, None, None, NOW), Verdict::Unbound);
    assert_eq!(judge_phone(Some(""), Some(&me()), Some(&seen_phones(NOW, &[""])), NOW), Verdict::Unbound, "빈 칸");
}

#[test]
fn 폰_중계_줄은_내_계정_허용_폰일_때만() {
    let s = seen_phones(NOW, &["ph-1"]);
    assert_eq!(judge_phone(Some("ph-1"), Some(&me()), Some(&s), NOW), Verdict::Same { fresh: true });
    assert_eq!(judge_phone(Some("ph-9"), Some(&me()), Some(&s), NOW), Verdict::Other, "끊긴 폰·다른 계정");
    assert_eq!(judge_phone(Some("ph-1"), None, Some(&s), NOW), Verdict::NoLogin, "내가 로그아웃");
    assert_eq!(judge_phone(Some("ph-1"), Some(&me()), Some(&seen_phones(NOW - FRESH_MS - 1, &["ph-1"])), NOW), Verdict::Same { fresh: false }, "묵은 목록은 결제류 안 됨");
    assert_eq!(judge_phone(Some("ph-1"), Some(&me()), Some(&seen_phones(NOW - GRACE_MS - 1, &["ph-1"])), NOW), Verdict::Unknown);
    // 컴퓨터 목록에 있는 id 는 폰으로 안 친다
    let c = Seen { mine: me(), at_ms: NOW, computers: vec![("ph-1".into(), String::new())], phones: vec![] };
    assert_eq!(judge_phone(Some("ph-1"), Some(&me()), Some(&c), NOW), Verdict::Other);
}

#[test]
fn 계정_기기_목록에서_허용된_폰만() {
    let v = serde_json::json!({ "devices": [
        { "id": "ph-1", "kind": "phone", "status": "approved" },
        { "id": "ph-2", "kind": "phone", "status": "pending" },
        { "id": "mac-1", "kind": "mac", "status": "approved" },
        { "id": "bad id", "kind": "phone", "status": "approved" },
    ] });
    assert_eq!(phones_of(&v), vec!["ph-1".to_string()]);
    assert!(phones_of(&serde_json::json!({})).is_empty());
}

// 11-12 — 10월 테일넷 짝(기기 id 없음)은 계정이 바뀐 게 아니라 예전 방식 연결이라 다시 연결해야 한다
#[test]
fn 예전_방식_짝은_계정이_바뀐_게_아니라_다시_연결이_필요하다고() {
    assert!(word("unbound").contains("예전 방식"), "{}", word("unbound"));
    assert!(!word("unbound").contains("계정이 바뀌어"));
    assert!(word("other").contains("계정이 바뀌어 연결이 멈췄어요"));
}

