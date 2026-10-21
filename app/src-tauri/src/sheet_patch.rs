//! 스페이스 엑셀 저장 — 원본 xlsx 에서 고친 칸만 바꿔 끼운다(ADR 0004). 바뀐 시트 XML 의 sheetData 만 다시 쓰고,
//! 나머지 부품(차트·그림·메모·피벗)은 zip 안 압축 바이트 그대로 옮긴다 — 통째로 다시 쓰는 라이브러리들이 차트를 깼다

use quick_xml::events::Event;
use quick_xml::reader::Reader;
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::Write;

use crate::sheet::{attr, part_str, unzip, Parts};
use crate::sheet_ref::{a1, parse_a1, translate};

/// 칸 하나 고침 — part = 시트 부품(read_sheet_book 의 part). f = 수식(= 없이), v = 값(수식이면 계산 결과). v·f 둘 다 없으면 비운다.
/// s = 서식 번호(없으면 원래 서식 그대로), style = 바꾼 서식(있으면 s 보다 먼저)
#[derive(Deserialize, Debug, Clone, PartialEq)]
pub struct CellEdit {
    pub part: String,
    pub r: u32,
    pub c: u32,
    #[serde(default)]
    pub v: Option<serde_json::Value>,
    #[serde(default)]
    pub f: Option<String>,
    #[serde(default)]
    pub s: Option<u32>,
    /// 바꾼 서식 전체(읽을 때 받은 모양 그대로) — 있으면 styles.xml 에서 번호를 찾거나 덧붙여 s 로 쓴다
    #[serde(default)]
    pub style: Option<crate::sheet_style::Style>,
}

/// sheetData 의 행 하나 — open = 원래 <row …> 여는 태그(빈 행이면 <row …/>), 칸 = (열, 원래 XML)
pub(crate) struct Row { pub r: u32, pub open: String, pub empty: bool, pub cells: BTreeMap<u32, String>, pub touched: bool }

pub fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// 시트 XML → (sheetData 앞, 행들, sheetData 뒤). 칸에 r 이 없으면 넣어 둔다(앞 칸이 끼어들어도 자리가 안 밀리게)
pub(crate) fn split_rows(xml: &str) -> Result<(String, Vec<Row>, String), String> {
    let start = xml.find("<sheetData").ok_or("sheetData 가 없어")?;
    let open_end = xml[start..].find('>').ok_or("sheetData 가 깨졌어")? + start + 1;
    if xml[..open_end].ends_with("/>") {
        return Ok((xml[..start].to_string() + "<sheetData>", Vec::new(), "</sheetData>".to_string() + &xml[open_end..]));
    }
    let end = xml.rfind("</sheetData>").ok_or("sheetData 가 안 닫혔어")?;
    let body = &xml[open_end..end];
    let mut rows: Vec<Row> = Vec::new();
    let mut r = Reader::from_str(body);
    let (mut next_row, mut next_col) = (0u32, 0u32);
    let mut cell_start: Option<(usize, u32, bool)> = None; // 시작 자리, 열, r 있었나
    loop {
        let p0 = r.buffer_position() as usize;
        let ev = r.read_event().map_err(|e| e.to_string())?;
        let p1 = r.buffer_position() as usize;
        match &ev {
            Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == "row" => {
                let n = attr(e, "r").and_then(|v| v.parse::<u32>().ok()).map(|n| n - 1).unwrap_or(next_row);
                let open = if attr(e, "r").is_some() { body[p0..p1].to_string() } else { body[p0..p1].replacen("<row", &format!("<row r=\"{}\"", n + 1), 1) };
                rows.push(Row { r: n, open, empty: matches!(ev, Event::Empty(_)), cells: BTreeMap::new(), touched: false });
                next_row = n + 1;
                next_col = 0;
            }
            Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == "c" => {
                let rr = rows.last().map(|x| x.r).unwrap_or(0);
                let (col, had) = match attr(e, "r").and_then(|a| parse_a1(&a)) { Some((_, c)) => (c, true), None => (next_col, false) };
                if matches!(ev, Event::Empty(_)) { push_cell(&mut rows, col, &body[p0..p1], had, rr); next_col = col + 1; } else { cell_start = Some((p0, col, had)); }
            }
            Event::End(e) if e.local_name().as_ref() == "c" => if let Some((s, col, had)) = cell_start.take() {
                let rr = rows.last().map(|x| x.r).unwrap_or(0);
                push_cell(&mut rows, col, &body[s..p1], had, rr);
                next_col = col + 1;
            },
            Event::Eof => break,
            _ => {}
        }
    }
    Ok((xml[..open_end].to_string(), rows, xml[end..].to_string()))
}

fn push_cell(rows: &mut [Row], col: u32, raw: &str, had_r: bool, row: u32) {
    let raw = if had_r { raw.to_string() } else { raw.replacen("<c", &format!("<c r=\"{}\"", a1(row, col)), 1) };
    if let Some(x) = rows.last_mut() { x.cells.insert(col, raw); }
}

pub(crate) fn join_rows(head: &str, rows: &[Row], tail: &str) -> String {
    let mut s = String::with_capacity(head.len() + tail.len() + rows.len() * 64);
    s.push_str(head);
    for row in rows {
        if row.cells.is_empty() {
            // 칸이 없는 행 — 원래 빈 행이면 그대로, 칸을 다 지운 행은 높이·숨김만 남긴 빈 행으로
            if row.empty { s.push_str(&row.open) } else { s.push_str(&row.open.trim_end_matches('>').trim_end_matches('/')); s.push_str("/>"); }
            continue;
        }
        let open = if row.touched { drop_attr(&row.open, "spans") } else { row.open.clone() };
        s.push_str(open.trim_end_matches('>').trim_end_matches('/'));
        s.push('>');
        for c in row.cells.values() { s.push_str(c); }
        s.push_str("</row>");
    }
    s.push_str(tail);
    s
}

/// 태그 글에서 속성 하나 빼기 — spans(칸 범위 힌트)는 칸이 바뀌면 틀려진다
pub fn drop_attr(tag: &str, name: &str) -> String {
    let key = format!(" {name}=\"");
    match tag.find(&key) {
        Some(i) => { let j = tag[i + key.len()..].find('"').map(|k| i + key.len() + k + 1).unwrap_or(tag.len()); format!("{}{}", &tag[..i], &tag[j..]) }
        None => tag.to_string(),
    }
}

/// 원래 칸 XML 에서 공유 수식 묶음 번호(si) — 고치면 같은 묶음의 다른 칸이 기준을 잃으니 펼친다
pub(crate) fn shared_si(raw: &str) -> Option<String> {
    let i = raw.find("<f ")?;
    let tag = &raw[i..i + raw[i..].find('>')?];
    tag.contains("t=\"shared\"").then(|| tag.split("si=\"").nth(1)?.split('"').next().map(String::from)).flatten()
}

fn style_of(raw: &str) -> Option<u32> {
    let head = &raw[..raw.find('>')?];
    head.split(" s=\"").nth(1)?.split('"').next()?.parse().ok()
}

pub const ERRORS: [&str; 10] = ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#GETTING_DATA", "#SPILL!", "#CALC!"];

/// 새 칸 XML
pub fn cell_xml(r: u32, c: u32, v: Option<&serde_json::Value>, f: Option<&str>, s: u32) -> Option<String> {
    use serde_json::Value;
    let st = if s == 0 { String::new() } else { format!(" s=\"{s}\"") };
    let at = a1(r, c);
    let fx = f.map(|f| format!("<f>{}</f>", esc(f))).unwrap_or_default();
    let (t, val) = match v {
        None | Some(Value::Null) => ("", None),
        Some(Value::Bool(b)) => (" t=\"b\"", Some(if *b { "1".to_string() } else { "0".to_string() })),
        Some(Value::Number(n)) => ("", Some(n.to_string())),
        Some(Value::String(x)) if f.is_some() => (if ERRORS.contains(&x.as_str()) { " t=\"e\"" } else { " t=\"str\"" }, Some(esc(x))),
        Some(Value::String(x)) => return Some(format!("<c r=\"{at}\"{st} t=\"inlineStr\"><is><t xml:space=\"preserve\">{}</t></is></c>", esc(x))),
        Some(_) => ("", None),
    };
    if f.is_none() && val.is_none() {
        return (s != 0).then(|| format!("<c r=\"{at}\"{st}/>"));
    }
    Some(format!("<c r=\"{at}\"{st}{t}>{fx}{}</c>", val.map(|x| format!("<v>{x}</v>")).unwrap_or_default()))
}

/// 시트 XML 에 고침들 적용
pub fn patch_sheet(xml: &str, edits: &[&CellEdit]) -> Result<String, String> {
    let (head, mut rows, tail) = split_rows(xml)?;
    // 손대는 칸이 공유 수식 묶음이면 그 묶음을 먼저 펼친다
    let hit: HashSet<String> = edits.iter().filter_map(|e| {
        let row = rows.iter().find(|x| x.r == e.r)?;
        shared_si(row.cells.get(&e.c)?)
    }).collect();
    if !hit.is_empty() { expand_shared(&mut rows, &hit); }
    for e in edits {
        let i = match rows.binary_search_by_key(&e.r, |x| x.r) {
            Ok(i) => i,
            Err(i) => { rows.insert(i, Row { r: e.r, open: format!("<row r=\"{}\">", e.r + 1), empty: false, cells: BTreeMap::new(), touched: true }); i }
        };
        let row = &mut rows[i];
        row.touched = true;
        let s = e.s.or_else(|| row.cells.get(&e.c).and_then(|x| style_of(x))).unwrap_or(0);
        match cell_xml(e.r, e.c, e.v.as_ref(), e.f.as_deref(), s) {
            Some(x) => { row.cells.insert(e.c, x); }
            None => { row.cells.remove(&e.c); }
        }
    }
    let out = join_rows(&head, &rows, &tail);
    Ok(fix_dimension(&out, &rows))
}

/// 공유 수식 묶음 → 칸마다 그냥 수식으로(값 <v> 는 그대로)
pub(crate) fn expand_shared(rows: &mut [Row], sis: &HashSet<String>) {
    let mut base: HashMap<String, (String, u32, u32)> = HashMap::new();
    for row in rows.iter() {
        for (c, raw) in &row.cells {
            if let Some(si) = shared_si(raw).filter(|s| sis.contains(s)) {
                if let Some(text) = formula_text(raw).filter(|t| !t.is_empty()) { base.entry(si).or_insert((text, row.r, *c)); }
            }
        }
    }
    for row in rows.iter_mut() {
        let r = row.r;
        for (c, raw) in row.cells.iter_mut() {
            let Some(si) = shared_si(raw).filter(|s| sis.contains(s)) else { continue };
            let Some((f, br, bc)) = base.get(&si) else { continue };
            let moved = translate(&unesc(f), r as i64 - *br as i64, *c as i64 - *bc as i64);
            let i = raw.find("<f").unwrap_or(0);
            let j = raw[i..].find("</f>").map(|k| i + k + 4).or_else(|| raw[i..].find("/>").map(|k| i + k + 2)).unwrap_or(i);
            *raw = format!("{}<f>{}</f>{}", &raw[..i], esc(&moved), &raw[j..]);
            row.touched = true;
        }
    }
}

pub(crate) fn formula_text(raw: &str) -> Option<String> {
    let i = raw.find("<f")?;
    let gt = raw[i..].find('>')? + i;
    if raw[..gt].ends_with('/') { return Some(String::new()); }
    let end = raw[gt..].find("</f>")? + gt;
    Some(raw[gt + 1..end].to_string())
}

pub(crate) fn unesc(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

/// <dimension ref> 를 실제 칸 범위로
pub(crate) fn fix_dimension(xml: &str, rows: &[Row]) -> String {
    let Some(i) = xml.find("<dimension ") else { return xml.to_string() };
    let Some(j) = xml[i..].find("/>").map(|k| i + k + 2) else { return xml.to_string() };
    let used: Vec<(u32, u32)> = rows.iter().flat_map(|r| r.cells.keys().map(move |c| (r.r, *c))).collect();
    let rf = if used.is_empty() { "A1".to_string() } else {
        let (r0, r1) = (used.iter().map(|x| x.0).min().unwrap_or(0), used.iter().map(|x| x.0).max().unwrap_or(0));
        let (c0, c1) = (used.iter().map(|x| x.1).min().unwrap_or(0), used.iter().map(|x| x.1).max().unwrap_or(0));
        if (r0, c0) == (r1, c1) { a1(r0, c0) } else { format!("{}:{}", a1(r0, c0), a1(r1, c1)) }
    };
    format!("{}<dimension ref=\"{rf}\"/>{}", &xml[..i], &xml[j..])
}

/// 엑셀이 열 때 수식을 다시 계산하게(calcPr fullCalcOnLoad) — 화면이 준 계산 결과가 틀려도 엑셀에선 맞게
pub(crate) fn full_calc(wb: &str) -> String {
    if let Some(i) = wb.find("<calcPr") {
        let Some(j) = wb[i..].find('>').map(|k| i + k + 1) else { return wb.to_string() };
        let tag = &wb[i..j];
        let closing = if tag.ends_with("/>") { "/>" } else { ">" };
        let inner = drop_attr(tag.trim_end_matches(closing), "fullCalcOnLoad");
        return format!("{}{} fullCalcOnLoad=\"1\"{closing}{}", &wb[..i], inner.trim_end(), &wb[j..]);
    }
    // 스키마 순서상 definedNames·externalReferences·sheets 다음
    for after in ["</definedNames>", "</externalReferences>", "</functionGroups>", "</sheets>"] {
        if let Some(i) = wb.find(after) { let k = i + after.len(); return format!("{}<calcPr fullCalcOnLoad=\"1\"/>{}", &wb[..k], &wb[k..]); }
    }
    wb.to_string()
}

/// 계산 순서 기록(calcChain.xml)은 지운다 — 수식이 바뀌면 틀려져 엑셀이 '복구' 창을 띄운다. 엑셀이 열 때 다시 만든다
pub(crate) fn drop_calc_chain(parts: &mut Parts) {
    if parts.remove("xl/calcChain.xml").is_none() { return; }
    // 요소 하나째(<X …/> 또는 <X …></X>)만 지운다 — 첫 "/>" 까지로 보면 닫는 태그가 따로인 연결은 옆 연결까지 지우거나(sharedStrings·styles 빠짐)
    // 뒤에 "/>" 가 없으면 끝없이 돌았다(2026-10-21 리뷰). 모양을 모르면 그대로 둔다
    let cut = |xml: &str, tag: &str, needle: &str| -> String {
        let name = tag.trim_start_matches('<').trim_end();
        let mut out = xml.to_string();
        let mut from = 0;
        while let Some(n) = out[from..].find(needle).map(|k| from + k) {
            let Some(i) = out[..n].rfind(tag) else { break };
            let Some(gt) = out[n..].find('>').map(|k| n + k) else { break };
            let j = if out[..gt].ends_with('/') {
                gt + 1
            } else {
                let close = format!("</{name}>");
                match out[gt..].find(&close) { Some(k) => gt + k + close.len(), None => break }
            };
            out.replace_range(i..j, "");
            from = i;
        }
        out
    };
    if let Some(r) = part_str(parts, "xl/_rels/workbook.xml.rels").map(|r| cut(r, "<Relationship ", "calcChain.xml\"")) { parts.insert("xl/_rels/workbook.xml.rels".into(), r.into_bytes()); }
    if let Some(ct) = part_str(parts, "[Content_Types].xml").map(|c| cut(c, "<Override ", "/xl/calcChain.xml\"")) { parts.insert("[Content_Types].xml".into(), ct.into_bytes()); }
}

/// 원본 xlsx 바이트 + 칸 고침들 → 새 xlsx 바이트(행·열 조작까지는 sheet_struct::apply_ops)
pub fn apply(bytes: &[u8], edits: &[CellEdit]) -> Result<Vec<u8>, String> {
    crate::sheet_struct::apply_ops(bytes, &edits.iter().cloned().map(crate::sheet_struct::Op::Cell).collect::<Vec<_>>())
}

pub fn rezip(bytes: &[u8], replaced: &HashMap<String, Vec<u8>>, removed: &HashSet<String>) -> Result<Vec<u8>, String> {
    let mut src = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let opt = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut seen = HashSet::new();
    for i in 0..src.len() {
        let f = src.by_index_raw(i).map_err(|e| e.to_string())?;
        let name = f.name().to_string();
        if removed.contains(&name) { continue; }
        seen.insert(name.clone());
        match replaced.get(&name) {
            Some(data) => { drop(f); w.start_file(name.as_str(), opt).map_err(|e| e.to_string())?; w.write_all(data).map_err(|e| e.to_string())?; }
            None => w.raw_copy_file(f).map_err(|e| e.to_string())?,
        }
    }
    for (name, data) in replaced {
        if seen.contains(name) { continue; }
        w.start_file(name.as_str(), opt).map_err(|e| e.to_string())?;
        w.write_all(data).map_err(|e| e.to_string())?;
    }
    Ok(w.finish().map_err(|e| e.to_string())?.into_inner())
}


/// 열어 둔 xlsx 저장 — expected = 화면이 마지막으로 읽은 파일 도장. 그새 밖에서(참모·세션) 고쳤으면 CHANGED_OUTSIDE 로 거절해
/// 화면이 다시 읽고 합치게 한다(사용자 것도 바깥 것도 안 덮는다). 쓰기 전 원본을 history 에 남기고, 새 파일이 다시 읽히는지 본 뒤
/// 임시 파일에 써서 바꿔 끼운다. 돌려주는 값 = 새 도장. keep = 쓰기 전 원본 남기기(앱은 history, 시험은 가짜)
pub fn save(path: &std::path::Path, ops: &[crate::sheet_struct::Op], expected: &str, keep: impl Fn(&std::path::Path)) -> Result<String, String> {
    let lock = file_lock(path);
    let _one = lock.lock().unwrap_or_else(|e| e.into_inner());
    save_locked(path, ops, expected, keep)
}

/// 한 파일에 쓰기는 한 번에 하나 — 표 저장(write_sheet)·참모 칸 쓰기(set_closed)가 같이 돌면 둘 다 바깥 변경 검사를 지나 같은 원본을
/// 읽고, 나중에 바꿔 끼운 쪽이 앞 고침을 지웠다(둘 다 '됐다', 2026-10-21 리뷰). 잡은 채로 도장 확인 → 읽기 → 바꿔 끼우기까지
pub(crate) fn file_lock(path: &std::path::Path) -> std::sync::Arc<std::sync::Mutex<()>> {
    static LOCKS: std::sync::Mutex<Option<HashMap<std::path::PathBuf, std::sync::Arc<std::sync::Mutex<()>>>>> = std::sync::Mutex::new(None);
    let key = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mut g = LOCKS.lock().unwrap_or_else(|e| e.into_inner());
    g.get_or_insert_with(HashMap::new).entry(key).or_default().clone()
}

/// save 의 몸통 — file_lock 을 이미 잡은 쪽이 부른다
pub(crate) fn save_locked(path: &std::path::Path, ops: &[crate::sheet_struct::Op], expected: &str, keep: impl Fn(&std::path::Path)) -> Result<String, String> {
    use crate::reader::{stamp_of, CHANGED_OUTSIDE};
    if stamp_of(path).as_deref() != Some(expected) { return Err(CHANGED_OUTSIDE.into()); }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let out = crate::sheet_struct::apply_ops(&bytes, ops)?;
    crate::sheet_book::read_book(&out).map_err(|e| format!("저장본을 다시 못 읽어서 안 썼어: {e}"))?;
    keep(path);
    let tmp = crate::reader::tmp_beside(path);
    std::fs::write(&tmp, &out).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| { let _ = std::fs::remove_file(&tmp); e.to_string() })?;
    stamp_of(path).ok_or_else(|| "저장한 파일을 못 읽었어".into())
}

#[tauri::command]
pub async fn write_sheet(path: String, ops: Vec<crate::sheet_struct::Op>, expected: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = crate::sheet_book::sheet_file(&path)?;
        crate::locker_fs::keep_before_write(&file); // 보관함 안 엑셀이면 고치기 직전 판
        save(&file, &ops, &expected, |p| crate::reader::keep_history_as(p, "xlsx"))
    })
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "sheet_patch_tests.rs"]
mod tests;
