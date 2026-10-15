//! 스페이스 엑셀(.xlsx) 읽기 — 원본 zip 을 직접 열어 시트·칸(값·수식)·병합·너비를 꺼낸다(ADR 0004).
//! 화면(Univer)이 그리고, 저장은 sheet_patch.rs 가 원본에서 고친 칸만 바꿔 끼운다 — 그래서 여기서 못 읽는 것(차트·그림)도 파일엔 남는다.
//! 서식(글꼴·채우기·테두리·숫자 서식)은 sheet_style.rs

use quick_xml::events::{BytesStart, Event};
use quick_xml::reader::Reader;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;

use crate::sheet_ref::{parse_a1, translate};

/// 빈 통합 문서(시트 하나) — 보관함 '새 엑셀'(홈·모드 ⑦). 엑셀·Numbers·스페이스가 다 여는 최소 부품만
pub fn blank_xlsx(sheet: &str) -> Result<Vec<u8>, String> {
    use std::io::Write;
    let esc = sheet.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;");
    let parts: [(&str, String); 6] = [
        ("[Content_Types].xml", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>"#.into()),
        ("_rels/.rels", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#.into()),
        ("xl/workbook.xml", format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="{esc}" sheetId="1" r:id="rId1"/></sheets></workbook>"#)),
        ("xl/_rels/workbook.xml.rels", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#.into()),
        ("xl/worksheets/sheet1.xml", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>"#.into()),
        ("xl/styles.xml", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>"#.into()),
    ];
    let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, body) in &parts {
        w.start_file(*name, zip::write::SimpleFileOptions::default()).map_err(|e| e.to_string())?;
        w.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(w.finish().map_err(|e| e.to_string())?.into_inner())
}

/// zip 안 부품들(이름 → 바이트). xlsx 부품은 작아서 통째로 들고 있어도 된다(1만 행 600KB)
pub type Parts = HashMap<String, Vec<u8>>;

pub fn unzip(bytes: &[u8]) -> Result<Parts, String> {
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| format!("xlsx 가 아니야: {e}"))?;
    let mut out = HashMap::new();
    for i in 0..z.len() {
        let mut f = z.by_index(i).map_err(|e| e.to_string())?;
        if f.is_dir() { continue; }
        let mut v = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut v).map_err(|e| e.to_string())?;
        let name = f.name().to_string();
        out.insert(name, v);
    }
    Ok(out)
}

pub fn part_str<'a>(parts: &'a Parts, name: &str) -> Option<&'a str> {
    parts.get(name).and_then(|b| std::str::from_utf8(b).ok())
}

pub fn attr(e: &BytesStart, key: &str) -> Option<String> {
    e.attributes().flatten().find(|a| a.key.local_name().as_ref() == key).and_then(|a| a.normalized_value(quick_xml::XmlVersion::Implicit1_0).ok()).map(|v| v.into_owned())
}

/// 글 이벤트 모으기 — quick-xml 은 &amp; 같은 엔티티를 따로(GeneralRef) 준다
pub fn push_text(buf: &mut String, ev: &Event) {
    match ev {
        Event::Text(t) => buf.push_str(&t.xml10_content()),
        Event::CData(t) => buf.push_str(&t.xml10_content()),
        Event::GeneralRef(r) => {
            if let Ok(Some(c)) = r.resolve_char_ref() { buf.push(c); return; }
            buf.push_str(match r.as_ref() { "amp" => "&", "lt" => "<", "gt" => ">", "quot" => "\"", "apos" => "'", _ => "" });
        }
        _ => {}
    }
}

/// 부품 경로 잇기 — rels 의 Target 은 그 부품 폴더 기준(앞이 / 면 zip 뿌리 기준)
pub fn join_part(base_dir: &str, target: &str) -> String {
    if let Some(t) = target.strip_prefix('/') { return t.to_string(); }
    let mut segs: Vec<&str> = base_dir.split('/').filter(|s| !s.is_empty()).collect();
    for s in target.split('/') {
        match s { ".." => { segs.pop(); } "." | "" => {} x => segs.push(x) }
    }
    segs.join("/")
}

/// rels 부품 → (Id → (Type 끝 이름, 부품 경로))
pub fn rels(parts: &Parts, owner: &str) -> HashMap<String, (String, String)> {
    let (dir, file) = owner.rsplit_once('/').unwrap_or(("", owner));
    let name = if dir.is_empty() { format!("_rels/{file}.rels") } else { format!("{dir}/_rels/{file}.rels") };
    let mut out = HashMap::new();
    let Some(s) = part_str(parts, &name) else { return out };
    let mut r = Reader::from_str(s);
    while let Ok(ev) = r.read_event() {
        match ev {
            Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == "Relationship" => {
                if let (Some(id), Some(t), Some(target)) = (attr(&e, "Id"), attr(&e, "Type"), attr(&e, "Target")) {
                    let kind = t.rsplit('/').next().unwrap_or("").to_string();
                    let path = if attr(&e, "TargetMode").as_deref() == Some("External") { target } else { join_part(dir, &target) };
                    out.insert(id, (kind, path));
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    out
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SheetInfo {
    pub name: String,
    /// zip 안 시트 부품(xl/worksheets/sheet1.xml) — 저장이 이걸로 찾아간다
    pub part: String,
    pub hidden: bool,
}

/// 통합 문서의 시트 목록(순서대로)
pub fn sheet_list(parts: &Parts) -> Result<Vec<SheetInfo>, String> {
    let wb = part_str(parts, "xl/workbook.xml").ok_or("xl/workbook.xml 이 없어")?;
    let rel = rels(parts, "xl/workbook.xml");
    let mut out = Vec::new();
    let mut r = Reader::from_str(wb);
    loop {
        match r.read_event().map_err(|e| e.to_string())? {
            Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == "sheet" => {
                let name = attr(&e, "name").unwrap_or_default();
                let id = e.attributes().flatten().find(|a| a.key.as_ref().ends_with(":id") || a.key.as_ref() == "id")
                    .and_then(|a| a.normalized_value(quick_xml::XmlVersion::Implicit1_0).ok()).map(|v| v.into_owned()).unwrap_or_default();
                if let Some((_, part)) = rel.get(&id) {
                    out.push(SheetInfo { name, part: part.clone(), hidden: attr(&e, "state").is_some_and(|s| s != "visible") });
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(out)
}

/// 공유 문자열(sharedStrings.xml) — 서식 섞인 글(rich text)은 글만 이어 붙인다
pub fn shared_strings(parts: &Parts) -> Vec<String> {
    let mut out = Vec::new();
    let Some(s) = part_str(parts, "xl/sharedStrings.xml") else { return out };
    let mut r = Reader::from_str(s);
    let (mut cur, mut in_si, mut in_t, mut in_rph) = (String::new(), false, false, false);
    while let Ok(ev) = r.read_event() {
        match &ev {
            Event::Start(e) => match e.local_name().as_ref() {
                "si" => { in_si = true; cur.clear(); }
                "t" => in_t = true,
                "rPh" => in_rph = true, // 일본어 읽기 — 글에 안 넣는다
                _ => {}
            },
            Event::Empty(e) if e.local_name().as_ref() == "si" => out.push(String::new()),
            Event::End(e) => match e.local_name().as_ref() {
                "si" => { in_si = false; out.push(std::mem::take(&mut cur)); }
                "t" => in_t = false,
                "rPh" => in_rph = false,
                _ => {}
            },
            Event::Eof => break,
            _ if in_si && in_t && !in_rph => push_text(&mut cur, &ev),
            _ => {}
        }
    }
    out
}

/// 칸 하나 — v 는 숫자·글·참거짓, 오류(#DIV/0!)는 err. s = 서식 번호(cellXfs), 0 이면 안 씀
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cell {
    pub r: u32,
    pub c: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub v: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f: Option<String>,
    #[serde(skip_serializing_if = "is_zero")]
    pub s: u32,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub err: bool,
}

fn is_zero(n: &u32) -> bool { *n == 0 }

/// 시트 부품의 sheetData → 칸들. 공유 수식(t="shared")은 기준 칸 수식을 옮겨 펼친다
pub fn read_cells(xml: &str, sst: &[String]) -> Result<Vec<Cell>, String> {
    let mut out = Vec::new();
    let mut r = Reader::from_str(xml);
    let mut shared: HashMap<String, (String, u32, u32)> = HashMap::new(); // si → (수식, 행, 열)
    let (mut row, mut col) = (0u32, 0u32);
    let mut cur: Option<(u32, u32, String, u32)> = None; // 행, 열, t, s
    let (mut val, mut form, mut buf) = (None::<String>, None::<(String, Option<String>, bool)>, String::new());
    let mut in_tag: &str = "";
    loop {
        let ev = r.read_event().map_err(|e| e.to_string())?;
        match &ev {
            Event::Start(e) | Event::Empty(e) => {
                let empty = matches!(ev, Event::Empty(_));
                match e.local_name().as_ref() {
                    "row" => { if let Some(n) = attr(e, "r").and_then(|v| v.parse::<u32>().ok()) { row = n.saturating_sub(1); } col = 0; }
                    "c" => {
                        let (rr, cc) = attr(e, "r").and_then(|a| parse_a1(&a)).unwrap_or((row, col));
                        let t = attr(e, "t").unwrap_or_default();
                        let s = attr(e, "s").and_then(|v| v.parse().ok()).unwrap_or(0);
                        val = None;
                        form = None;
                        if empty { out.push(Cell { r: rr, c: cc, v: None, f: None, s, err: false }); col = cc + 1; } else { cur = Some((rr, cc, t, s)); }
                    }
                    "v" | "t" if cur.is_some() => {
                        buf.clear();
                        if empty { val.get_or_insert_with(String::new); } else { in_tag = if e.local_name().as_ref() == "v" { "v" } else { "t" }; }
                    }
                    "f" if cur.is_some() => {
                        let si = attr(e, "si");
                        let is_shared = attr(e, "t").as_deref() == Some("shared");
                        buf.clear();
                        if !empty { in_tag = "f"; }
                        form = Some((String::new(), si.filter(|_| is_shared), empty));
                    }
                    _ => {}
                }
            }
            Event::End(e) => match e.local_name().as_ref() {
                "v" if in_tag == "v" => { val = Some(std::mem::take(&mut buf)); in_tag = ""; }
                "t" if in_tag == "t" => { val = Some(val.take().unwrap_or_default() + &std::mem::take(&mut buf)); in_tag = ""; }
                "f" if in_tag == "f" => { if let Some(f) = form.as_mut() { f.0 = std::mem::take(&mut buf); } in_tag = ""; }
                "c" => {
                    if let Some((rr, cc, t, s)) = cur.take() {
                        let f = form.take().and_then(|(text, si, _)| match si {
                            Some(si) if !text.is_empty() => { shared.insert(si, (text.clone(), rr, cc)); Some(text) }
                            Some(si) => shared.get(&si).map(|(base, br, bc)| translate(base, rr as i64 - *br as i64, cc as i64 - *bc as i64)),
                            None => (!text.is_empty()).then_some(text),
                        });
                        let (v, err) = value_of(&t, val.take(), sst);
                        out.push(Cell { r: rr, c: cc, v, f, s, err });
                        col = cc + 1;
                    }
                }
                "sheetData" => break,
                _ => {}
            },
            Event::Eof => break,
            _ if !in_tag.is_empty() => push_text(&mut buf, &ev),
            _ => {}
        }
    }
    Ok(out)
}

fn value_of(t: &str, raw: Option<String>, sst: &[String]) -> (Option<serde_json::Value>, bool) {
    use serde_json::Value;
    let Some(raw) = raw else { return (None, false) };
    match t {
        "s" => (raw.trim().parse::<usize>().ok().and_then(|i| sst.get(i)).map(|s| Value::String(s.clone())), false),
        "str" | "inlineStr" | "d" => (Some(Value::String(raw)), false),
        "b" => (Some(Value::Bool(raw.trim() == "1")), false),
        "e" => (Some(Value::String(raw)), true),
        _ => match raw.trim().parse::<f64>() {
            Ok(n) => (serde_json::Number::from_f64(n).map(Value::Number), false),
            Err(_) => (Some(Value::String(raw)), false),
        },
    }
}

#[cfg(test)]
#[path = "sheet_tests.rs"]
pub(crate) mod tests;
