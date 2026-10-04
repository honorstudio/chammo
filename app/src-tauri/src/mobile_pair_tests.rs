use super::*;
use std::time::{Duration, SystemTime};

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-pair-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn s7_짝짓기_코드는_한_번만_10분() {
    let st = Devices::memory();
    let now = SystemTime::now();
    let code = st.new_code(now).unwrap();
    assert_eq!(code.len(), 32);
    let tok = st.pair(&code, "iPhone", now + Duration::from_secs(60)).expect("처음엔 된다");
    assert_eq!(tok.len(), 64);
    assert!(st.pair(&code, "iPhone", now + Duration::from_secs(61)).is_none(), "두 번째는 안 된다");
    // 10분 넘으면 안 된다
    let c2 = st.new_code(now).unwrap();
    assert!(st.pair(&c2, "iPhone", now + PAIR_TTL + Duration::from_secs(1)).is_none());
    // 새 코드를 만들면 옛 코드는 죽는다
    let c3 = st.new_code(now).unwrap();
    let c4 = st.new_code(now).unwrap();
    assert!(st.pair(&c3, "iPhone", now).is_none());
    assert!(st.pair(&c4, "iPhone", now).is_some());
    // 틀린 코드·빈 코드
    let _c5 = st.new_code(now).unwrap();
    assert!(st.pair("0".repeat(32).as_str(), "x", now).is_none());
    assert!(st.pair("", "x", now).is_none());
}

#[test]
fn s7_기기_토큰으로만_통과하고_끊으면_막힌다() {
    let st = Devices::memory();
    let now = SystemTime::now();
    let code = st.new_code(now).unwrap();
    let tok = st.pair(&code, "iPhone", now).unwrap();
    let id = st.check(&tok, now).expect("발급한 토큰은 통과");
    assert!(st.check(&"f".repeat(64), now).is_none());
    assert!(st.check("", now).is_none());
    assert!(st.check(&tok[..63], now).is_none());
    let list = st.list();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "iPhone");
    assert!(list[0].last_seen.is_some());
    st.remove(&id).unwrap();
    assert!(st.check(&tok, now).is_none(), "끊은 기기는 막힌다");
    // 모두 끊기
    let t2 = { let c = st.new_code(now).unwrap(); st.pair(&c, "iPad", now).unwrap() };
    st.clear().unwrap();
    assert!(st.check(&t2, now).is_none());
}

#[test]
fn s7_토큰은_해시만_600_파일에() {
    let d = tmp("file");
    let now = SystemTime::now();
    let tok = {
        let st = Devices::open(&d);
        let code = st.new_code(now).unwrap();
        st.pair(&code, "iPhone", now).unwrap()
    };
    let body = std::fs::read_to_string(d.join("mobile-devices.json")).unwrap();
    assert!(!body.contains(&tok), "토큰 원문이 파일에 있다");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(d.join("mobile-devices.json")).unwrap().permissions().mode() & 0o777, 0o600);
    }
    // 앱을 다시 켜도(파일에서 읽어도) 같은 토큰이 통과
    let st2 = Devices::open(&d);
    assert!(st2.check(&tok, now).is_some());
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn 기기_이름은_user_agent_에서_짧게() {
    assert_eq!(device_name("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "iPhone");
    assert_eq!(device_name("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)"), "iPad");
    assert_eq!(device_name("Mozilla/5.0 (Linux; Android 14)"), "Android");
    assert_eq!(device_name("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), "Mac");
    assert_eq!(device_name(""), "기기");
}

fn pair_one(st: &Devices, name: &str) -> String {
    let now = SystemTime::now();
    let c = st.new_code(now).unwrap();
    st.pair(&c, name, now).unwrap()
}

#[test]
fn r4_두_앱이_같은_폴더를_써도_끊은_기기가_되살아나지_않는다() {
    let d = tmp("two");
    let a = Devices::open(&d);
    let b = Devices::open(&d);
    let tok = pair_one(&a, "iPhone");
    let now = SystemTime::now();
    assert!(b.check(&tok, now).is_some(), "다른 앱이 짝지은 기기도 보인다");
    let id = b.list()[0].id.clone();
    b.remove(&id).unwrap();
    assert!(a.check(&tok, now).is_none(), "다른 앱이 끊은 기기는 막힌다");
    // a 가 마지막 접속을 적어도(1분마다) 끊은 기기를 되살리지 않는다
    a.backdate_flush();
    let _ = a.check(&tok, now);
    let tok2 = pair_one(&a, "iPad");
    assert!(a.check(&tok2, now).is_some());
    let names: Vec<String> = Devices::open(&d).list().into_iter().map(|x| x.name).collect();
    assert_eq!(names, vec!["iPad".to_string()]);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn r4_동시에_짝지어도_하나도_안_잃는다() {
    let d = tmp("race");
    let hs: Vec<_> = (0..4).map(|i| {
        let d = d.clone();
        std::thread::spawn(move || {
            let st = Devices::open(&d);
            for k in 0..MAX_DEVICES / 4 {
                pair_one(&st, &format!("기기{i}-{k}"));
            }
        })
    }).collect();
    for h in hs {
        h.join().unwrap();
    }
    assert_eq!(Devices::open(&d).list().len(), MAX_DEVICES, "상한 안에서는 하나도 안 잃는다");
    let leftovers: Vec<_> = std::fs::read_dir(&d).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().contains(".tmp")).collect();
    assert!(leftovers.is_empty());
    let _ = std::fs::remove_dir_all(&d);
}

// ── 같은 기기 알아보기(2026-10-05 — 같은 아이폰이 8줄로 쌓였다) ──

fn code_at(st: &Devices, now: SystemTime) -> String {
    st.new_code(now).unwrap()
}

fn pair_as(st: &Devices, name: &str, home: bool, prev: Option<&str>, now: SystemTime) -> String {
    let c = code_at(st, now);
    st.pair_with(&c, &Pairing { name, home, prev }, now).unwrap()
}

#[test]
fn 같은_저장_공간이_다시_짝지으면_줄이_안_늘고_옛_열쇠는_바로_죽는다() {
    let st = Devices::memory();
    let now = SystemTime::now();
    let t1 = pair_as(&st, "iPhone", false, None, now);
    let id = st.list()[0].id.clone();
    let t2 = pair_as(&st, "iPhone", false, Some(&t1), now + Duration::from_secs(60));
    assert_ne!(t1, t2);
    let list = st.list();
    assert_eq!(list.len(), 1, "같은 사파리가 다시 짝지었는데 줄이 늘었다");
    assert_eq!(list[0].id, id, "줄은 그대로(열쇠만 바뀜)");
    assert!(st.check(&t1, now).is_none(), "옛 열쇠는 바로 무효");
    assert_eq!(st.check(&t2, now).as_deref(), Some(id.as_str()));
}

#[test]
fn 옛_열쇠_없이_다시_짝지으면_새_줄() {
    let st = Devices::memory();
    let now = SystemTime::now();
    let t1 = pair_as(&st, "iPhone", false, None, now);
    let _t2 = pair_as(&st, "iPhone", false, None, now);
    assert_eq!(st.list().len(), 2);
    assert!(st.check(&t1, now).is_some(), "증명 없이 남의 줄을 끊지 않는다");
}

#[test]
fn 틀리거나_끊긴_옛_열쇠를_내밀면_바꿔_끼우지_않는다() {
    let st = Devices::memory();
    let now = SystemTime::now();
    let mine = pair_as(&st, "iPhone", false, None, now);
    for prev in ["f".repeat(64), String::new(), mine[..63].to_string(), mine.to_uppercase()] {
        let _ = pair_as(&st, "iPhone", false, Some(&prev), now);
        assert!(st.check(&mine, now).is_some(), "남의 열쇠({}자)로 내 줄이 바뀌었다", prev.len());
    }
    assert_eq!(st.list().len(), 5);
    // 끊긴 기기의 열쇠 — 되살리지 않고 새 줄
    let gone = pair_as(&st, "iPad", false, None, now);
    let gid = st.list().into_iter().find(|d| d.name == "iPad").unwrap().id;
    st.remove(&gid).unwrap();
    let back = pair_as(&st, "iPad", false, Some(&gone), now);
    assert!(st.check(&gone, now).is_none());
    assert_ne!(st.check(&back, now).unwrap(), gid);
}

#[test]
fn 이름만_같은_남의_폰은_합치지_않는다() {
    let st = Devices::memory();
    let now = SystemTime::now();
    let a = pair_as(&st, "iPhone", false, None, now);
    let b = pair_as(&st, "iPhone", false, None, now);
    let l = st.list();
    assert_ne!(l[0].group, l[1].group);
    assert!(st.check(&a, now).is_some() && st.check(&b, now).is_some());
}

#[test]
fn 홈_화면_앱은_코드_낸_기기_아래로_묶이고_다시_하면_바꿔_끼운다() {
    let st = Devices::memory();
    let now = SystemTime::now();
    let safari = pair_as(&st, "iPhone", false, None, now);
    let sid = st.check(&safari, now).unwrap();
    let home_pair = |st: &Devices| {
        let c = st.new_code_from(&sid, now).unwrap();
        st.pair_with(&c, &Pairing { name: "iPhone", home: true, prev: None }, now).unwrap()
    };
    let h1 = home_pair(&st);
    let l = st.list();
    assert_eq!(l.len(), 2);
    assert!(l.iter().all(|d| d.group == sid), "{l:?}");
    assert!(l.iter().any(|d| d.home));
    let h2 = home_pair(&st);
    assert_eq!(st.list().len(), 2, "홈 화면 앱을 다시 붙여도 그 폰의 홈 화면 앱 칸은 하나");
    assert!(st.check(&h1, now).is_none(), "옛 홈 화면 앱 열쇠는 죽는다");
    assert!(st.check(&h2, now).is_some() && st.check(&safari, now).is_some());
}

#[test]
fn 다른_이름_기기에_붙인_코드는_묶지_않는다() {
    let st = Devices::memory();
    let now = SystemTime::now();
    let safari = pair_as(&st, "iPhone", false, None, now);
    let sid = st.check(&safari, now).unwrap();
    let c = st.new_code_from(&sid, now).unwrap();
    st.pair_with(&c, &Pairing { name: "iPad", home: true, prev: None }, now).unwrap();
    let ipad = st.list().into_iter().find(|d| d.name == "iPad").unwrap();
    assert_ne!(ipad.group, sid);
    // 홈 화면 앱이 아닌 브라우저에 붙여도(다른 브라우저일 수 있다) 묶지 않는다
    let c = st.new_code_from(&sid, now).unwrap();
    st.pair_with(&c, &Pairing { name: "iPhone", home: false, prev: None }, now).unwrap();
    assert_eq!(st.list().iter().filter(|d| d.group == sid).count(), 1);
}

#[test]
fn 다른_칸의_옛_열쇠면_바꿔_끼우지_않고_같은_기기로_묶기만() {
    // 홈 화면 앱이 사파리 저장 공간을 베껴 왔을 때 — 사파리 열쇠를 죽이면 사파리가 끊긴다
    let st = Devices::memory();
    let now = SystemTime::now();
    let safari = pair_as(&st, "iPhone", false, None, now);
    let sid = st.check(&safari, now).unwrap();
    let home = pair_as(&st, "iPhone", true, Some(&safari), now);
    assert!(st.check(&safari, now).is_some());
    assert!(st.check(&home, now).is_some());
    assert!(st.list().iter().all(|d| d.group == sid));
}

#[test]
fn 끊기는_기기_통째로_사파리와_홈_화면_앱_둘_다() {
    let st = Devices::memory();
    let now = SystemTime::now();
    let safari = pair_as(&st, "iPhone", false, None, now);
    let other = pair_as(&st, "iPad", false, None, now);
    let sid = st.check(&safari, now).unwrap();
    let c = st.new_code_from(&sid, now).unwrap();
    let home = st.pair_with(&c, &Pairing { name: "iPhone", home: true, prev: None }, now).unwrap();
    st.remove(&sid).unwrap();
    assert!(st.check(&safari, now).is_none() && st.check(&home, now).is_none());
    assert!(st.check(&other, now).is_some());
}

#[test]
fn 상한을_넘으면_가장_오래_안_쓴_줄부터_뺀다() {
    let st = Devices::memory();
    let t0 = SystemTime::now();
    let toks: Vec<String> = (0..MAX_DEVICES as u64).map(|i| pair_as(&st, "iPhone", false, None, t0 + Duration::from_secs(i * 60))).collect();
    assert_eq!(st.list().len(), MAX_DEVICES);
    // 첫 줄을 방금 썼으면 그건 남고, 그다음으로 오래된 줄부터 빠진다
    let later = t0 + Duration::from_secs(3600);
    let _ = st.check(&toks[0], later);
    let new: Vec<String> = (0..3).map(|_| pair_as(&st, "iPhone", false, None, later)).collect();
    assert_eq!(st.list().len(), MAX_DEVICES);
    assert!(st.check(&toks[0], later).is_some(), "방금 쓴 줄은 남는다");
    assert!(new.iter().all(|t| st.check(t, later).is_some()), "새 줄은 남는다");
    assert!(toks[1..=3].iter().all(|t| st.check(t, later).is_none()));
    assert!(st.check(&toks[4], later).is_some());
}

fn dev(id: &str, created: u64, last: Option<u64>) -> Device {
    Device { id: id.into(), name: "iPhone".into(), hash: sha(id), created, last_seen: last, home: false, group: None, paired: None }
}

#[test]
fn 오래_안_쓴_줄은_정리하고_이유를_돌려준다() {
    let day = 86_400_000u64;
    let now = 100 * day;
    let mut l = vec![dev("old", 0, Some(now - 31 * day)), dev("ok", 0, Some(now - 29 * day)), dev("never", now - 40 * day, None)];
    let gone = prune(&mut l, now, None);
    assert_eq!(l.iter().map(|d| d.id.as_str()).collect::<Vec<_>>(), vec!["ok"]);
    assert_eq!(gone.len(), 2);
    assert!(gone.iter().all(|g| g.reason.contains("30일")), "{gone:?}");
}

#[test]
fn 시계가_거꾸로_가도_줄이_영영_안_지워지지_않는다() {
    let day = 86_400_000u64;
    let now = 100 * day;
    // 시계가 앞서 있던 때 찍힌 마지막 접속(1년 뒤) — 지금으로 당긴다
    let mut l = vec![dev("future", now + 365 * day, Some(now + 365 * day))];
    assert!(prune(&mut l, now, None).is_empty());
    assert_eq!(l[0].last_seen, Some(now));
    assert!(l[0].created <= now);
    // 그 뒤 31일 안 쓰면 정리된다
    assert_eq!(prune(&mut l, now + 31 * day, None).len(), 1);
    // 상한 정리에서도 미래 값이 맨 끝(가장 최근)으로 버티지 않는다 — 위에서 당겨서
}

#[test]
fn 옛_이름_홈_화면_앱_줄은_이름과_칸으로_나눠_읽는다() {
    let d = tmp("legacy");
    let t = ms(SystemTime::now());
    std::fs::write(d.join(FILE), format!(r#"[{{"id":"a1","name":"iPhone 홈 화면 앱","hash":"00","created":{t},"lastSeen":{t}}},{{"id":"b2","name":"iPhone","hash":"11","created":{t}}}]"#)).unwrap();
    let l = Devices::open(&d).list();
    assert_eq!((l[0].name.as_str(), l[0].home, l[0].group.as_str()), ("iPhone", true, "a1"));
    assert_eq!((l[1].name.as_str(), l[1].home, l[1].group.as_str()), ("iPhone", false, "b2"));
    // 켤 때 정리 — 30일 넘게 안 쓴 줄은 파일에서도 빠진다
    let old = t - 31 * 86_400_000;
    std::fs::write(d.join(FILE), format!(r#"[{{"id":"a1","name":"iPhone","hash":"00","created":{old},"lastSeen":{old}}},{{"id":"b2","name":"iPad","hash":"11","created":{t}}}]"#)).unwrap();
    assert_eq!(Devices::open(&d).list().len(), 1);
    assert!(!std::fs::read_to_string(d.join(FILE)).unwrap().contains("a1"));
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn 바꿔_끼우는_중에_옛_열쇠로_와도_새_열쇠만_남는다() {
    let d = tmp("swap");
    let now = SystemTime::now();
    let a = std::sync::Arc::new(Devices::open(&d));
    let b = Devices::open(&d); // 같은 폴더를 쓰는 다른 앱(본판·개발판)
    let t1 = pair_as(&a, "iPhone", false, None, now);
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let hs: Vec<_> = (0..4).map(|_| {
        let (a, t1, stop) = (a.clone(), t1.clone(), stop.clone());
        std::thread::spawn(move || {
            while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                a.backdate_flush(); // 매번 파일에도 적게 — 되살리기 경합을 일부러 만든다
                let _ = a.check(&t1, SystemTime::now());
            }
        })
    }).collect();
    let t2 = pair_as(&a, "iPhone", false, Some(&t1), now);
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    for h in hs {
        h.join().unwrap();
    }
    for st in [&*a, &b, &Devices::open(&d)] {
        assert!(st.check(&t1, now).is_none(), "옛 열쇠가 살아 있다");
        assert!(st.check(&t2, now).is_some());
        assert_eq!(st.list().len(), 1);
    }
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn 바꿔_끼울_때도_코드는_한_번만() {
    let st = Devices::memory();
    let now = SystemTime::now();
    let t1 = pair_as(&st, "iPhone", false, None, now);
    let c = st.new_code(now).unwrap();
    assert!(st.pair_with(&c, &Pairing { name: "iPhone", home: false, prev: Some(&t1) }, now).is_some());
    assert!(st.pair_with(&c, &Pairing { name: "iPhone", home: false, prev: Some(&t1) }, now).is_none());
    // 코드 없이 옛 열쇠만으로는 안 된다
    assert!(st.pair_with("", &Pairing { name: "iPhone", home: false, prev: Some(&t1) }, now).is_none());
}

#[test]
fn 홈_화면_앱이_낸_코드로는_그_앱을_바꿔_끼우지_않는다() {
    let st = Devices::memory();
    let now = SystemTime::now();
    let safari = pair_as(&st, "iPhone", false, None, now);
    let sid = st.check(&safari, now).unwrap();
    let c = st.new_code_from(&sid, now).unwrap();
    let home = st.pair_with(&c, &Pairing { name: "iPhone", home: true, prev: None }, now).unwrap();
    let hid = st.check(&home, now).unwrap();
    // 그 홈 화면 앱이 코드를 내서 다른 홈 화면 앱(같은 기종 다른 폰일 수 있다)이 붙는다
    let c = st.new_code_from(&hid, now).unwrap();
    let other = st.pair_with(&c, &Pairing { name: "iPhone", home: true, prev: None }, now).unwrap();
    assert!(st.check(&home, now).is_some(), "코드를 낸 앱이 끊겼다");
    assert!(st.check(&other, now).is_some());
    assert_eq!(st.list().len(), 3);
}
