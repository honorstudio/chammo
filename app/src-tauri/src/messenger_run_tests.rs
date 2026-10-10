//! 가짜 텔레그램 서버(127.0.0.1, 진짜 curl 로 왕복) + 가짜 맥(Env)으로 브리지를 끝까지 돌린다
use super::*;
use crate::messenger::User;
use serde_json::json;
use std::io::{Read, Write};
use std::net::TcpListener;

pub(crate) const TOKEN: &str = concat!("123456789:", "AAH4kq9_sZx-", "Qw3eRtYuIoP1aSdFgHjKlZx"); // 가짜 — 쪼개 둬야 GitHub 비밀 스캔이 진짜 토큰으로 안 본다
const ME: i64 = 7001;
const STRANGER: i64 = 9009;

// ── 가짜 텔레그램 ───────────────────────────────────────────

#[derive(Default)]
pub(crate) struct FakeTg {
    pub updates: Vec<Value>,
    pub calls: Vec<(String, Value)>,
    /// 다음 getUpdates 에 이 코드로 거절
    pub refuse: Option<u16>,
    /// getWebhookInfo 가 돌려줄 주소
    pub webhook: Option<String>,
}

pub(crate) fn fake_tg() -> (String, Arc<Mutex<FakeTg>>) {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://127.0.0.1:{}", l.local_addr().unwrap().port());
    let st = Arc::new(Mutex::new(FakeTg::default()));
    let st2 = st.clone();
    std::thread::spawn(move || {
        for s in l.incoming().flatten() {
            serve(s, &st2);
        }
    });
    (base, st)
}

fn serve(mut s: std::net::TcpStream, st: &Mutex<FakeTg>) {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 8192];
    let (path, body) = loop {
        let n = s.read(&mut tmp).unwrap_or(0);
        if n == 0 {
            return;
        }
        buf.extend_from_slice(&tmp[..n]);
        let mut h = [httparse::EMPTY_HEADER; 32];
        let mut req = httparse::Request::new(&mut h);
        if let Ok(httparse::Status::Complete(at)) = req.parse(&buf) {
            let len = req.headers.iter().find(|h| h.name.eq_ignore_ascii_case("content-length")).and_then(|h| std::str::from_utf8(h.value).ok()?.parse::<usize>().ok()).unwrap_or(0);
            if buf.len() >= at + len {
                break (req.path.unwrap_or("").to_string(), serde_json::from_slice::<Value>(&buf[at..at + len]).unwrap_or_default());
            }
        }
    };
    let method = path.rsplit('/').next().unwrap_or("").to_string();
    let reply = if !path.starts_with(&format!("/bot{TOKEN}/")) {
        (401, json!({ "ok": false, "error_code": 401, "description": "Unauthorized" }))
    } else {
        let mut g = st.lock().unwrap();
        g.calls.push((method.clone(), body.clone()));
        match method.as_str() {
            "getUpdates" => match g.refuse.take() {
                Some(code) => (code, json!({ "ok": false, "error_code": code, "description": "Conflict: terminated by other getUpdates request", "parameters": { "retry_after": 3 } })),
                None => {
                    let off = body["offset"].as_i64().unwrap_or(0);
                    (200, json!({ "ok": true, "result": g.updates.iter().filter(|u| u["update_id"].as_i64().unwrap_or(0) >= off).cloned().collect::<Vec<_>>() }))
                }
            },
            "getMe" => (200, json!({ "ok": true, "result": { "id": 1, "is_bot": true, "username": "chammo_test_bot" } })),
            "getWebhookInfo" => (200, json!({ "ok": true, "result": { "url": g.webhook.clone().unwrap_or_default() } })),
            "sendMessage" => {
                let n = g.calls.len();
                (200, json!({ "ok": true, "result": { "message_id": n } }))
            }
            _ => (200, json!({ "ok": true, "result": true })),
        }
    };
    let b = reply.1.to_string();
    let _ = write!(s, "HTTP/1.1 {} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{b}", reply.0, b.len());
}

fn sent(tg: &Mutex<FakeTg>) -> Vec<Value> {
    tg.lock().unwrap().calls.iter().filter(|(m, _)| m == "sendMessage").map(|(_, b)| b.clone()).collect()
}

fn called(tg: &Mutex<FakeTg>, method: &str) -> Vec<Value> {
    tg.lock().unwrap().calls.iter().filter(|(m, _)| m == method).map(|(_, b)| b.clone()).collect()
}

// ── 가짜 맥 ─────────────────────────────────────────────────

#[derive(Default)]
pub(crate) struct FakeMac {
    pub orchs: Vec<Orch>,
    pub typed: Mutex<Vec<(String, String)>>,
    pub answers: Mutex<Vec<(String, Pick, String)>>,
    pub log: Mutex<String>,
    pub shown: Mutex<Vec<String>>,
    pub transcript: Option<PathBuf>,
    /// 대화 id 별 기록(없으면 transcript)
    pub transcripts: Mutex<std::collections::HashMap<String, PathBuf>>,
    /// 앱이 적는 live.json 흉내 — 짧은 번호 → 지금 대화 id
    pub live: Mutex<std::collections::HashMap<String, String>>,
}

impl Env for FakeMac {
    fn orchs(&self) -> Result<Vec<Orch>, String> {
        Ok(self.orchs.clone())
    }
    fn type_to(&self, o: &Orch, text: &str) -> Result<(), String> {
        self.typed.lock().unwrap().push((o.id.clone(), text.to_string()));
        Ok(())
    }
    fn answer(&self, card: &str, pick: &Pick, by: &str) -> Result<(), String> {
        self.answers.lock().unwrap().push((card.to_string(), pick.clone(), by.to_string()));
        Ok(())
    }
    fn direct_log(&self) -> String {
        self.log.lock().unwrap().clone()
    }
    fn shown(&self, card: &str) {
        self.shown.lock().unwrap().push(card.to_string());
    }
    fn transcript(&self, session: &str) -> Option<PathBuf> {
        self.transcripts.lock().unwrap().get(session).cloned().or_else(|| self.transcript.clone())
    }
    fn session_now(&self, id: &str) -> Option<String> {
        self.live.lock().unwrap().get(id).cloned()
    }
    fn assistant(&self) -> String {
        "참모".into()
    }
    fn dirs(&self) -> (String, String) {
        ("/Users/me/.chammo".into(), "/Users/me".into())
    }
}

fn tmpdir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-msgr-{tag}-{}-{}", std::process::id(), crate::mobile_pair::random_hex(4).unwrap()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

const NOW: u64 = 1_791_400_000_000; // 2026-10-08 근처

fn bridge(tag: &str) -> (Bridge<FakeMac>, Arc<Mutex<FakeTg>>, PathBuf) {
    let (base, tg) = fake_tg();
    let dir = tmpdir(tag);
    let tr = dir.join("orch.jsonl");
    std::fs::write(&tr, "").unwrap();
    let mac = FakeMac {
        orchs: vec![Orch { id: "aaaaaaaa".into(), session: "s-1".into(), name: "참모".into() }, Orch { id: "bbbbbbbb".into(), session: "s-2".into(), name: "참모-2 · 참모 업데이트".into() }],
        transcript: Some(tr),
        ..Default::default()
    };
    let sh = Arc::new(Shared::open(&dir));
    (Bridge::new(Api::new(base, Secret::new(TOKEN)), mac, sh, NOW), tg, dir)
}

fn msg(id: i64, from: i64, text: &str, date_ms: u64) -> Value {
    json!({ "update_id": id, "message": { "message_id": id, "date": date_ms / 1000, "chat": { "id": from, "type": "private" }, "from": { "id": from, "is_bot": false, "first_name": "길동" }, "text": text } })
}

fn pair(b: &mut Bridge<FakeMac>) {
    let code = b.sh.gate.lock().unwrap().issue(NOW).unwrap();
    b.handle_batch(&[msg(1, ME, &format!("/start {code}"), NOW + 1000)], NOW + 1000);
    confirm(&b.sh, &b.api).unwrap();
}

#[test]
fn 짝짓기에서_참모_회신까지() {
    let (mut b, tg, dir) = bridge("flow");
    // 모르는 사람 /start 엉터리 코드·인사 — 답 없음
    b.handle_batch(&[msg(1, STRANGER, "/start 00000000000000000000000000000000", NOW + 500), msg(2, STRANGER, "안녕", NOW + 500)], NOW + 500);
    assert!(sent(&tg).is_empty(), "모르는 사람엔 아무것도 안 보낸다");
    let code = b.sh.gate.lock().unwrap().issue(NOW).unwrap();
    let next = b.handle_batch(&[msg(3, ME, &format!("/start {code}"), NOW + 1000)], NOW + 1000);
    assert_eq!(next, 4);
    // 코드를 낸 계정은 대기 — 맥에서 확인해야 짝이 된다. 대기 중엔 그 계정 글도 안 받는다
    assert!(b.sh.state().user.is_none());
    assert_eq!(b.sh.state().pending.unwrap().id, ME);
    b.handle_batch(&[msg(4, ME, "확인 전 글", NOW + 1500)], NOW + 1500);
    assert!(b.env.typed.lock().unwrap().is_empty());
    assert!(sent(&tg)[0]["text"].as_str().unwrap().contains("이 계정이 맞아요"));
    confirm(&b.sh, &b.api).unwrap();
    assert_eq!(b.sh.state().user.unwrap().id, ME);
    assert!(b.sh.state().pending.is_none());
    let s = sent(&tg);
    assert_eq!(s.len(), 2);
    assert_eq!(s[1]["chat_id"], ME);
    assert!(s[1]["text"].as_str().unwrap().starts_with("연결됐어요 · 길동"));
    // 상태 파일은 600, 토큰은 안 들어 있다
    let file = dir.join(FILE);
    let text = std::fs::read_to_string(&file).unwrap();
    assert!(!text.contains(TOKEN) && !text.contains(&code));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
    }
    // 짝의 글 → 기본 참모(참모) 입력칸
    b.handle_batch(&[msg(5, ME, "배포 상태 봐 줘", NOW + 2000)], NOW + 2000);
    assert_eq!(*b.env.typed.lock().unwrap(), vec![("aaaaaaaa".to_string(), "[텔레그램] 배포 상태 봐 줘".to_string())]);
    assert_eq!(called(&tg, "sendChatAction").len(), 1);
    // 참모가 대화 기록에 답을 쓰면 턴 끝 답만 가려서 보낸다
    let tr = b.env.transcript.clone().unwrap();
    let mut lines = String::new();
    lines += &format!("{}\n", json!({ "type": "user", "message": { "content": "[텔레그램] 배포 상태 봐 줘" } }));
    lines += &format!("{}\n", json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": "먼저 볼게" }], "stop_reason": "tool_use" } }));
    lines += &format!("{}\n", json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": format!("배포 끝났어. 토큰 {TOKEN} 은 키체인, 캡처 /Users/me/Desktop/dev/client/a.png") }], "stop_reason": "end_turn" } }));
    std::fs::write(&tr, lines.clone()).unwrap();
    b.tick(NOW + 3000);
    let s = sent(&tg);
    assert_eq!(s.len(), 3, "{s:?}");
    let reply = s[2]["text"].as_str().unwrap();
    assert!(reply.starts_with("참모:\n배포 끝났어."), "{reply}");
    assert!(!reply.contains("AAH4kq9") && !reply.contains("client") && reply.contains("…/a.png"), "{reply}");
    assert!(!reply.contains("먼저 볼게"));
    b.tick(NOW + 4000);
    assert_eq!(sent(&tg).len(), 3, "같은 답은 한 번만");
    // 맥에서 사람이 직접 치면 그 뒤 답은 안 보낸다
    lines += &format!("{}\n", json!({ "type": "user", "message": { "content": "맥에서 친 지시" } }));
    lines += &format!("{}\n", json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": "맥 답" }], "stop_reason": "end_turn" } }));
    std::fs::write(&tr, lines).unwrap();
    b.tick(NOW + 5000);
    assert!(sent(&tg).iter().all(|m| !m["text"].as_str().unwrap().contains("맥 답")));
}

#[test]
fn 이름으로_고르고_목록_보기() {
    let (mut b, tg, _) = bridge("pick");
    pair(&mut b);
    b.handle_batch(&[msg(2, ME, "/참모-2 화면 고쳐 줘", NOW + 2000)], NOW + 2000);
    assert_eq!(b.env.typed.lock().unwrap()[0], ("bbbbbbbb".to_string(), "[텔레그램] 화면 고쳐 줘".to_string()));
    b.handle_batch(&[msg(3, ME, "그다음 이것도", NOW + 2000)], NOW + 2000);
    assert_eq!(b.env.typed.lock().unwrap()[1].0, "bbbbbbbb", "마지막으로 말한 참모가 기본");
    b.handle_batch(&[msg(4, ME, "/참모", NOW + 2000)], NOW + 2000);
    assert!(sent(&tg).last().unwrap()["text"].as_str().unwrap().contains("참모-2 · 참모 업데이트 — 지금 받는 참모"));
    b.handle_batch(&[msg(5, ME, "/참모-9 x", NOW + 2000)], NOW + 2000);
    assert!(sent(&tg).last().unwrap()["text"].as_str().unwrap().contains("참모-9 참모가 없어요"));
    assert_eq!(b.env.typed.lock().unwrap().len(), 2);
}

fn card(id: &str, kind: &str, ts: &str) -> String {
    format!("{}\n", json!({ "ts": ts, "type": "ask", "id": id, "from": format!("c1c2{}", &id[4..]), "cwd": "/Users/me/Desktop/dev/project-b", "q": "진행할까?", "kind": kind, "yes": "승인", "no": "거절", "options": ["개인", "법인"], "amount": "US$25" }))
}

fn button(id: i64, from: i64, data: &str) -> Value {
    json!({ "update_id": id, "callback_query": { "id": format!("cb{id}"), "from": { "id": from }, "message": { "message_id": 77, "chat": { "id": from } }, "data": data } })
}

#[test]
fn 카드는_알리고_버튼은_되돌리기_쉬운_것만() {
    let (mut b, tg, _) = bridge("card");
    let now = iso_ms("2026-10-08T01:00:00Z").unwrap();
    b.started = now - 60_000;
    let code = b.sh.gate.lock().unwrap().issue(now).unwrap();
    b.handle_batch(&[msg(1, ME, &format!("/start {code}"), now)], now);
    confirm(&b.sh, &b.api).unwrap();
    *b.env.log.lock().unwrap() = card("aaaa0001", "pay", "2026-10-08T00:59:00Z") + &card("aaaa0002", "other", "2026-10-08T00:59:30+00:00") + &card("aaaa0003", "send", "2026-10-06T00:00:00Z");
    b.tick(now);
    let s = sent(&tg);
    assert_eq!(s.len(), 4, "대기 글 + 연결 글 + 카드 둘(이틀 지난 카드는 안 보냄)");
    assert!(s[2]["reply_markup"].is_null() && s[2]["text"].as_str().unwrap().contains("결제는 앱·폰 카드에서만"));
    assert!(s[2]["text"].as_str().unwrap().contains("project-b") && s[2]["text"].as_str().unwrap().contains("US$25"));
    assert_eq!(s[3]["reply_markup"]["inline_keyboard"][2][0]["callback_data"], "c:aaaa0002:y");
    assert_eq!(*b.env.shown.lock().unwrap(), vec!["aaaa0002"], "결제 카드는 텔레그램에 떠도 '보임'이 아니다(여기서 답 못 함)");
    b.env.log.lock().unwrap().push_str("\n");
    b.tick(now + 2000);
    assert_eq!(sent(&tg).len(), 4, "보낸 카드는 다시 안 보낸다");
    // 텔레그램에 안 보낸 카드(이틀 지난 aaaa0003)는 id 를 맞춰 눌러도 안 된다
    b.handle_batch(&[button(6, ME, "c:aaaa0003:y")], now);
    assert!(b.env.answers.lock().unwrap().is_empty());
    // 결제 카드 버튼을 지어 내도(버튼이 없었는데) 기록의 종류로 막는다
    b.handle_batch(&[button(2, ME, "c:aaaa0001:y")], now);
    assert!(b.env.answers.lock().unwrap().is_empty());
    assert!(called(&tg, "answerCallbackQuery").last().unwrap()["text"].as_str().unwrap().contains("앱·폰"));
    // 모르는 사람이 남의 카드 버튼 데이터를 보내도 아무것도
    let before = tg.lock().unwrap().calls.len();
    b.handle_batch(&[button(3, STRANGER, "c:aaaa0002:o1")], now);
    assert_eq!(tg.lock().unwrap().calls.len(), before);
    assert!(b.env.answers.lock().unwrap().is_empty());
    // 짝이 누른 선택지 버튼 → 카드 답(by = telegram:<id>)
    b.handle_batch(&[button(4, ME, "c:aaaa0002:o1")], now);
    assert_eq!(*b.env.answers.lock().unwrap(), vec![("aaaa0002".to_string(), Pick::Option { option: 1 }, format!("telegram:{ME}"))]);
    assert!(sent(&tg).last().unwrap()["text"].as_str().unwrap().contains("답했어요 — 법인"));
    assert_eq!(called(&tg, "editMessageReplyMarkup").last().unwrap()["reply_markup"]["inline_keyboard"], json!([]));
    // 이미 답한 카드를 또 누르면 기록이 막는다
    b.env.log.lock().unwrap().push_str(&format!("{}\n", json!({ "type": "answer", "id": "aaaa0002", "pick": "option" })));
    b.handle_batch(&[button(5, ME, "c:aaaa0002:y")], now);
    assert_eq!(b.env.answers.lock().unwrap().len(), 1);
    assert!(called(&tg, "answerCallbackQuery").last().unwrap()["text"].as_str().unwrap().contains("이미 답했어요"));
}

#[test]
fn 꺼져_있던_동안_온_글은_세고_한_줄만() {
    let (mut b, tg, _) = bridge("late");
    b.sh.update(|s| s.user = Some(User { id: ME, name: "길동".into(), at: 0, username: None }));
    let old = NOW - 3_600_000;
    b.handle_batch(&[msg(1, ME, "a", old), msg(2, ME, "b", old), msg(3, STRANGER, "c", old), msg(4, ME, "d", old)], NOW);
    assert!(b.env.typed.lock().unwrap().is_empty(), "옛 글은 참모에게 안 친다");
    let s = sent(&tg);
    assert_eq!(s.len(), 1);
    assert!(s[0]["text"].as_str().unwrap().starts_with("그동안 3개 못 받았어요"));
    assert_eq!(b.sh.state().offset, 5);
}

#[test]
fn 잠그면_그_뒤엔_짝_글도_안_받는다() {
    let (mut b, tg, _) = bridge("lock");
    pair(&mut b);
    b.handle_batch(&[msg(2, ME, "/잠금", NOW + 2000)], NOW + 2000);
    assert!(b.sh.state().user.is_none());
    assert!(sent(&tg).last().unwrap()["text"].as_str().unwrap().starts_with("잠갔어요"));
    let n = sent(&tg).len();
    b.handle_batch(&[msg(3, ME, "아직 돼?", NOW + 3000)], NOW + 3000);
    assert!(b.env.typed.lock().unwrap().is_empty());
    assert_eq!(sent(&tg).len(), n);
}

#[test]
fn 진짜_curl_왕복_오류_코드() {
    let (base, tg) = fake_tg();
    let api = Api::new(base.clone(), Secret::new(TOKEN));
    assert_eq!(api.get_me().unwrap()["username"], "chammo_test_bot");
    tg.lock().unwrap().refuse = Some(409);
    assert_eq!(api.get_updates(0, 0).unwrap_err().code(), 409);
    tg.lock().unwrap().updates = vec![msg(10, ME, "a", NOW), msg(11, ME, "b", NOW)];
    assert_eq!(api.get_updates(11, 0).unwrap().len(), 1, "offset 앞은 안 받는다");
    // 한글·따옴표·역슬래시·줄바꿈이 섞인 몸통도 그대로 간다
    let t = "따옴표 \" 역슬래시 \\ 줄\n바꿈 $HOME `x`";
    api.send(ME, t, None).unwrap();
    assert_eq!(sent(&tg).last().unwrap()["text"], t);
    // 다른 토큰은 401
    let bad = Api::new(base, Secret::new(concat!("987654321:", "AAH4kq9_sZx-", "Qw3eRtYuIoP1aSdFgHjKlZx")));
    assert_eq!(bad.get_me().unwrap_err().code(), 401);
}

#[test]
fn 참모_목록과_시각_읽기() {
    let json = r#"[{"id":"aaaaaaaa","cwd":"/Users/me/hq/","name":"참모","sessionId":"s1"},{"id":"bbbbbbbb","cwd":"/Users/me/hq","name":"sns-helper","sessionId":"s2"},{"id":"cccccccc","cwd":"/Users/me/dev/x","name":"참모-3","sessionId":"s3"},{"id":"dddddddd","cwd":"/Users/me/hq","name":"참모-2 · 디자인","sessionId":"s4"},{"id":"../../x","cwd":"/Users/me/hq","name":"참모-4"}]"#;
    let l = orchs_from(json, "/Users/me/hq", "참모");
    assert_eq!(l.iter().map(|o| o.id.as_str()).collect::<Vec<_>>(), vec!["aaaaaaaa", "dddddddd"]);
    assert_eq!(iso_ms("1970-01-01T00:00:01Z"), Some(1000));
    assert_eq!(iso_ms("2026-10-08T01:00:00+00:00"), iso_ms("2026-10-08T01:00:00Z"));
    assert_eq!(iso_ms("2026-10-08T01:00:00Z").unwrap() - iso_ms("2026-10-07T01:00:00Z").unwrap(), 86_400_000);
    assert_eq!(iso_ms("어제"), None);
    assert_ne!(account(Path::new("/Users/me/.chammo")), account(Path::new("/Users/me/.chammo-test")), "시험 폴더는 다른 키체인 칸");
}

#[test]
fn 새_계정_확인되면_옛_짝에게_알리고_회신_감시도_버린다() {
    let (mut b, tg, _) = bridge("swap");
    pair(&mut b);
    b.handle_batch(&[msg(2, ME, "일 시켜", NOW + 2000)], NOW + 2000);
    b.tick(NOW + 2100);
    assert_eq!(b.watches.len(), 1);
    let code = b.sh.gate.lock().unwrap().issue(NOW).unwrap();
    b.handle_batch(&[msg(3, STRANGER, &format!("/start {code}"), NOW + 3000)], NOW + 3000);
    assert_eq!(b.sh.state().user.unwrap().id, ME, "확인 전엔 옛 짝 그대로");
    confirm(&b.sh, &b.api).unwrap();
    assert_eq!(b.sh.state().user.unwrap().id, STRANGER);
    assert!(sent(&tg).iter().any(|m| m["chat_id"] == ME && m["text"].as_str().unwrap().contains("다른 계정이 연결돼서")));
    b.tick(NOW + 4000);
    assert!(b.watches.is_empty(), "옛 짝 대화의 회신은 새 계정으로 안 간다");
    assert!(confirm(&b.sh, &b.api).is_err(), "기다리는 계정이 없으면 거절");
}

#[test]
fn 그_카드에_없는_예아니오_버튼은_거절() {
    let (mut b, _tg, _) = bridge("label");
    let now = iso_ms("2026-10-08T01:00:00Z").unwrap();
    b.started = now - 60_000;
    let code = b.sh.gate.lock().unwrap().issue(now).unwrap();
    b.handle_batch(&[msg(1, ME, &format!("/start {code}"), now)], now);
    confirm(&b.sh, &b.api).unwrap();
    *b.env.log.lock().unwrap() = format!("{}\n", json!({ "ts": "2026-10-08T00:59:00Z", "type": "ask", "id": "bbbb0001", "from": "c1c2c3c4", "kind": "login", "q": "로그인 다 했어?", "yes": "다 했어", "no": "", "options": [] }));
    b.tick(now);
    b.handle_batch(&[button(2, ME, "c:bbbb0001:n")], now);
    assert!(b.env.answers.lock().unwrap().is_empty(), "no 라벨이 없는 카드에 지어 낸 n");
    b.handle_batch(&[button(3, ME, "c:bbbb0001:y")], now);
    assert_eq!(b.env.answers.lock().unwrap().len(), 1);
}

fn end_turn(text: &str) -> String {
    format!("{}\n", json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": text }], "stop_reason": "end_turn" } }))
}

#[test]
fn 참모가_clear_로_대화_id_가_바뀌면_새_기록을_따라간다() {
    // 실측(2026-10-09): /clear 뒤 짧은 번호는 그대로, 대화 id·기록 파일만 바뀐다(.shots/fix-debt-sessions/1-clear-session-id.md)
    let (mut b, tg, dir) = bridge("clear");
    pair(&mut b);
    b.handle_batch(&[msg(2, ME, "배포 봐 줘", NOW + 2000)], NOW + 2000);
    b.tick(NOW + 2100);
    let before = sent(&tg).len();
    // 참모가 /clear — 새 기록 파일(명령 줄로 시작) + 그 뒤 턴 끝 답
    let new_tr = dir.join("orch-after-clear.jsonl");
    let mut lines = String::new();
    lines += &format!("{}\n", json!({ "type": "user", "isMeta": true, "message": { "content": "<local-command-caveat>…</local-command-caveat>" } }));
    lines += &format!("{}\n", json!({ "type": "user", "message": { "content": "<command-name>/clear</command-name>" } }));
    lines += &end_turn("새 대화에서 배포 끝났어");
    std::fs::write(&new_tr, lines).unwrap();
    b.env.transcripts.lock().unwrap().insert("s-1b".into(), new_tr.clone());
    b.env.live.lock().unwrap().insert("aaaaaaaa".into(), "s-1b".into());
    b.tick(NOW + 3000);
    let s = sent(&tg);
    assert_eq!(s.len(), before + 1, "{s:?}");
    assert!(s.last().unwrap()["text"].as_str().unwrap().starts_with("참모:\n새 대화에서 배포 끝났어"));
    // 이어서 같은 새 기록에 쓴 답도 — 처음부터 다시 읽지 않는다
    std::fs::OpenOptions::new().append(true).open(&new_tr).unwrap().write_all(end_turn("하나 더").as_bytes()).unwrap();
    b.tick(NOW + 4000);
    let s = sent(&tg);
    assert_eq!(s.len(), before + 2);
    assert!(s.last().unwrap()["text"].as_str().unwrap().contains("하나 더"));
    // 같은 참모에게 다시 말하면 감시를 하나 더 만들지 않는다(새 대화 id 로 본다)
    b.env.transcripts.lock().unwrap().insert("s-1b".into(), new_tr);
    let mut orchs = b.env.orchs.clone();
    orchs[0].session = "s-1b".into();
    b.env.orchs = orchs;
    b.handle_batch(&[msg(3, ME, "고마워", NOW + 5000)], NOW + 5000);
    assert_eq!(b.watches.len(), 1);
}

#[test]
fn live_json_에_없거나_새_기록이_아직_없으면_그대로_본다() {
    let (mut b, tg, _) = bridge("clear-unknown");
    pair(&mut b);
    b.handle_batch(&[msg(2, ME, "일 시켜", NOW + 2000)], NOW + 2000);
    b.env.live.lock().unwrap().insert("aaaaaaaa".into(), "s-없음".into()); // 기록 파일을 못 찾는 대화 id
    let tr = b.env.transcript.clone().unwrap();
    // FakeMac 은 모르는 대화 id 에도 기본 기록을 주므로, 이 시험에선 새 id 기록을 없는 파일로 둔다
    b.env.transcripts.lock().unwrap().insert("s-없음".into(), tr.with_file_name("no-such.jsonl"));
    std::fs::write(&tr, end_turn("옛 기록 답")).unwrap();
    b.tick(NOW + 3000);
    assert!(sent(&tg).last().unwrap()["text"].as_str().unwrap().contains("옛 기록 답"), "새 기록이 생길 때까지 옛 기록을 계속 본다");
}

#[test]
fn live_json_에서_짧은_번호의_대화_id() {
    let live = r#"{"daemon":1,"sessions":[{"sessionId":"deadbeef-x","id":"0a1b2c3d","name":"참모","busy":false},{"sessionId":"","id":"bbbbbbbb"}],"lost":[]}"#;
    assert_eq!(session_in_live(live, "0a1b2c3d").as_deref(), Some("deadbeef-x"));
    assert_eq!(session_in_live(live, "bbbbbbbb"), None, "빈 대화 id 는 모름");
    assert_eq!(session_in_live(live, "cccccccc"), None);
    assert_eq!(session_in_live("깨짐", "0a1b2c3d"), None);
}

#[test]
fn 꺼져_있던_동안_누른_버튼은_반영_안_하고_다시_누르라고_한다() {
    // 버튼 누름엔 시각이 없어(callback 에 date 없음) 예전엔 몇 시간 전 누른 것도 켜자마자 카드 답이 됐다 — 글(Late)과 같은 규칙으로
    let (mut b, tg, _) = bridge("late-btn");
    let now = iso_ms("2026-10-08T01:00:00Z").unwrap();
    b.started = now - 60_000;
    let code = b.sh.gate.lock().unwrap().issue(now).unwrap();
    b.handle_batch(&[msg(1, ME, &format!("/start {code}"), now)], now);
    confirm(&b.sh, &b.api).unwrap();
    *b.env.log.lock().unwrap() = card("aaaa0002", "other", "2026-10-08T00:59:30Z");
    b.tick(now);
    // 켤 때 쌓여 있던 묶음 — 짝의 버튼 둘·모르는 사람 버튼 하나
    b.handle_backlog(&[button(2, ME, "c:aaaa0002:y"), button(3, STRANGER, "c:aaaa0002:n"), button(4, ME, "c:aaaa0002:o1")], now);
    assert!(b.env.answers.lock().unwrap().is_empty(), "쌓여 있던 버튼은 카드 답으로 안 친다");
    assert!(called(&tg, "answerCallbackQuery").iter().all(|c| c["text"].as_str().unwrap().contains("다시 눌러")));
    assert_eq!(called(&tg, "answerCallbackQuery").len(), 2, "모르는 사람 버튼엔 답 안 한다");
    assert!(called(&tg, "editMessageReplyMarkup").is_empty(), "카드 버튼은 그대로 둬서 다시 누를 수 있게");
    assert!(sent(&tg).last().unwrap()["text"].as_str().unwrap().starts_with("그동안 누른 버튼 2개는 반영 안 했어요"));
    // 켠 뒤 누른 버튼은 그대로 답
    b.handle_batch(&[button(5, ME, "c:aaaa0002:y")], now);
    assert_eq!(b.env.answers.lock().unwrap().len(), 1);
    assert_eq!(b.sh.state().offset, 6);
}

#[test]
fn 쌓여_있던_묶음의_글과_버튼은_한_줄로_같이_센다() {
    let (mut b, tg, _) = bridge("late-both");
    b.sh.update(|s| s.user = Some(User { id: ME, name: "길동".into(), at: 0, username: None }));
    let old = NOW - 3_600_000;
    b.handle_backlog(&[msg(1, ME, "a", old), button(2, ME, "c:aaaa0002:y")], NOW);
    let s = sent(&tg);
    assert_eq!(s.len(), 1, "{s:?}");
    let t = s[0]["text"].as_str().unwrap();
    assert!(t.contains("글 1개") && t.contains("버튼 1개"), "{t}");
}
