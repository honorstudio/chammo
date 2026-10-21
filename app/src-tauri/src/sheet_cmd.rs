//! 참모용 칸 읽기·쓰기(scripts/sheet get|set) — app.jsonl 로 받는다. 그 파일이 앱 표에 열려 있으면 표로 넘겨
//! 칸마다 참모 프사 커서가 가서 넣는 걸 보여 주고(표가 저장), 안 열려 있으면 원본 zip 에서 그 칸만 바로 바꿔 끼운다(ADR 0004).
//! 답은 <데이터>/sheet.txt — 첫 줄 "#id <id>", 다음 줄 JSON

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;

use crate::sheet_book::{read_book, sheet_file, Book};
use crate::sheet_patch::CellEdit;
use crate::sheet_ref::{a1, parse_a1};
use crate::sheet_struct::Op;

/// 칸 하나 쓰기 — 시트 이름(없으면 첫 시트), 행·열, 값 또는 수식(= 없이)
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Put { pub sheet: Option<String>, pub r: u32, pub c: u32, pub v: Option<serde_json::Value>, pub f: Option<String> }

#[derive(Debug, PartialEq)]
pub enum Req {
    Get { id: String, path: String, range: String },
    Set { id: String, path: String, puts: Vec<Put>, by: String },
}

/// "매출!B3"·"'월 합계'!C2"·"B3" → (시트, 행, 열)
pub fn parse_at(at: &str) -> Option<(Option<String>, u32, u32)> {
    let (sheet, cell) = match at.rsplit_once('!') {
        Some((s, c)) => (Some(s.trim().trim_matches('\'').replace("''", "'")).filter(|s| !s.is_empty()), c),
        None => (None, at),
    };
    let (r, c) = parse_a1(cell.trim().to_ascii_uppercase().as_str())?;
    Some((sheet, r, c))
}

/// 적힌 값 → 칸 값. "=…" 수식, 숫자처럼 생긴 건 숫자(앞 0 이 붙은 '007' 은 글), 빈 글은 칸 비우기
pub fn typed(raw: &str) -> (Option<serde_json::Value>, Option<String>) {
    if let Some(f) = raw.strip_prefix('=') { return (None, Some(f.to_string())); }
    if raw.is_empty() { return (None, None); }
    let t = raw.trim();
    let lead_zero = t.len() > 1 && t.starts_with('0') && !t.starts_with("0.");
    if !lead_zero && t == raw {
        if let Ok(n) = t.parse::<f64>() {
            if n.is_finite() { return (serde_json::Number::from_f64(n).map(serde_json::Value::Number), None); }
        }
    }
    (Some(serde_json::Value::String(raw.to_string())), None)
}

fn id_ok(id: &str) -> bool { !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') }

pub fn request(line: &str) -> Option<Req> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("action")?.as_str()? != "sheet" { return None; }
    let id = v.get("id")?.as_str()?.to_string();
    if !id_ok(&id) { return None; }
    let a = &v["arg"];
    let path = a["path"].as_str()?.to_string();
    match a["verb"].as_str()? {
        "get" => Some(Req::Get { id, path, range: a["range"].as_str().unwrap_or("").to_string() }),
        "set" => {
            let mut puts = Vec::new();
            for x in a["cells"].as_array()? {
                let (sheet, r, c) = parse_at(x["at"].as_str()?)?;
                let (v, f) = typed(x["value"].as_str()?);
                puts.push(Put { sheet, r, c, v, f });
            }
            let by = a["by"].as_str().unwrap_or("").chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(40).collect();
            (!puts.is_empty() && puts.len() <= 5000).then_some(Req::Set { id, path, puts, by })
        }
        _ => None,
    }
}

/// 앱 표에 열린 엑셀(진짜 경로 → 열린 표 수) — 표가 열 때·닫을 때 sheet_open 으로 알린다
static OPEN: Mutex<Option<HashMap<String, u32>>> = Mutex::new(None);

fn real(path: &str) -> String {
    std::fs::canonicalize(path).map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| path.to_string())
}

pub fn is_open(path: &str) -> bool {
    OPEN.lock().ok().and_then(|g| g.as_ref().and_then(|m| m.get(&real(path)).copied())).unwrap_or(0) > 0
}

#[tauri::command]
pub fn sheet_open(path: String, on: bool) {
    if let Ok(mut g) = OPEN.lock() {
        let m = g.get_or_insert_with(HashMap::new);
        let k = real(&path);
        let n = m.get(&k).copied().unwrap_or(0);
        if on { m.insert(k, n + 1); } else if n <= 1 { m.remove(&k); } else { m.insert(k, n - 1); }
    }
}

pub fn answer(id: &str, body: &serde_json::Value) {
    let file = crate::config::data_file("sheet.txt");
    let tmp = file.with_extension("txt.tmp");
    if std::fs::write(&tmp, format!("#id {id}\n{body}\n")).is_ok() { let _ = std::fs::rename(&tmp, &file); }
}

/// 열린 표로 넘긴 쓰기 — 표가 받았다(sheet_play_ack)고 하기 전까지 여기 둔다. ACK_WAIT 안에 안 받으면 파일 패치로 물러난다
/// (표가 안 그려지고 있거나 eval 이 안 닿으면 scripts/sheet 가 영영 답을 못 받았다, 2026-10-21 실측)
static SENT: Mutex<Option<HashMap<String, (std::path::PathBuf, Vec<Put>)>>> = Mutex::new(None);
const ACK_WAIT: std::time::Duration = std::time::Duration::from_secs(3);

fn park(id: &str, path: std::path::PathBuf, puts: Vec<Put>) {
    if let Ok(mut g) = SENT.lock() { g.get_or_insert_with(HashMap::new).insert(id.to_string(), (path, puts)); }
}

fn claim(id: &str) -> Option<(std::path::PathBuf, Vec<Put>)> {
    SENT.lock().ok().and_then(|mut g| g.as_mut().and_then(|m| m.remove(id)))
}

/// 표가 아직 안 받았으면 그 칸만 파일에 쓴다 — 받았으면 None(표가 쓰고 답한다)
fn fall_back(id: &str) -> Option<Result<usize, String>> {
    let (p, puts) = claim(id)?;
    Some(set_closed(&p, &puts, |q| crate::reader::keep_history_as(q, "xlsx")))
}

/// 표가 쓰기를 받았다 — 이제 표가 칸마다 넣고 저장한 뒤 sheet_play_done 으로 답한다
/// 아직 기다리던 쓰기면 true — ACK_WAIT 를 넘겨 이미 파일 패치로 물러났으면 false(표는 칠하지 말 것 — 두 번 적용·충돌 띠·답 덮어쓰기, 0.3.6 리뷰)
#[tauri::command]
pub fn sheet_play_ack(id: String) -> bool {
    claim(&id).is_some()
}

/// 표가 다 넣고 저장까지 했다(또는 못 했다) — 기다리는 scripts/sheet 에 답
#[tauri::command]
pub fn sheet_play_done(id: String, answer_json: String) {
    if !id_ok(&id) { return; }
    claim(&id);
    let v = serde_json::from_str(&answer_json).unwrap_or_else(|_| serde_json::json!({ "ok": false, "error": "bad answer" }));
    answer(&id, &v);
}

/// 범위 → 칸들 줄 글("시트!B3\t값\t=수식"). range = "시트!A1:C9" | "시트" | "A1:C9" | ""(첫 시트 전부)
pub fn get_text(book: &Book, range: &str) -> Result<String, String> {
    let (sheet, cells) = match range.rsplit_once('!') {
        Some((s, c)) => (Some(s.trim().trim_matches('\'').to_string()), c.to_string()),
        None if range.contains(':') || parse_a1(&range.to_ascii_uppercase()).is_some() => (None, range.to_string()),
        None => ((!range.trim().is_empty()).then(|| range.trim().to_string()), String::new()),
    };
    let sh = match &sheet { Some(n) => book.sheets.iter().find(|s| &s.name == n).ok_or_else(|| format!("'{n}' 시트가 없어"))?, None => book.sheets.first().ok_or("시트가 없어")? };
    let bounds = if cells.trim().is_empty() { None } else {
        let (x, y) = cells.split_once(':').unwrap_or((&cells, &cells));
        let (Some(p), Some(q)) = (parse_a1(&x.trim().to_ascii_uppercase()), parse_a1(&y.trim().to_ascii_uppercase())) else { return Err(format!("범위를 못 읽었어: {cells}")) };
        Some((p.0.min(q.0), p.1.min(q.1), p.0.max(q.0), p.1.max(q.1)))
    };
    let mut cs: Vec<_> = sh.cells.iter().filter(|c| c.v.is_some() || c.f.is_some())
        .filter(|c| bounds.is_none_or(|(r0, c0, r1, c1)| (r0..=r1).contains(&c.r) && (c0..=c1).contains(&c.c))).collect();
    cs.sort_by_key(|c| (c.r, c.c));
    let show = |v: &Option<serde_json::Value>| match v {
        Some(serde_json::Value::String(s)) => s.replace(['\t', '\n'], " "),
        // 정수는 120 으로(f64 라 120.0 으로 찍힌다)
        Some(serde_json::Value::Number(n)) => n.as_f64().filter(|x| x.fract() == 0.0 && x.abs() < 1e15).map(|x| format!("{x:.0}")).unwrap_or_else(|| n.to_string()),
        Some(x) => x.to_string(),
        None => String::new(),
    };
    let lines: Vec<String> = cs.iter().map(|c| {
        let f = c.f.as_ref().map(|f| format!("\t={f}")).unwrap_or_default();
        format!("{}!{}\t{}{f}", sh.name, a1(c.r, c.c), show(&c.v))
    }).collect();
    Ok(lines.join("\n"))
}

/// 안 열린 파일에 바로 쓰기 — 원본에서 그 칸만(저장 전 history). 수식 칸은 계산 결과 없이 쓰고 엑셀이 열 때 계산한다
pub fn set_closed(path: &std::path::Path, puts: &[Put], keep: impl Fn(&std::path::Path)) -> Result<usize, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let book = read_book(&bytes)?;
    let first = book.sheets.first().ok_or("시트가 없어")?.name.clone();
    let ops: Vec<Op> = puts.iter().map(|p| Op::Cell(CellEdit { part: p.sheet.clone().unwrap_or_else(|| first.clone()), r: p.r, c: p.c, v: p.v.clone(), f: p.f.clone(), s: None, style: None })).collect();
    let stamp = crate::reader::stamp_of(path).ok_or("파일을 못 읽었어")?;
    crate::sheet_patch::save(path, &ops, &stamp, keep)?;
    Ok(puts.len())
}

/// app.jsonl 의 sheet 줄 처리 — 열린 표가 있으면 표로(답은 표가 sheet_play_done 으로), 아니면 여기서 바로 답.
/// 표로는 eval(window.__sheetPlay) — 이 앱은 capabilities 가 없어 웹 listen 이 막혀 있다(Craft 의 __craftSpace 와 같은 길)
pub fn handle<R: tauri::Runtime>(app: &tauri::AppHandle<R>, req: Req) {
    match req {
        Req::Get { id, path, range } => {
            let ans = sheet_file(&path).and_then(|p| std::fs::read(&p).map_err(|e| e.to_string())).and_then(|b| read_book(&b)).and_then(|b| get_text(&b, &range));
            answer(&id, &match ans { Ok(t) => serde_json::json!({ "ok": true, "text": t }), Err(e) => serde_json::json!({ "ok": false, "error": e }) });
        }
        Req::Set { id, path, puts, by } => {
            let p = match sheet_file(&path) { Ok(p) => p, Err(e) => return answer(&id, &serde_json::json!({ "ok": false, "error": e })) };
            if is_open(&p.to_string_lossy()) {
                park(&id, p.clone(), puts.clone());
                crate::craft_window::to_main(app, "__sheetPlay", serde_json::json!({ "id": id, "path": p.to_string_lossy(), "puts": puts, "by": by }));
                std::thread::sleep(ACK_WAIT); // handle 은 따로 스레드(appctl)
                if let Some(r) = fall_back(&id) {
                    answer(&id, &match r { Ok(n) => serde_json::json!({ "ok": true, "written": n, "shown": false }), Err(e) => serde_json::json!({ "ok": false, "error": e }) });
                }
                return;
            }
            let r = set_closed(&p, &puts, |q| crate::reader::keep_history_as(q, "xlsx"));
            answer(&id, &match r { Ok(n) => serde_json::json!({ "ok": true, "written": n, "shown": false }), Err(e) => serde_json::json!({ "ok": false, "error": e }) });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn 칸_주소와_값_종류() {
        assert_eq!(parse_at("매출!B3"), Some((Some("매출".into()), 2, 1)));
        assert_eq!(parse_at("'월 합계'!c2"), Some((Some("월 합계".into()), 1, 2)));
        assert_eq!(parse_at("AA10"), Some((None, 9, 26)));
        assert_eq!(parse_at("매출!"), None);
        assert_eq!(typed("=SUM(B2:B4)"), (None, Some("SUM(B2:B4)".into())));
        assert_eq!(typed("1234.5"), (Some(json!(1234.5)), None));
        assert_eq!(typed("007"), (Some(json!("007")), None));
        assert_eq!(typed(" 12"), (Some(json!(" 12")), None));
        assert_eq!(typed("1월"), (Some(json!("1월")), None));
        assert_eq!(typed(""), (None, None));
    }

    #[test]
    fn 요청_줄_거르기() {
        let ok = r#"{"action":"sheet","id":"ab12","arg":{"verb":"set","path":"/x/a.xlsx","by":"aaaa1111","cells":[{"at":"매출!B3","value":"12"},{"at":"C3","value":"=B3*2"}]}}"#;
        let Some(Req::Set { puts, by, .. }) = request(ok) else { panic!() };
        assert_eq!(by, "aaaa1111");
        assert_eq!(puts[1], Put { sheet: None, r: 2, c: 2, v: None, f: Some("B3*2".into()) });
        assert!(request(&ok.replace("ab12", "a b")).is_none(), "id 는 글자·숫자·-");
        assert!(request(&ok.replace("매출!B3", "매출!ZZZZ9")).is_none(), "틀린 칸이 있으면 통째로 안 받는다");
        assert!(request(r#"{"action":"sheet","id":"x1","arg":{"verb":"drop","path":"/x"}}"#).is_none());
        assert_eq!(request(r#"{"action":"sheet","id":"x1","arg":{"verb":"get","path":"/x/a.xlsx","range":"매출!A1:B2"}}"#), Some(Req::Get { id: "x1".into(), path: "/x/a.xlsx".into(), range: "매출!A1:B2".into() }));
    }

    #[test]
    fn 범위_읽기는_줄마다_시트_칸_값_수식() {
        let b = read_book(&crate::sheet::tests::book(&[])).unwrap();
        assert_eq!(get_text(&b, "매출!A1:C2").unwrap(), "매출!A1\t품목\n매출!B1\t연필 \n매출!A2\t120\n매출!B2\t500\n매출!C2\t60000\t=A2*B2");
        assert_eq!(get_text(&b, "C4").unwrap(), "매출!C4\t2\t=A4*B4");
        assert!(get_text(&b, "요약 & 메모").unwrap().starts_with("요약 & 메모!A1\t60000원\t='매출'!C2"));
        assert!(get_text(&b, "없는 시트!A1").is_err());
    }

    #[test]
    fn 안_열린_파일은_원본에서_그_칸만() {
        let d = std::env::temp_dir().join(format!("chammo-sheetcmd-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join("시험.xlsx");
        std::fs::write(&p, crate::sheet::tests::layout_book()).unwrap();
        let puts = vec![Put { sheet: Some("매출".into()), r: 9, c: 1, v: Some(json!(42)), f: None }, Put { sheet: None, r: 9, c: 2, v: None, f: Some("B10*2".into()) }];
        assert_eq!(set_closed(&p, &puts, |_| {}).unwrap(), 2);
        let b = read_book(&std::fs::read(&p).unwrap()).unwrap();
        assert_eq!(get_text(&b, "B10:C10").unwrap(), "매출!B10\t42\n매출!C10\t\t=B10*2");
        // 차트 부품은 그대로
        assert_eq!(crate::sheet::unzip(&std::fs::read(&p).unwrap()).unwrap()["xl/charts/chart1.xml"], b"<chartSpace/>");
    }

    #[test]
    fn 늦게_온_받았어는_거절한다() {
        // 0.3.6 리뷰: ACK_WAIT(3초) 뒤에 온 ack — Rust 는 이미 파일을 패치하고 답했다. 표가 또 칠하고 sheet_play_done 을 부르면
        // 두 번 적용·충돌 띠·답 파일 덮어쓰기. 늦었으면 false 로 돌려줘 표가 건너뛰게 한다
        park("ack-late", std::path::PathBuf::from("/없는/곳/a.xlsx"), vec![]);
        assert!(fall_back("ack-late").is_some(), "3초 안에 안 받아 물러났다");
        assert!(!sheet_play_ack("ack-late".into()), "늦은 받았어 — 표는 칠하지 않는다");
        park("ack-ok", std::path::PathBuf::from("/없는/곳/a.xlsx"), vec![]);
        assert!(sheet_play_ack("ack-ok".into()), "기다리는 중이었다 — 표가 칠한다");
        assert!(fall_back("ack-ok").is_none());
    }

    #[test]
    fn 표가_받았다고_하면_물러나지_않는다() {
        park("ack-1", std::path::PathBuf::from("/없는/곳/a.xlsx"), vec![]);
        sheet_play_ack("ack-1".into());
        assert!(fall_back("ack-1").is_none(), "표가 받은 쓰기는 파일 패치로 또 쓰지 않는다");
    }

    #[test]
    fn 표가_답이_없으면_파일에_그_칸만_쓴다() {
        let d = std::env::temp_dir().join(format!("chammo-sheetplay-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join("열림.xlsx");
        std::fs::write(&p, crate::sheet::tests::layout_book()).unwrap();
        park("miss-1", p.clone(), vec![Put { sheet: Some("매출".into()), r: 9, c: 1, v: Some(json!(7)), f: None }]);
        assert_eq!(fall_back("miss-1"), Some(Ok(1)));
        assert!(fall_back("miss-1").is_none(), "한 번만");
        let b = read_book(&std::fs::read(&p).unwrap()).unwrap();
        assert_eq!(get_text(&b, "B10").unwrap(), "매출!B10\t7");
    }

    #[test]
    fn 열린_표로는_이벤트가_아니라_eval_로_보낸다() {
        // capabilities 가 없어 웹 listen 이 막혀 있다(10/21 실측: 열린 표에 sheet set 하면 영영 답 없음) — Craft 와 같은 window.__* eval 길
        let src = include_str!("sheet_cmd.rs");
        let body = &src[src.find("pub fn handle<").unwrap()..src.find("#[cfg(test)]").unwrap()];
        assert!(body.contains("to_main(app, \"__sheetPlay\""));
        assert!(!body.contains(".emit("));
    }

    #[test]
    fn 열린_표_등록은_세고_닫으면_뺀다() {
        let p = "/없는/곳/등록시험.xlsx";
        sheet_open(p.into(), true);
        sheet_open(p.into(), true);
        sheet_open(p.into(), false);
        assert!(is_open(p));
        sheet_open(p.into(), false);
        assert!(!is_open(p));
    }
}
