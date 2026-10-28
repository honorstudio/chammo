use super::*;

fn k(n: u8) -> DeviceKeys {
    DeviceKeys::from_seeds([n; 32], [n.wrapping_add(100); 32])
}

fn meta() -> Meta {
    Meta { room: "r1".into(), cid: "c1".into(), from: "d1".into(), head: "H1".into(), peers: BTreeMap::from([("a2".into(), "H2".into())]), roster: "R1".into() }
}

fn to(ids: &[(u8, &str)]) -> Vec<Recipient> {
    ids.iter().map(|(n, d)| Recipient { device: d.to_string(), e2e: k(*n).e2e_public() }).collect()
}

fn inner(origin: &str) -> Inner {
    Inner { origin: origin.into(), text: "회의 3시".into(), at: 7, ..Default::default() }
}

#[test]
fn 받는_기기마다_열리고_머리·안쪽이_그대로() {
    let body = seal(&k(1), &meta(), &inner("human"), &to(&[(2, "d2"), (1, "d1")])).unwrap();
    for (n, d) in [(2, "d2"), (1, "d1")] {
        let (m, i) = open(&k(n), d, &body, Some(&k(1).public())).unwrap();
        assert_eq!(m, meta());
        assert_eq!(i, inner("human"));
    }
    assert!(!body.contains("회의"), "평문이 봉투에 없다");
}

#[test]
fn 받는_사람이_아니면_not_for_me_보낸_기기를_모르거나_다른_열쇠면_sig() {
    let body = seal(&k(1), &meta(), &inner("agent"), &to(&[(2, "d2")])).unwrap();
    assert_eq!(open(&k(3), "d3", &body, Some(&k(1).public())), Err(EnvErr::NotForMe));
    assert_eq!(open(&k(2), "d2", &body, None), Err(EnvErr::Sig));
    assert_eq!(open(&k(2), "d2", &body, Some(&k(9).public())), Err(EnvErr::Sig));
}

#[test]
fn 서버가_머리·봉투_목록·사람_말_표시를_바꾸면_서명에_걸린다() {
    let body = seal(&k(1), &meta(), &inner("agent"), &to(&[(2, "d2"), (3, "d3")])).unwrap();
    let mut v: Value = serde_json::from_str(&body).unwrap();
    for (key, val) in [("room", json!("r9")), ("cid", json!("c9")), ("from", json!("d9")), ("head", json!("H9")), ("roster", json!("R9")), ("peers", json!({ "a2": "H9" }))] {
        let mut x = v.clone();
        x[key] = val;
        assert_eq!(open(&k(2), "d2", &x.to_string(), Some(&k(1).public())), Err(EnvErr::Sig), "{key}");
    }
    // 봉투 하나 빼기(그 사람을 몰래 빼기)도 서명에 걸린다
    v["env"].as_array_mut().unwrap().pop();
    assert_eq!(open(&k(2), "d2", &v.to_string(), Some(&k(1).public())), Err(EnvErr::Sig));
}

#[test]
fn 사람마다_다른_내용_열쇠를_봉하면_kh_에_걸린다() {
    // 나쁜 보낸 사람: d2 몫엔 진짜 k, d3 몫엔 다른 k' 를 봉하고 서명은 정상으로
    let m = meta();
    let pt = serde_json::to_vec(&inner("agent")).unwrap();
    let (k1, k2) = ([1u8; 32], [2u8; 32]);
    let iv = [9u8; 12];
    let ct = B64.encode(Aes256Gcm::new(&k1.into()).encrypt(Nonce::from_slice(&iv), Payload { msg: &pt, aad: &content_aad(&m) }).unwrap());
    let iv = B64.encode(iv);
    let wrap = |n: u8, d: &str, key: &[u8; 32]| {
        let (enc, w) = e2e_hpke::seal(&B64.decode(k(n).e2e_public()).unwrap(), &info(&m.room, &m.cid, d), b"", key).unwrap();
        (d.to_string(), B64.encode(enc), B64.encode(w))
    };
    let env = vec![wrap(2, "d2", &k1), wrap(3, "d3", &k2)];
    let kh = key_hash(&k1);
    let sig = k(1).sign(&sig_text(&m, &kh, &ct, &iv, &env));
    let body = json!({ "v": 1, "room": m.room, "cid": m.cid, "from": m.from, "head": m.head, "peers": m.peers, "roster": m.roster, "iv": iv, "ct": ct, "kh": kh,
        "env": env.iter().map(|(d, e, w)| json!({ "d": d, "enc": e, "w": w })).collect::<Vec<_>>(), "sig": sig }).to_string();
    assert!(open(&k(2), "d2", &body, Some(&k(1).public())).is_ok());
    assert_eq!(open(&k(3), "d3", &body, Some(&k(1).public())), Err(EnvErr::Open));
}

#[test]
fn 안쪽_사람_말_표시는_정확히_human_일_때만() {
    for o in ["Human", "", "person", "human "] {
        let body = seal(&k(1), &meta(), &inner(o), &to(&[(2, "d2")])).unwrap();
        assert_eq!(open(&k(2), "d2", &body, Some(&k(1).public())).unwrap().1.origin, "agent", "{o:?}");
    }
}

#[test]
fn 서버_모양_검사를_지난다_v1·방·cid·보낸_기기·봉투_하나씩() {
    let body = seal(&k(1), &meta(), &inner("agent"), &to(&[(2, "d2"), (1, "d1")])).unwrap();
    let v: Value = serde_json::from_str(&body).unwrap();
    assert_eq!((v["v"].as_u64(), v["room"].as_str(), v["cid"].as_str(), v["from"].as_str()), (Some(1), Some("r1"), Some("c1"), Some("d1")));
    for k in ["iv", "ct", "kh", "sig", "head"] {
        assert!(v[k].as_str().is_some_and(|s| !s.is_empty()), "{k}");
    }
    // 키는 가나다순으로 나간다('{"ct":…') — 서버 drop_plain 은 키 순서와 상관없이 v=1 JSON 을 봉투로 본다(json_extract)
    assert!(seal(&k(1), &meta(), &inner("agent"), &[]).is_err());
}

#[test]
fn via_가_비면_옛_봉투와_같은_안쪽_글이다() {
    let s = serde_json::to_string(&inner("human")).unwrap();
    assert!(!s.contains("via"), "{s}");
    let old: Inner = serde_json::from_str(r#"{"origin":"agent","text":"x","at":1}"#).unwrap();
    assert_eq!(old.via, "");
}


// ── 반응·파일(chammo-relay team-rooms v2) ──

#[test]
fn 반응·파일_칸은_봉투_안에_실리고_비면_옛_모양_그대로() {
    let mut i = inner("human");
    i.extra = Extra { react: Some(React { seq: 3, mark: "check".into(), on: true }), files: vec![serde_json::json!({ "id": "f1", "team": "t1", "room": "r1", "name": "시안.pdf", "size": 1200 })], ..Default::default() };
    let body = seal(&k(1), &meta(), &i, &to(&[(2, "d2")])).unwrap();
    let (_, got) = open(&k(2), "d2", &body, Some(&k(1).public())).unwrap();
    assert_eq!(got, i);
    assert!(!body.contains("시안.pdf"), "파일 이름도 암호 안");
    // 칸 없는 옛 봉투 안쪽도 읽힌다, 빈 칸은 안 쓴다
    let old: Inner = serde_json::from_str(r#"{"origin":"agent","text":"x","at":1}"#).unwrap();
    assert_eq!(old.extra, Extra::default());
    assert_eq!(serde_json::to_string(&inner("agent")).unwrap(), r#"{"origin":"agent","text":"회의 3시","at":7}"#);
}

#[test]
fn 모르는_표식·너무_많은_파일·모양_틀린_파일은_거절() {
    assert!(Extra { react: Some(React { seq: 1, mark: "fire".into(), on: true }), ..Default::default() }.check().is_err());
    assert!(Extra { react: Some(React { seq: 0, mark: "like".into(), on: true }), ..Default::default() }.check().is_err());
    let f = serde_json::json!({ "id": "f", "name": "a", "size": 1 });
    assert!(Extra { files: vec![f.clone(); MAX_FILES + 1], ..Default::default() }.check().is_err());
    assert!(Extra { files: vec![serde_json::json!({ "id": "f", "name": "a" })], ..Default::default() }.check().is_err());
    assert!(Extra { files: vec![f], react: Some(React { seq: 2, mark: "heart".into(), on: false }), ..Default::default() }.check().is_ok());
}

#[test]
fn 참모_별명은_짧은_글만() {
    assert!(Extra { by: "회사 비서".into(), ..Default::default() }.check().is_ok());
    assert!(Extra { by: "가".repeat(41), ..Default::default() }.check().is_err());
    assert!(!serde_json::to_string(&Extra::default()).unwrap().contains("by"), "빈 별명은 봉투에 안 싣는다(옛 판과 같은 모양)");
}

#[test]
fn 팀_참모_칸_agent_re_는_비면_안_싣고_모양을_본다() {
    let e = serde_json::to_string(&Extra::default()).unwrap();
    assert!(!e.contains("agent") && !e.contains("\"re\""), "빈 칸은 봉투에 안 싣는다(옛 판과 같은 모양)");
    let ok = Extra { agent: "aaaaaaaaaaaaaaaa1".into(), re: 12, by: "회의록".into(), ..Default::default() };
    assert!(ok.check().is_ok());
    let back: Extra = serde_json::from_str(&serde_json::to_string(&ok).unwrap()).unwrap();
    assert_eq!(back, ok);
    assert!(Extra { agent: "../x".into(), ..Default::default() }.check().is_err(), "참모 id 모양이 틀리면 거절");
    assert!(Extra { agent: "a".repeat(65), ..Default::default() }.check().is_err());
}

// ── 지난 대화 건네주기(chammo-relay ADR 0007 R10) ──

#[test]
fn 건네받은_열쇠로_봉투_목록에_없던_기기가_연다() {
    let body = seal(&k(1), &meta(), &inner("human"), &to(&[(1, "d1"), (2, "d2")])).unwrap();
    assert_eq!(open(&k(4), "d4", &body, Some(&k(1).public())), Err(EnvErr::NotForMe));
    let late = rewrap(&k(2), "d2", &body, Some(&k(1).public()), &to(&[(4, "d4")])[0]).unwrap();
    let (m, i) = open_late(&k(4), "d4", &body, Some(&k(1).public()), &late).unwrap();
    assert_eq!(m, meta());
    assert_eq!(i, inner("human"));
    assert_eq!(recipients(&body), vec!["d1".to_string(), "d2".to_string()]);
}

#[test]
fn 건넨_열쇠는_그_기기·그_말에만_열린다() {
    let body = seal(&k(1), &meta(), &inner("agent"), &to(&[(2, "d2")])).unwrap();
    let late = rewrap(&k(2), "d2", &body, Some(&k(1).public()), &to(&[(4, "d4")])[0]).unwrap();
    // 다른 기기가 가로채 써도 info(방·cid·기기)가 달라 안 열린다
    assert_eq!(open_late(&k(5), "d5", &body, Some(&k(1).public()), &late), Err(EnvErr::Open));
    assert_eq!(open_late(&k(4), "d5", &body, Some(&k(1).public()), &late), Err(EnvErr::Open));
    // 다른 말에 붙이면 kh·info 가 달라 안 열린다
    let other = seal(&k(1), &Meta { cid: "c2".into(), ..meta() }, &inner("agent"), &to(&[(2, "d2")])).unwrap();
    assert_eq!(open_late(&k(4), "d4", &other, Some(&k(1).public()), &late), Err(EnvErr::Open));
}

#[test]
fn 공격_서버가_지어낸_열쇠나_바꾼_원래_봉투는_안_열린다() {
    let body = seal(&k(1), &meta(), &inner("human"), &to(&[(2, "d2")])).unwrap();
    // 서버는 k 를 몰라 아무 열쇠나 d4 에 봉한다 → kh 에 걸린다
    let fake_k = [7u8; 32];
    let (enc, w) = e2e_hpke::seal(&B64.decode(k(4).e2e_public()).unwrap(), &info("r1", "c1", "d4"), b"", &fake_k).unwrap();
    let late = Late { enc: B64.encode(enc), w: B64.encode(w) };
    assert_eq!(open_late(&k(4), "d4", &body, Some(&k(1).public()), &late), Err(EnvErr::Open));
    // 진짜 열쇠라도 서버가 원래 봉투를 바꾸면 서명에 걸린다
    let late = rewrap(&k(2), "d2", &body, Some(&k(1).public()), &to(&[(4, "d4")])[0]).unwrap();
    let mut v: Value = serde_json::from_str(&body).unwrap();
    v["head"] = json!("H9");
    assert_eq!(open_late(&k(4), "d4", &v.to_string(), Some(&k(1).public()), &late), Err(EnvErr::Sig));
}

#[test]
fn 건네기는_내가_서명을_확인해_연_말만_목록에_이미_있으면_안_건넨다() {
    let body = seal(&k(1), &meta(), &inner("agent"), &to(&[(2, "d2"), (4, "d4")])).unwrap();
    assert_eq!(rewrap(&k(2), "d2", &body, Some(&k(9).public()), &to(&[(5, "d5")])[0]), Err(EnvErr::Sig));
    assert_eq!(rewrap(&k(3), "d3", &body, Some(&k(1).public()), &to(&[(5, "d5")])[0]), Err(EnvErr::NotForMe));
    assert_eq!(rewrap(&k(2), "d2", &body, Some(&k(1).public()), &to(&[(4, "d4")])[0]), Err(EnvErr::Key), "이미 받는 기기");
    // 목록에 제 몫이 있는 기기는 late 로 안 연다(서버가 late 로 다른 열쇠를 얹어 '같은 말 두 가지'를 못 만들게)
    let late = rewrap(&k(2), "d2", &body, Some(&k(1).public()), &to(&[(5, "d5")])[0]).unwrap();
    assert_eq!(open_late(&k(4), "d4", &body, Some(&k(1).public()), &late), Err(EnvErr::Shape));
}
