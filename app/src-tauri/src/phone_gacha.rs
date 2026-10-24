//! 폰 뽑기·스킨(시안 docs/design-drafts/phone-gacha v1 B) — 폰은 '요청'만, 굴리기·장착은 맥 앱 화면 쪽(domain/phoneGacha + ui/gacha/useGacha 고치기 한 줄)이 한다.
//! 여기선 모양만 거르고(아는 칸만 넘김) 화면 쪽에 넘긴 뒤 답을 기다린다. 쓰는 쪽은 늘 하나 — 폰 서버는 gacha.json 을 읽기만
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;

/// 화면 쪽이 답할 때까지 — 뽑기는 파일 한 번 읽고 쓰기라 보통 수십 ms, 창이 가려져도 JS 는 돈다
pub const WAIT: Duration = Duration::from_secs(8);
const SLOTS: [&str; 8] = ["skin", "window", "light", "hat", "title", "desk", "action", "fx"];
const VIEW_KEYS: [&str; 5] = ["coins", "pity", "owned", "equip", "fresh"];

fn rid_ok(s: &str) -> bool {
    (8..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn id_ok(s: &str) -> bool {
    let Some((kind, name)) = s.split_once('.') else { return false };
    !kind.is_empty() && kind.bytes().all(|b| b.is_ascii_lowercase()) && (1..=40).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

/// 폰이 보낸 글 → 아는 칸만 담은 요청. 모르는 모양이면 None(화면 쪽 parsePhoneReq 와 같은 규칙 — 두 번 거른다)
pub fn check(v: &Value) -> Option<Value> {
    let rid = v.get("rid")?.as_str().filter(|r| rid_ok(r))?;
    match v.get("op")?.as_str()? {
        "pull" => {
            let n = v.get("n")?.as_u64().filter(|n| *n == 1 || *n == 10)?;
            Some(json!({ "rid": rid, "op": "pull", "n": n }))
        }
        "equip" => {
            let slot = v.get("slot")?.as_str().filter(|s| SLOTS.contains(s))?;
            let id = match v.get("id")? {
                Value::Null => Value::Null,
                Value::String(s) if id_ok(s) => Value::String(s.clone()),
                _ => return None,
            };
            Some(json!({ "rid": rid, "op": "equip", "slot": slot, "id": id }))
        }
        _ => None,
    }
}

/// 폰 보기 — gacha.json 에서 코인·천장·가진 것·장착·NEW 만. 아직 없으면 "{}", 깨졌으면 이유째
pub fn view(data: &std::path::Path) -> Result<String, String> {
    let raw = match std::fs::read_to_string(data.join("gacha.json")) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok("{}".into()),
        Err(e) => return Err(format!("gacha.json: {e}")),
    };
    let v: Value = serde_json::from_str(&raw).map_err(|e| format!("gacha.json: {e}"))?;
    let out: serde_json::Map<String, Value> = VIEW_KEYS.iter().filter_map(|k| v.get(*k).map(|x| (k.to_string(), x.clone()))).collect();
    Ok(Value::Object(out).to_string())
}

fn pending() -> &'static Mutex<HashMap<String, mpsc::Sender<Value>>> {
    static P: OnceLock<Mutex<HashMap<String, mpsc::Sender<Value>>>> = OnceLock::new();
    P.get_or_init(Default::default)
}

/// 화면 쪽에 넘기고 답을 기다린다 — send(대기표, 요청)가 넘기는 길(앱은 webview eval). 시간이 지나면 Err("timeout").
/// 대기표 열쇠는 무작위 128비트 — 순번이면 다른 웹뷰가 짐작해 가짜 답을 넣을 수 있었다(보안 리뷰 2)
pub fn call(req: Value, wait: Duration, send: impl FnOnce(&str, &Value) -> Result<(), String>) -> Result<Value, String> {
    let key = crate::mobile_pair::random_hex(16).map_err(|e| e.to_string())?;
    let (tx, rx) = mpsc::channel();
    pending().lock().unwrap().insert(key.clone(), tx);
    let r = send(&key, &req).and_then(|_| rx.recv_timeout(wait).map_err(|_| "timeout".to_string()));
    pending().lock().unwrap().remove(&key);
    r
}

/// 답 받기 — 앱 main 창(웹뷰)에서 온 것만, 기다리는 대기표에만(늦었거나 모르는 표는 버린다). 받았으면 true
pub fn accept(label: &str, key: &str, reply: Value) -> bool {
    if label != "main" {
        return false;
    }
    match pending().lock().unwrap().remove(key) {
        Some(tx) => tx.send(reply).is_ok(),
        None => false,
    }
}

/// 화면 쪽 답 — 모드·리더·craft 같은 다른 웹뷰가 부르면 버린다
#[tauri::command]
pub fn gacha_phone_reply(webview: tauri::Webview, key: String, reply: Value) {
    accept(webview.label(), &key, reply);
}

/// 기기당 뽑기 요청 하나 — 진행 중이면 None(서버는 429). 돌려준 표가 사라지면 풀린다
pub struct One<'a> {
    set: &'a std::sync::Mutex<std::collections::HashSet<String>>,
    dev: String,
}
impl Drop for One<'_> {
    fn drop(&mut self) {
        self.set.lock().unwrap().remove(&self.dev);
    }
}
pub fn begin<'a>(set: &'a std::sync::Mutex<std::collections::HashSet<String>>, dev: &str) -> Option<One<'a>> {
    set.lock().unwrap().insert(dev.to_string()).then(|| One { set, dev: dev.to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 답이_오면_그_답() {
        let r = call(json!({ "op": "pull" }), Duration::from_secs(2), |key, _| {
            let k = key.to_string();
            std::thread::spawn(move || accept("main", &k, json!({ "ok": true })));
            Ok(())
        });
        assert_eq!(r, Ok(json!({ "ok": true })));
    }

    #[test]
    fn 늦은_답이나_지어낸_열쇠는_다른_대기표를_못_푼다() {
        // 먼저 시간 초과로 끝난 대기표의 열쇠
        let mut old = String::new();
        let r = call(json!({}), Duration::from_millis(30), |key, _| {
            old = key.to_string();
            Ok(())
        });
        assert_eq!(r, Err("timeout".into()));
        // 지금 기다리는 대기표 — 옛 열쇠·지어낸 순번 열쇠로 답이 와도 안 풀린다
        let r = call(json!({}), Duration::from_millis(200), |key, _| {
            assert_ne!(key, old);
            assert_eq!(key.len(), 32, "무작위 128비트(16진 32자): {key}");
            let (o, k) = (old.clone(), key.to_string());
            std::thread::spawn(move || {
                assert!(!accept("main", &o, json!({ "late": true })));
                assert!(!accept("main", "g1", json!({ "forged": true })));
                assert!(!accept("main", &k[..31], json!({ "forged": true })));
            });
            Ok(())
        });
        assert_eq!(r, Err("timeout".into()));
    }

    #[test]
    fn 답은_main_창만() {
        let r = call(json!({}), Duration::from_millis(300), |key, _| {
            let k = key.to_string();
            std::thread::spawn(move || {
                assert!(!accept("mode-calendar", &k, json!({ "forged": true })));
                assert!(accept("main", &k, json!({ "ok": true })));
            });
            Ok(())
        });
        assert_eq!(r, Ok(json!({ "ok": true })));
    }

    #[test]
    fn 기기당_하나만_진행() {
        let set = Default::default();
        let a = begin(&set, "dev-a").expect("첫 요청");
        assert!(begin(&set, "dev-a").is_none(), "같은 기기 두 번째는 막힘");
        let b = begin(&set, "dev-b");
        assert!(b.is_some(), "다른 기기는 따로");
        drop(a);
        assert!(begin(&set, "dev-a").is_some(), "끝나면 다시");
    }

    #[test]
    fn 넘기기가_실패하면_바로_그_이유() {
        assert_eq!(call(json!({}), Duration::from_secs(5), |_, _| Err("앱 창이 없어요".into())), Err("앱 창이 없어요".into()));
    }

    #[test]
    fn 모양_거르기() {
        assert_eq!(check(&json!({ "rid": "abcd1234", "op": "equip", "slot": "skin", "id": "skin.neon_2" })), Some(json!({ "rid": "abcd1234", "op": "equip", "slot": "skin", "id": "skin.neon_2" })));
        assert!(check(&json!({ "rid": "abcd1234", "op": "equip", "slot": "skin", "id": "Skin.neon" })).is_none());
        assert!(check(&json!({ "rid": "abcd1234", "op": "equip", "slot": "skin", "id": 3 })).is_none());
        assert!(check(&json!({ "rid": "a".repeat(65), "op": "pull", "n": 1 })).is_none());
    }
}
