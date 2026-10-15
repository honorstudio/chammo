//! 스페이스 엑셀 — 시트 추가·이름 바꾸기·지우기. 이름이 바뀌거나 지워지면 그 시트를 가리키던 수식·정의된 이름·차트 범위도 같이

use crate::sheet::{part_str, rels, sheet_list, Parts};
use crate::sheet_patch::{esc, join_rows, split_rows};
use crate::sheet_ref::rename_formula;
use crate::sheet_xml::edit_attr;

fn get(parts: &Parts, name: &str) -> Option<String> { part_str(parts, name).map(String::from) }
fn put(parts: &mut Parts, name: &str, s: String) { parts.insert(name.to_string(), s.into_bytes()); }

/// 엑셀 시트 이름 규칙 — 1~31자, []:*?/\ 없음, 앞뒤 ' 없음, 같은 이름 없음(대소문자 무시)
pub fn check_name(parts: &Parts, name: &str, except: Option<&str>) -> Result<(), String> {
    let n = name.chars().count();
    if n == 0 || n > 31 { return Err("시트 이름은 1~31자".into()); }
    if name.chars().any(|c| "[]:*?/\\".contains(c)) || name.starts_with('\'') || name.ends_with('\'') { return Err("시트 이름에 [ ] : * ? / \\ 는 못 써".into()); }
    let taken = sheet_list(parts)?.iter().any(|s| Some(s.part.as_str()) != except && s.name.to_lowercase() == name.to_lowercase());
    if taken { Err(format!("'{name}' 시트가 이미 있어")) } else { Ok(()) }
}

/// 조작이 가리키는 시트 — 부품 경로 또는 시트 이름(새로 만든 시트는 화면이 경로를 모른다)
pub fn resolve(parts: &Parts, sheet: &str) -> Result<String, String> {
    if parts.contains_key(sheet) { return Ok(sheet.to_string()); }
    sheet_list(parts)?.into_iter().find(|s| s.name == sheet).map(|s| s.part).ok_or_else(|| format!("'{sheet}' 시트가 없어"))
}

const SHEET_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>"#;

/// 새 빈 시트를 맨 뒤에 — 돌려주는 값 = 새 시트 부품
pub fn add_sheet(parts: &mut Parts, name: &str) -> Result<String, String> {
    check_name(parts, name, None)?;
    let num = |p: &str, pre: &str, suf: &str| p.strip_prefix(pre).and_then(|x| x.strip_suffix(suf)).and_then(|x| x.parse::<u32>().ok());
    let n = parts.keys().filter_map(|k| num(k, "xl/worksheets/sheet", ".xml")).max().unwrap_or(0) + 1;
    let part = format!("xl/worksheets/sheet{n}.xml");
    put(parts, &part, SHEET_XML.to_string());
    let rels_name = "xl/_rels/workbook.xml.rels";
    let r = get(parts, rels_name).ok_or("통합 문서 연결(rels)이 없어")?;
    let used = rels(parts, "xl/workbook.xml");
    let rid = (1..).map(|i| format!("rId{i}")).find(|id| !used.contains_key(id)).unwrap_or_default();
    put(parts, rels_name, r.replacen("</Relationships>", &format!("<Relationship Id=\"{rid}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet{n}.xml\"/></Relationships>"), 1));
    if let Some(ct) = get(parts, "[Content_Types].xml") {
        put(parts, "[Content_Types].xml", ct.replacen("</Types>", &format!("<Override PartName=\"/{part}\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/></Types>"), 1));
    }
    let wb = get(parts, "xl/workbook.xml").ok_or("xl/workbook.xml 이 없어")?;
    let max_id = wb.split("sheetId=\"").skip(1).filter_map(|x| x.split('"').next()?.parse::<u32>().ok()).max().unwrap_or(0);
    // 연결 이름공간 접두어(보통 r)
    let rel_ns = "=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"";
    let prefix = wb.find(rel_ns).and_then(|i| wb[..i].rsplit("xmlns:").next().map(|p| p.trim().to_string())).unwrap_or_else(|| "r".into());
    put(parts, "xl/workbook.xml", wb.replacen("</sheets>", &format!("<sheet name=\"{}\" sheetId=\"{}\" {prefix}:id=\"{rid}\"/></sheets>", esc(name), max_id + 1), 1));
    Ok(part)
}

/// 모든 시트의 칸 수식·조건부 서식 수식·입력 목록, 정의된 이름, 차트 범위에 f 적용(그 이름이 든 부품만)
fn map_all_formulas(parts: &mut Parts, needle: &str, f: &dyn Fn(&str) -> String) -> Result<(), String> {
    for s in sheet_list(parts)? {
        let Some(x) = get(parts, &s.part) else { continue };
        if !x.contains(needle) { continue; }
        let (head, mut rows, tail) = split_rows(&x)?;
        for row in rows.iter_mut() {
            let r = row.r;
            for (c, raw) in row.cells.iter_mut() { *raw = crate::sheet_struct::rewrite_cell(raw, r, *c, &|t: &str| f(t), None); }
        }
        let mut y = join_rows(&head, &rows, &tail);
        for tag in ["formula", "formula1", "formula2"] { y = crate::sheet_xml::edit_text(&y, tag, f); }
        put(parts, &s.part, y);
    }
    if let Some(wb) = get(parts, "xl/workbook.xml") { put(parts, "xl/workbook.xml", crate::sheet_xml::edit_text(&wb, "definedName", f)); }
    let charts: Vec<String> = parts.keys().filter(|p| p.starts_with("xl/charts/chart") && p.ends_with(".xml")).cloned().collect();
    for p in charts {
        if let Some(x) = get(parts, &p).filter(|x| x.contains(needle)) { put(parts, &p, crate::sheet_xml::edit_text(&x, "f", f)); }
    }
    Ok(())
}

pub fn rename_sheet(parts: &mut Parts, part: &str, new: &str) -> Result<(), String> {
    let old = sheet_list(parts)?.into_iter().find(|s| s.part == part).map(|s| s.name).ok_or("그 시트가 없어")?;
    if old == new { return Ok(()); }
    check_name(parts, new, Some(part))?;
    let wb = get(parts, "xl/workbook.xml").ok_or("xl/workbook.xml 이 없어")?;
    put(parts, "xl/workbook.xml", edit_attr(&wb, "sheet", "name", |v| Some(if v == old { new.to_string() } else { v.to_string() })));
    map_all_formulas(parts, &old, &|f| rename_formula(f, &old, Some(new)))?;
    let pivots: Vec<String> = parts.keys().filter(|p| p.starts_with("xl/pivotCache/pivotCacheDefinition")).cloned().collect();
    for p in pivots {
        if let Some(x) = get(parts, &p) { put(parts, &p, edit_attr(&x, "worksheetSource", "sheet", |v| Some(if v == old { new.to_string() } else { v.to_string() }))); }
    }
    Ok(())
}

pub fn delete_sheet(parts: &mut Parts, part: &str) -> Result<(), String> {
    let list = sheet_list(parts)?;
    let idx = list.iter().position(|s| s.part == part).ok_or("그 시트가 없어")?;
    if list.iter().filter(|s| !s.hidden && s.part != part).count() == 0 { return Err("보이는 시트가 하나는 있어야 해".into()); }
    let name = list[idx].name.clone();
    let wb = get(parts, "xl/workbook.xml").ok_or("xl/workbook.xml 이 없어")?;
    let mut wb = edit_attr(&wb, "sheet", "name", |v| (v != name).then(|| v.to_string()));
    // 그 시트에만 있는 이름은 빼고, 뒤 시트 번호(localSheetId)는 하나씩 당긴다
    wb = edit_attr(&wb, "definedName", "localSheetId", |v| match v.parse::<usize>() {
        Ok(i) if i == idx => None,
        Ok(i) if i > idx => Some((i - 1).to_string()),
        _ => Some(v.to_string()),
    });
    for key in ["activeTab", "firstSheet"] {
        wb = edit_attr(&wb, "workbookView", key, |v| Some(v.parse::<usize>().map(|i| if i >= idx && i > 0 { i - 1 } else { i }.to_string()).unwrap_or_else(|_| v.to_string())));
    }
    put(parts, "xl/workbook.xml", wb);
    let rels_name = "xl/_rels/workbook.xml.rels";
    if let Some(r) = get(parts, rels_name) {
        let target = part.trim_start_matches("xl/");
        put(parts, rels_name, edit_attr(&r, "Relationship", "Target", |v| (v.trim_start_matches('/').trim_start_matches("xl/") != target).then(|| v.to_string())));
    }
    if let Some(ct) = get(parts, "[Content_Types].xml") {
        put(parts, "[Content_Types].xml", edit_attr(&ct, "Override", "PartName", |v| (v != format!("/{part}")).then(|| v.to_string())));
    }
    parts.remove(part);
    let (dir, file) = part.rsplit_once('/').unwrap_or(("", part));
    parts.remove(&format!("{dir}/_rels/{file}.rels"));
    map_all_formulas(parts, &name, &|f| rename_formula(f, &name, None))
}

#[cfg(test)]
#[path = "sheet_sheets_tests.rs"]
mod tests;
