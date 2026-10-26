use super::*;
use std::cell::RefCell;
use std::rc::Rc;

/// 메모리 가짜 중계 — chammo-relay locker.ts 의 길만 흉내(권한·한도는 서버 시험이 본다)
#[derive(Default)]
struct Srv {
    files: BTreeMap<String, Value>,
    parts: BTreeMap<(String, u64), Vec<u8>>,
    keys: BTreeMap<(String, String), (String, String)>,
    /// 이 조각에서 올리기를 실패시킨다
    fail_put_at: Option<u64>,
    aborted: Vec<String>,
}

struct FakeNet {
    dev: String,
    member: String,
    srv: Rc<RefCell<Srv>>,
}

fn tail(path: &str) -> Vec<String> {
    path.trim_start_matches("/v0/teams/t1/locker").split('/').filter(|s| !s.is_empty()).map(String::from).collect()
}

impl Net for FakeNet {
    fn call(&self, method: &str, path: &str, body: Option<&Value>) -> Result<(u16, Value), String> {
        let mut s = self.srv.borrow_mut();
        let t = tail(path);
        let b = body.cloned().unwrap_or(Value::Null);
        match (method, t.iter().map(String::as_str).collect::<Vec<_>>().as_slice()) {
            ("GET", []) => {
                let files: Vec<Value> = s
                    .files
                    .values()
                    .filter(|f| f["state"] != "uploading")
                    .map(|f| {
                        let id = f["id"].as_str().unwrap().to_string();
                        let mut f = f.clone();
                        f["key"] = s.keys.get(&(id.clone(), self.dev.clone())).map(|(e, w)| json!({ "enc": e, "w": w })).unwrap_or(Value::Null);
                        f["have"] = json!(s.keys.keys().filter(|(i, _)| *i == id).map(|(_, d)| d.clone()).collect::<Vec<_>>());
                        f
                    })
                    .collect();
                Ok((200, json!({ "rev": 1, "usage": { "used": 0, "reserved": 0, "seats": 2, "limit": 1 }, "files": files })))
            }
            ("POST", ["files"]) => {
                let id = b["id"].as_str().unwrap().to_string();
                for k in b["keys"].as_array().unwrap() {
                    s.keys.insert((id.clone(), k["d"].as_str().unwrap().into()), (k["enc"].as_str().unwrap().into(), k["w"].as_str().unwrap().into()));
                }
                let f = json!({ "id": id, "room": b.get("room").cloned().unwrap_or(Value::Null), "kind": b.get("kind").cloned().unwrap_or(json!("file")), "state": "uploading",
                    "size": b["size"], "parts": b["parts"], "kh": b["kh"], "sig": b["sig"], "meta": b["meta"], "metaBy": self.dev, "metaSig": b["metaSig"],
                    "by": { "member": self.member, "device": self.dev } });
                s.files.insert(id, f);
                Ok((201, json!({})))
            }
            ("POST", ["files", id, verb]) => {
                let id = id.to_string();
                match *verb {
                    "done" => {
                        s.files.get_mut(&id).unwrap()["state"] = json!("live");
                    }
                    "abort" => {
                        s.files.remove(&id);
                        s.aborted.push(id);
                    }
                    "meta" => {
                        let f = s.files.get_mut(&id).unwrap();
                        f["meta"] = b["meta"].clone();
                        f["metaSig"] = b["metaSig"].clone();
                        f["metaBy"] = json!(self.dev);
                    }
                    "keys" => {
                        for k in b["keys"].as_array().unwrap() {
                            s.keys.entry((id.clone(), k["d"].as_str().unwrap().into())).or_insert((k["enc"].as_str().unwrap().into(), k["w"].as_str().unwrap().into()));
                        }
                    }
                    "trash" | "restore" => {
                        s.files.get_mut(&id).unwrap()["state"] = json!(if *verb == "trash" { "trash" } else { "live" });
                    }
                    "purge" => {
                        s.files.remove(&id);
                    }
                    _ => return Ok((404, json!({ "error": "not_found" }))),
                }
                Ok((200, json!({ "ok": true })))
            }
            _ => Ok((404, json!({ "error": "not_found" }))),
        }
    }
    fn put(&self, path: &str, bytes: &[u8]) -> Result<u16, String> {
        let t = tail(path);
        let n: u64 = t[3].parse().unwrap();
        let mut s = self.srv.borrow_mut();
        if s.fail_put_at == Some(n) {
            return Ok(500);
        }
        s.parts.insert((t[1].clone(), n), bytes.to_vec());
        Ok(200)
    }
    fn get(&self, path: &str) -> Result<(u16, Vec<u8>), String> {
        let t = tail(path);
        let n: u64 = t[3].parse().unwrap();
        Ok(self.srv.borrow().parts.get(&(t[1].clone(), n)).map(|b| (200, b.clone())).unwrap_or((404, vec![])))
    }
}

fn keys(n: u8) -> DeviceKeys {
    DeviceKeys::from_seeds([n; 32], [n.wrapping_add(100); 32])
}

fn rcp(id: &str, k: &DeviceKeys) -> Recipient {
    Recipient { device: id.into(), e2e: k.e2e_public() }
}

struct World {
    srv: Rc<RefCell<Srv>>,
    a: DeviceKeys,
    b: DeviceKeys,
    c: DeviceKeys,
    people: People,
}

/// 팀 t1: A(dA, mA)·B(dB, mB) 는 처음부터, C(dC, mC) 는 나중에 든 사람
fn world() -> World {
    let (a, b, c) = (keys(1), keys(2), keys(3));
    let mut people = People::default();
    for (id, k) in [("dA", &a), ("dB", &b), ("dC", &c)] {
        people.signers.insert(id.into(), k.public());
    }
    people.recipients = vec![rcp("dA", &a), rcp("dB", &b)];
    World { srv: Rc::new(RefCell::new(Srv::default())), a, b, c, people }
}

impl World {
    fn net(&self, dev: &str) -> FakeNet {
        FakeNet { dev: dev.into(), member: format!("m{}", &dev[1..]), srv: self.srv.clone() }
    }
}

fn tmp(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-locker-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn write(dir: &Path, name: &str, data: &[u8]) -> PathBuf {
    let p = dir.join(name);
    std::fs::write(&p, data).unwrap();
    p
}

fn data(n: usize) -> Vec<u8> {
    (0..n).map(|i| (i * 31 + 7) as u8).collect()
}

fn find(net: &dyn Net, id: &str) -> RemoteFile {
    fetch_list(net, "t1").unwrap().files.into_iter().find(|f| f.id == id).expect("목록에 있어야")
}

#[test]
fn 조각_수와_암호문_크기() {
    assert_eq!(shape(0), (1, 16));
    assert_eq!(shape(CHUNK as u64), (1, PART));
    assert_eq!(shape(CHUNK as u64 + 1), (2, CHUNK as u64 + 1 + 32));
}

#[test]
fn 조각은_번호_마지막_방이_다르면_안_열린다() {
    let k = [9u8; 32];
    let ct = seal_chunk(&k, "t1", "", "f", 0, true, b"hello");
    assert_eq!(open_chunk(&k, "t1", "", "f", 0, true, &ct).unwrap(), b"hello");
    assert!(open_chunk(&k, "t1", "", "f", 1, true, &ct).is_err(), "순서 바꾸기");
    assert!(open_chunk(&k, "t1", "", "f", 0, false, &ct).is_err(), "잘라 내기(마지막 표시)");
    assert!(open_chunk(&k, "t1", "r1", "f", 0, true, &ct).is_err(), "다른 방");
    assert!(open_chunk(&k, "t1", "", "g", 0, true, &ct).is_err(), "다른 파일");
}

#[test]
fn 올린_파일을_팀원이_받아_같은_바이트로_연다() {
    let w = world();
    let dir = tmp("ab");
    let src = write(&dir, "보고서.pdf", &data(5000));
    let me = Me { keys: &w.a, device: "dA" };
    let mut seen = vec![];
    let r = upload(&w.net("dA"), &me, &w.people.recipients, "t1", "", "file", "", &src, "보고서.pdf", &mut |d, t| seen.push((d, t))).unwrap();
    assert_eq!((r.name.as_str(), r.size), ("보고서.pdf", 5000));
    assert_eq!(seen.last(), Some(&(5000, 5000)));
    let nb = w.net("dB");
    let f = find(&nb, &r.id);
    assert_eq!((f.size, f.parts), (5016, 1));
    let o = open_file(&Me { keys: &w.b, device: "dB" }, &w.people, "t1", &f).unwrap();
    assert_eq!(o.meta.name, "보고서.pdf");
    let out = download(&nb, "t1", &f, &o, &dir.join("받음"), &mut |_, _| {}).unwrap();
    assert_eq!(std::fs::read(&out).unwrap(), data(5000));
    assert_eq!(out.file_name().unwrap(), "보고서.pdf");
    // 같은 이름이 있으면 겹치지 않게
    let again = download(&nb, "t1", &f, &o, &dir.join("받음"), &mut |_, _| {}).unwrap();
    assert_eq!(again.file_name().unwrap(), "보고서 2.pdf");
}

#[test]
fn 큰_파일은_8MiB_조각으로_나눠_올리고_받는다() {
    let w = world();
    let dir = tmp("big");
    let src = write(&dir, "big.bin", &data(CHUNK + 100));
    let r = upload(&w.net("dA"), &Me { keys: &w.a, device: "dA" }, &w.people.recipients, "t1", "", "file", "", &src, "big.bin", &mut |_, _| {}).unwrap();
    let nb = w.net("dB");
    let f = find(&nb, &r.id);
    assert_eq!(f.parts, 2);
    assert_eq!(w.srv.borrow().parts[&(r.id.clone(), 0)].len() as u64, PART);
    let o = open_file(&Me { keys: &w.b, device: "dB" }, &w.people, "t1", &f).unwrap();
    let out = download(&nb, "t1", &f, &o, &dir.join("o"), &mut |_, _| {}).unwrap();
    assert_eq!(std::fs::read(out).unwrap(), data(CHUNK + 100));
}

#[test]
fn 조각_올리기가_실패하면_서버_줄을_치운다() {
    let w = world();
    let dir = tmp("fail");
    let src = write(&dir, "x.bin", &data(CHUNK + 5));
    w.srv.borrow_mut().fail_put_at = Some(1);
    let e = upload(&w.net("dA"), &Me { keys: &w.a, device: "dA" }, &w.people.recipients, "t1", "", "file", "", &src, "x.bin", &mut |_, _| {});
    assert!(e.is_err());
    assert_eq!(w.srv.borrow().aborted.len(), 1);
    assert!(w.srv.borrow().files.is_empty());
}

#[test]
fn 나중에_든_사람은_봉투가_없다가_봉투_더하기로_연다() {
    let mut w = world();
    let dir = tmp("late");
    let src = write(&dir, "a.txt", b"hello team");
    let r = upload(&w.net("dA"), &Me { keys: &w.a, device: "dA" }, &w.people.recipients, "t1", "", "file", "", &src, "a.txt", &mut |_, _| {}).unwrap();
    let nc = w.net("dC");
    let cme = Me { keys: &w.c, device: "dC" };
    assert!(open_file(&cme, &w.people, "t1", &find(&nc, &r.id)).unwrap_err().contains("열쇠가 아직 없어"));
    // B 가 켜져서 받는 목록(이제 C 포함)을 보고 봉투를 더한다
    w.people.recipients.push(rcp("dC", &w.c));
    let nb = w.net("dB");
    let f = find(&nb, &r.id);
    let o = open_file(&Me { keys: &w.b, device: "dB" }, &w.people, "t1", &f).unwrap();
    assert_eq!(share_keys(&nb, "t1", &[(&f, &o)], &w.people.recipients, &|_| vec![]), 1);
    assert_eq!(share_keys(&nb, "t1", &[(&find(&nb, &r.id), &o)], &w.people.recipients, &|_| vec![]), 0, "이미 있는 기기는 다시 안 봉한다");
    assert_eq!(open_file(&cme, &w.people, "t1", &find(&nc, &r.id)).unwrap().meta.name, "a.txt");
}

#[test]
fn 서버가_지어낸_파일_바꾼_이름_다른_열쇠_다른_방은_안_열린다() {
    let w = world();
    let dir = tmp("forge");
    let src = write(&dir, "a.txt", b"real");
    let bme = Me { keys: &w.b, device: "dB" };
    // 1) 믿는 사슬 밖 기기(서버가 만든 열쇠)가 올린 파일
    let evil = keys(66);
    let r = upload(&w.net("dX"), &Me { keys: &evil, device: "dX" }, &[rcp("dX", &evil), rcp("dB", &w.b)], "t1", "", "file", "", &src, "a.txt", &mut |_, _| {}).unwrap();
    assert!(open_file(&bme, &w.people, "t1", &find(&w.net("dB"), &r.id)).unwrap_err().contains("믿을 수 없어"));
    // 2) 진짜 파일의 meta 를 다른 파일 것으로 바꿔치기
    let a1 = upload(&w.net("dA"), &Me { keys: &w.a, device: "dA" }, &w.people.recipients, "t1", "", "file", "", &src, "one.txt", &mut |_, _| {}).unwrap();
    let a2 = upload(&w.net("dA"), &Me { keys: &w.a, device: "dA" }, &w.people.recipients, "t1", "", "file", "", &src, "two.txt", &mut |_, _| {}).unwrap();
    let mut f1 = find(&w.net("dB"), &a1.id);
    let f2 = find(&w.net("dB"), &a2.id);
    f1.meta = f2.meta.clone();
    assert!(open_file(&bme, &w.people, "t1", &f1).is_err());
    // 3) 서버가 내 봉투를 다른 파일 봉투로 바꿔치기(같은 kh 서명 아래 다른 열쇠)
    let mut f1 = find(&w.net("dB"), &a1.id);
    f1.key = f2.key.clone();
    assert!(open_file(&bme, &w.people, "t1", &f1).is_err());
    // 4) 대화 파일을 팀 보관함 파일처럼(방 지우기)
    let rf = upload(&w.net("dA"), &Me { keys: &w.a, device: "dA" }, &w.people.recipients, "t1", "r1", "file", "", &src, "dm.txt", &mut |_, _| {}).unwrap();
    let mut f = find(&w.net("dB"), &rf.id);
    assert_eq!(f.room.as_deref(), Some("r1"));
    assert!(open_file(&bme, &w.people, "t1", &f).is_ok());
    f.room = None;
    assert!(open_file(&bme, &w.people, "t1", &f).unwrap_err().contains("서명"));
}

#[test]
fn 이름_바꾸기는_바꾼_기기_서명으로_열리고_휴지통_되살리기() {
    let w = world();
    let dir = tmp("ren");
    let src = write(&dir, "a.txt", b"x");
    let r = upload(&w.net("dA"), &Me { keys: &w.a, device: "dA" }, &w.people.recipients, "t1", "", "file", "", &src, "a.txt", &mut |_, _| {}).unwrap();
    let nb = w.net("dB");
    let bme = Me { keys: &w.b, device: "dB" };
    let f = find(&nb, &r.id);
    let o = open_file(&bme, &w.people, "t1", &f).unwrap();
    rename(&nb, &bme, "t1", &f, &o, Some("../../etc/새 이름.txt"), Some("견적")).unwrap();
    let f = find(&w.net("dA"), &r.id);
    assert_eq!(f.meta_by, "dB");
    let o = open_file(&Me { keys: &w.a, device: "dA" }, &w.people, "t1", &f).unwrap();
    assert_eq!(o.meta.name, "-..-etc-새 이름.txt", "경로 글자·앞 점은 이름에 못 들어간다");
    assert_eq!(o.meta.folder, "견적");
    assert_eq!((safe_folder("  "), safe_folder("a/b"), safe_folder("대화 파일")), (String::new(), "a-b".to_string(), "대화 파일 2".to_string()));
    act(&nb, "t1", &r.id, "trash").unwrap();
    assert_eq!(find(&nb, &r.id).state, "trash");
    act(&nb, "t1", &r.id, "restore").unwrap();
    assert_eq!(find(&nb, &r.id).state, "live");
    assert!(act(&nb, "t1", &r.id, "rm -rf").is_err());
}

#[test]
fn 받는_목록에_내_기기가_없으면_안_올린다() {
    let w = world();
    let dir = tmp("noself");
    let src = write(&dir, "a.txt", b"x");
    let e = upload(&w.net("dA"), &Me { keys: &w.a, device: "dA" }, &[rcp("dB", &w.b)], "t1", "", "file", "", &src, "a.txt", &mut |_, _| {});
    assert!(e.unwrap_err().contains("받는 목록"));
    assert!(w.srv.borrow().files.is_empty());
}

#[test]
fn 옛_meta_는_dir_없이도_열리고_보통_파일은_dir_를_안_싣는다() {
    let m: Meta = serde_json::from_str(r#"{"name":"a.txt","size":1,"at":2}"#).unwrap();
    assert!(!m.dir);
    assert!(!serde_json::to_string(&m).unwrap().contains("dir"), "보통 파일 meta 는 옛 앱과 같은 모양");
}

#[test]
fn 빈_폴더는_표시_줄_하나로_남고_서버는_폴더_이름을_모른다() {
    let w = world();
    let me = Me { keys: &w.a, device: "dA" };
    let r = mkdir(&w.net("dA"), &me, &w.people.recipients, "t1", " 계약/서류 ").unwrap();
    let raw = serde_json::to_string(&w.srv.borrow().files).unwrap();
    assert!(!raw.contains("계약") && !raw.contains("dir"), "폴더 이름·표시는 봉한 meta 안에만");
    let f = find(&w.net("dB"), &r.id);
    assert_eq!((f.kind.as_str(), f.size, f.parts), ("file", 16, 1), "0바이트 — 사용량은 태그 16바이트");
    let o = open_file(&Me { keys: &w.b, device: "dB" }, &w.people, "t1", &f).unwrap();
    assert!(o.meta.dir);
    assert_eq!((o.meta.folder.as_str(), o.meta.name.as_str(), o.meta.size), ("계약-서류", "", 0));
    assert!(mkdir(&w.net("dA"), &me, &w.people.recipients, "t1", "  ").is_err(), "빈 이름은 폴더가 아니다");
}

/// 팀 보관함 파일 셋 — 견적/a.txt, 맨 위 b.txt, 견적 표시 줄
fn three(w: &World) -> (String, String, String) {
    let dir = tmp("fold");
    let me = Me { keys: &w.a, device: "dA" };
    let n = w.net("dA");
    let a = upload(&n, &me, &w.people.recipients, "t1", "", "file", "견적", &write(&dir, "a.txt", b"a"), "a.txt", &mut |_, _| {}).unwrap();
    let b = upload(&n, &me, &w.people.recipients, "t1", "", "file", "", &write(&dir, "b.txt", b"b"), "b.txt", &mut |_, _| {}).unwrap();
    let m = mkdir(&n, &me, &w.people.recipients, "t1", "견적").unwrap();
    (a.id, b.id, m.id)
}

fn opened(w: &World, dev: &str, k: &DeviceKeys) -> Vec<(RemoteFile, Opened)> {
    let me = Me { keys: k, device: dev };
    fetch_list(&w.net(dev), "t1").unwrap().files.into_iter().filter_map(|f| open_file(&me, &w.people, "t1", &f).ok().map(|o| (f, o))).collect()
}

#[test]
fn 폴더_이름_바꾸기는_그_폴더_파일과_표시_줄만_옮긴다() {
    let w = world();
    let (a, b, m) = three(&w);
    let list = opened(&w, "dB", &w.b);
    let pairs: Vec<_> = list.iter().map(|(f, o)| (f, o)).collect();
    let n = rename_folder(&w.net("dB"), &Me { keys: &w.b, device: "dB" }, "t1", &pairs, "견적", "계약").unwrap();
    assert_eq!(n, 2);
    let after = opened(&w, "dA", &w.a);
    let folder = |id: &str| after.iter().find(|(f, _)| f.id == id).unwrap().1.meta.folder.clone();
    assert_eq!((folder(&a), folder(&b), folder(&m)), ("계약".to_string(), String::new(), "계약".to_string()));
    assert!(rename_folder(&w.net("dB"), &Me { keys: &w.b, device: "dB" }, "t1", &pairs, "계약", "  ").is_err(), "빈 이름으로는 못 바꾼다");
}

#[test]
fn 폴더_지우기는_안의_파일과_표시_줄을_휴지통으로_다른_건_그대로() {
    let w = world();
    let (a, b, m) = three(&w);
    let list = opened(&w, "dB", &w.b);
    let pairs: Vec<_> = list.iter().map(|(f, o)| (f, o)).collect();
    assert_eq!(remove_folder(&w.net("dB"), "t1", &pairs, "견적").unwrap(), 2);
    let nb = w.net("dB");
    assert_eq!((find(&nb, &a).state.as_str(), find(&nb, &m).state.as_str(), find(&nb, &b).state.as_str()), ("trash", "trash", "live"));
    assert!(remove_folder(&nb, "t1", &pairs, "").is_err(), "맨 위는 폴더가 아니다");
}
