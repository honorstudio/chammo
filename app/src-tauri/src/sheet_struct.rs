//! 스페이스 엑셀 — 행·열 끼우기/지우기를 통합 문서 전체에 적용한다. 바꾼 시트의 행·칸·병합·조건부 서식·입력 목록·하이퍼링크·
//! 열 너비·그림 자리·메모, 그리고 다른 시트 수식·정의된 이름·차트 범위·피벗 원본이 그 시트를 가리키면 같이 민다

use std::collections::{BTreeMap, HashSet};

use crate::sheet::{part_str, rels, SheetInfo, Parts};
use crate::sheet_patch::{expand_shared, fix_dimension, formula_text, join_rows, split_rows, unesc, esc, Row};
use crate::sheet_ref::{a1, parse_a1, shift_formula, shift_sqref, Axis, Shift};
use crate::sheet_xml::{edit_attr, edit_text, fix_group};

fn put(parts: &mut Parts, name: &str, s: String) { parts.insert(name.to_string(), s.into_bytes()); }
fn get(parts: &Parts, name: &str) -> Option<String> { part_str(parts, name).map(String::from) }

/// 칸 XML 의 r 속성과 수식 글(배열 수식이면 그 범위도) 바꾸기
pub(crate) fn rewrite_cell(raw: &str, r: u32, c: u32, ff: &impl Fn(&str) -> String, sh: Option<Shift>) -> String {
    let mut s = raw.to_string();
    if let Some(i) = s.find(" r=\"") {
        let j = s[i + 4..].find('"').map(|k| i + 4 + k).unwrap_or(i + 4);
        s.replace_range(i + 4..j, &a1(r, c));
    }
    if let Some(text) = formula_text(&s).filter(|t| !t.is_empty()) {
        let new = esc(&ff(&unesc(&text)));
        if let Some(i) = s.find("<f") { if let Some(gt) = s[i..].find('>').map(|k| i + k + 1) { s.replace_range(gt..gt + text.len(), &new); } }
    }
    if let (Some(sh), Some(i)) = (sh, s.find("<f ")) {
        let tag_end = s[i..].find('>').map(|k| i + k).unwrap_or(i);
        let tag = s[i..tag_end].to_string();
        if let Some(rf) = tag.split(" ref=\"").nth(1).and_then(|x| x.split('"').next()) {
            let new = shift_sqref(rf, sh).unwrap_or_else(|| a1(r, c));
            s.replace_range(i..tag_end, &tag.replacen(&format!(" ref=\"{rf}\""), &format!(" ref=\"{new}\""), 1));
        }
    }
    s
}

/// 바꾼 시트의 sheetData — 행 번호·칸 주소를 옮기고, 지워진 행·칸은 뺀다. 공유 수식은 먼저 펼친다(기준 칸이 지워질 수 있어서)
fn shift_rows(xml: &str, name: &str, sh: Shift) -> Result<String, String> {
    let (head, mut rows, tail) = split_rows(xml)?;
    let all: HashSet<String> = rows.iter().flat_map(|r| r.cells.values().filter_map(|c| crate::sheet_patch::shared_si(c))).collect();
    if !all.is_empty() { expand_shared(&mut rows, &all); }
    let ff = |f: &str| shift_formula(f, name, name, sh);
    let mut out: Vec<Row> = Vec::with_capacity(rows.len());
    for row in rows {
        let nr = match sh.axis { Axis::Row => match sh.point(row.r) { Some(v) => v, None => continue }, Axis::Col => row.r };
        let mut cells = BTreeMap::new();
        for (c, raw) in &row.cells {
            let nc = match sh.axis { Axis::Col => match sh.point(*c) { Some(v) => v, None => continue }, Axis::Row => *c };
            cells.insert(nc, rewrite_cell(raw, nr, nc, &ff, Some(sh)));
        }
        let open = crate::sheet_patch::drop_attr(&row.open.replacen(&format!(" r=\"{}\"", row.r + 1), &format!(" r=\"{}\"", nr + 1), 1), "spans");
        out.push(Row { r: nr, open, empty: row.empty, cells, touched: true });
    }
    out.sort_by_key(|r| r.r);
    Ok(fix_dimension(&join_rows(&head, &out, &tail), &out))
}

/// 열 너비 줄(<col min max>) 옮기기 — 1부터
fn shift_cols(xml: &str, sh: Shift) -> String {
    let span = |tag_min: &str, tag_max: &str| -> Option<(u32, u32)> { sh.span(tag_min.parse::<u32>().ok()? - 1, tag_max.parse::<u32>().ok()? - 1) };
    // min·max 를 같이 봐야 해서 col 요소 글을 통째로 다시 쓴다
    let mut out = xml.to_string();
    let mut from = 0;
    while let Some(i) = out[from..].find("<col ").map(|k| from + k) {
        let j = out[i..].find("/>").map(|k| i + k + 2).unwrap_or(out.len());
        let tag = out[i..j].to_string();
        let val = |k: &str| tag.split(&format!(" {k}=\"")).nth(1).and_then(|x| x.split('"').next()).map(String::from);
        let rep = match (val("min"), val("max")) {
            (Some(a), Some(b)) => match span(&a, &b) {
                Some((x, y)) => tag.replacen(&format!(" min=\"{a}\""), &format!(" min=\"{}\"", x + 1), 1).replacen(&format!(" max=\"{b}\""), &format!(" max=\"{}\"", y + 1), 1),
                None => String::new(),
            },
            _ => tag.clone(),
        };
        out.replace_range(i..j, &rep);
        from = i + rep.len();
    }
    fix_group(&out, "cols", "col")
}

/// 바꾼 시트 부품 전체
fn shift_target_sheet(xml: &str, name: &str, sh: Shift) -> Result<String, String> {
    let mut x = shift_rows(xml, name, sh)?;
    let sq = |v: &str| shift_sqref(v, sh);
    for (tag, key) in [("mergeCell", "ref"), ("conditionalFormatting", "sqref"), ("dataValidation", "sqref"), ("hyperlink", "ref"), ("selection", "sqref"), ("protectedRange", "sqref")] {
        x = edit_attr(&x, tag, key, sq);
    }
    // 걸러 보기·고정 틀 왼쪽 위 칸은 지워져도 요소를 안 지운다(A1 로)
    x = edit_attr(&x, "autoFilter", "ref", |v| Some(sq(v).unwrap_or_else(|| "A1".into())));
    x = edit_attr(&x, "selection", "activeCell", |v| Some(sq(v).unwrap_or_else(|| "A1".into())));
    x = edit_attr(&x, "pane", "topLeftCell", |v| Some(sq(v).unwrap_or_else(|| v.to_string())));
    for tag in ["formula", "formula1", "formula2"] { x = edit_text(&x, tag, |f| shift_formula(f, name, name, sh)); }
    for (g, i) in [("mergeCells", "mergeCell"), ("dataValidations", "dataValidation"), ("hyperlinks", "hyperlink")] { x = fix_group(&x, g, i); }
    if sh.axis == Axis::Col { x = shift_cols(&x, sh); }
    Ok(x)
}

/// 그림 자리(<xdr:from>/<xdr:to> 의 row·col) — 지워진 줄 위면 그 자리로
fn shift_anchor(xml: &str, sh: Shift) -> String {
    let tag = if sh.axis == Axis::Row { "row" } else { "col" };
    edit_text(xml, tag, |t| match t.trim().parse::<u32>() {
        Ok(v) => sh.point(v).unwrap_or(sh.at).to_string(),
        Err(_) => t.to_string(),
    })
}

/// 메모(comments.xml)와 메모 상자(VML)
fn shift_comments(parts: &mut Parts, sheet_part: &str, sh: Shift) {
    for (kind, p) in rels(parts, sheet_part).into_values() {
        if kind == "comments" {
            if let Some(x) = get(parts, &p) { put(parts, &p, edit_attr(&x, "comment", "ref", |v| shift_sqref(v, sh))); }
        } else if kind == "vmlDrawing" {
            if let Some(x) = get(parts, &p) { put(parts, &p, shift_vml(&x, sh)); }
        }
    }
}

fn shift_vml(x: &str, sh: Shift) -> String {
    let (tag, anchor_idx) = if sh.axis == Axis::Row { ("x:Row", [2usize, 6]) } else { ("x:Column", [0usize, 4]) };
    let mut out = String::with_capacity(x.len());
    let mut rest = x;
    while let Some(i) = rest.find("<v:shape ") {
        out.push_str(&rest[..i]);
        let Some(j) = rest[i..].find("</v:shape>").map(|k| i + k + 10) else { break };
        let mut shape = rest[i..j].to_string();
        let open = format!("<{tag}>");
        let close = format!("</{tag}>");
        let pos = shape.find(&open).and_then(|a| { let b = shape[a..].find(&close)? + a; Some((a + open.len(), b)) });
        let keep = match pos.and_then(|(a, b)| shape[a..b].trim().parse::<u32>().ok().map(|v| (a, b, v))) {
            Some((a, b, v)) => match sh.point(v) { Some(nv) => { shape.replace_range(a..b, &nv.to_string()); true } None => false },
            None => true,
        };
        if keep {
            if let Some(a) = shape.find("<x:Anchor>").map(|k| k + 10) {
                if let Some(b) = shape[a..].find("</x:Anchor>").map(|k| a + k) {
                    let mut nums: Vec<String> = shape[a..b].split(',').map(|s| s.trim().to_string()).collect();
                    for k in anchor_idx { if let Some(v) = nums.get(k).and_then(|s| s.parse::<u32>().ok()) { nums[k] = sh.point(v).unwrap_or(sh.at).to_string(); } }
                    shape.replace_range(a..b, &nums.join(", "));
                }
            }
            out.push_str(&shape);
        }
        rest = &rest[j..];
    }
    out.push_str(rest);
    out
}

/// 행·열 한 번을 통합 문서 전체에 — target = 바꾼 시트 부품
pub fn shift_package(parts: &mut Parts, sheets: &[SheetInfo], target: &str, sh: Shift) -> Result<(), String> {
    let name = sheets.iter().find(|s| s.part == target).map(|s| s.name.clone()).ok_or("그 시트가 없어")?;
    // 표(table) 안에 열을 끼우거나 지우면 표 열 목록까지 고쳐야 해서 아직 막는다
    let tables: Vec<String> = rels(parts, target).into_values().filter(|(k, _)| k == "table").map(|(_, p)| p).collect();
    if sh.axis == Axis::Col {
        for t in &tables {
            let Some(x) = get(parts, t) else { continue };
            let rf = x.split(" ref=\"").nth(1).and_then(|v| v.split('"').next()).unwrap_or("");
            let (a, b) = rf.split_once(':').unwrap_or((rf, rf));
            if let (Some((_, c0)), Some((_, c1))) = (parse_a1(a), parse_a1(b)) {
                if sh.at > c0 && sh.at <= c1 || (sh.n < 0 && sh.at <= c1 && sh.at + sh.n.unsigned_abs() as u32 > c0) {
                    return Err("표(테이블) 안에 열을 끼우거나 지우는 건 아직 못 해 — 엑셀에서 해 줘".into());
                }
            }
        }
    }
    for s in sheets {
        let Some(x) = get(parts, &s.part) else { continue };
        let new = if s.part == target { shift_target_sheet(&x, &name, sh)? } else if crate::sheet_sheets::mentions(&x, &name) {
            // 다른 시트: 이 시트를 가리키는 수식만. 공유 수식이 있으면 펼친 뒤(따라오는 칸마다 밀림이 달라질 수 있다)
            let (head, mut rows, tail) = split_rows(&x)?;
            let all: HashSet<String> = rows.iter().flat_map(|r| r.cells.values().filter_map(|c| crate::sheet_patch::shared_si(c))).collect();
            if !all.is_empty() { expand_shared(&mut rows, &all); }
            for row in rows.iter_mut() {
                let r = row.r;
                for (c, raw) in row.cells.iter_mut() { *raw = rewrite_cell(raw, r, *c, &|f: &str| shift_formula(f, &name, &s.name, sh), None); }
            }
            let mut y = join_rows(&head, &rows, &tail);
            for tag in ["formula", "formula1", "formula2"] { y = edit_text(&y, tag, |f| shift_formula(f, &name, &s.name, sh)); }
            y
        } else { continue };
        put(parts, &s.part, new);
    }
    if let Some(wb) = get(parts, "xl/workbook.xml") { put(parts, "xl/workbook.xml", edit_text(&wb, "definedName", |f| shift_formula(f, &name, "", sh))); }
    let names: Vec<String> = parts.keys().cloned().collect();
    for p in names {
        if p.starts_with("xl/charts/chart") && p.ends_with(".xml") {
            if let Some(x) = get(parts, &p) { if crate::sheet_sheets::mentions(&x, &name) { put(parts, &p, edit_text(&x, "f", |f| shift_formula(f, &name, "", sh))); } }
        } else if p.starts_with("xl/pivotCache/pivotCacheDefinition") {
            if let Some(x) = get(parts, &p) {
                if x.contains(&format!("sheet=\"{}\"", esc(&name))) { put(parts, &p, edit_attr(&x, "worksheetSource", "ref", |v| Some(shift_sqref(v, sh).unwrap_or_else(|| v.to_string())))); }
            }
        }
    }
    for (kind, p) in rels(parts, target).into_values() {
        if kind == "drawing" { if let Some(x) = get(parts, &p) { put(parts, &p, shift_anchor(&x, sh)); } }
    }
    shift_comments(parts, target, sh);
    if sh.axis == Axis::Row {
        for t in tables {
            if let Some(x) = get(parts, &t) {
                let y = edit_attr(&x, "table", "ref", |v| Some(shift_sqref(v, sh).unwrap_or_else(|| v.to_string())));
                put(parts, &t, edit_attr(&y, "autoFilter", "ref", |v| Some(shift_sqref(v, sh).unwrap_or_else(|| v.to_string()))));
            }
        }
    }
    Ok(())
}

/// 저장에 들어오는 조작 하나 — 칸 고침과 행·열·시트 조작이 화면에서 한 순서대로 온다(칸 주소는 그 앞 조작이 끝난 뒤 자리).
/// part 는 시트 부품 경로 또는 그때의 시트 이름(새로 만든 시트는 이름으로)
#[derive(serde::Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Op {
    Cell(crate::sheet_patch::CellEdit),
    InsertRows { part: String, at: u32, n: u32 },
    DeleteRows { part: String, at: u32, n: u32 },
    InsertCols { part: String, at: u32, n: u32 },
    DeleteCols { part: String, at: u32, n: u32 },
    AddSheet { name: String },
    RenameSheet { part: String, name: String },
    DeleteSheet { part: String },
    Merge { part: String, range: String },
    Unmerge { part: String, range: String },
    /// 열 너비(엑셀 글자 단위)·행 높이(pt) — 화면이 픽셀에서 바꿔 보낸다
    ColWidth { part: String, at: u32, n: u32, width: f64 },
    RowHeight { part: String, at: u32, n: u32, height: f64 },
}

/// 원본 xlsx + 조작들 → 새 xlsx. 손대지 않은 부품은 압축된 그대로
pub fn apply_ops(bytes: &[u8], ops: &[Op]) -> Result<Vec<u8>, String> {
    use crate::sheet_patch::{drop_calc_chain, full_calc, patch_sheet, rezip, CellEdit};
    let orig = crate::sheet::unzip(bytes)?;
    let mut parts = orig.clone();
    let mut styles: Option<crate::sheet_style_write::StyleBook> = None;
    let mut batch: Vec<CellEdit> = Vec::new();
    let flush = |parts: &mut Parts, batch: &mut Vec<CellEdit>, styles: &mut Option<crate::sheet_style_write::StyleBook>| -> Result<(), String> {
        if batch.is_empty() { return Ok(()); }
        if batch.iter().any(|e| e.style.is_some()) && styles.is_none() { *styles = crate::sheet_style_write::StyleBook::new(parts); }
        if let Some(sb) = styles.as_mut() { for e in batch.iter_mut() { if let Some(st) = e.style.take() { e.s = Some(sb.index_of(&st)); } } }
        let mut by_part: BTreeMap<String, Vec<&CellEdit>> = BTreeMap::new();
        for e in batch.iter() { by_part.entry(crate::sheet_sheets::resolve(parts, &e.part)?).or_default().push(e); }
        for (part, es) in by_part {
            let xml = get(parts, &part).ok_or_else(|| format!("{part} 시트가 없어"))?;
            put(parts, &part, patch_sheet(&xml, &es)?);
        }
        batch.clear();
        Ok(())
    };
    for op in ops {
        let (part, sh) = match op {
            Op::Cell(e) => { batch.push(e.clone()); continue; }
            Op::InsertRows { part, at, n } => (part, Shift { axis: Axis::Row, at: *at, n: *n as i64 }),
            Op::DeleteRows { part, at, n } => (part, Shift { axis: Axis::Row, at: *at, n: -(*n as i64) }),
            Op::InsertCols { part, at, n } => (part, Shift { axis: Axis::Col, at: *at, n: *n as i64 }),
            Op::DeleteCols { part, at, n } => (part, Shift { axis: Axis::Col, at: *at, n: -(*n as i64) }),
            Op::AddSheet { name } => { flush(&mut parts, &mut batch, &mut styles)?; crate::sheet_sheets::add_sheet(&mut parts, name)?; continue; }
            Op::RenameSheet { part, name } => {
                flush(&mut parts, &mut batch, &mut styles)?;
                let p = crate::sheet_sheets::resolve(&parts, part)?;
                crate::sheet_sheets::rename_sheet(&mut parts, &p, name)?;
                continue;
            }
            Op::Merge { part, range } | Op::Unmerge { part, range } => {
                flush(&mut parts, &mut batch, &mut styles)?;
                let p = crate::sheet_sheets::resolve(&parts, part)?;
                let xml = get(&parts, &p).ok_or("그 시트가 없어")?;
                let new = if matches!(op, Op::Merge { .. }) { crate::sheet_layout_ops::merge(&xml, range) } else { crate::sheet_layout_ops::unmerge(&xml, range) };
                put(&mut parts, &p, new);
                continue;
            }
            Op::ColWidth { part, at, n, width } => {
                let p = crate::sheet_sheets::resolve(&parts, part)?;
                let xml = get(&parts, &p).ok_or("그 시트가 없어")?;
                put(&mut parts, &p, crate::sheet_layout_ops::col_width(&xml, *at, *n, *width));
                continue;
            }
            Op::RowHeight { part, at, n, height } => {
                flush(&mut parts, &mut batch, &mut styles)?;
                let p = crate::sheet_sheets::resolve(&parts, part)?;
                let xml = get(&parts, &p).ok_or("그 시트가 없어")?;
                put(&mut parts, &p, crate::sheet_layout_ops::row_height(&xml, *at, *n, *height)?);
                continue;
            }
            Op::DeleteSheet { part } => {
                flush(&mut parts, &mut batch, &mut styles)?;
                let p = crate::sheet_sheets::resolve(&parts, part)?;
                crate::sheet_sheets::delete_sheet(&mut parts, &p)?;
                continue;
            }
        };
        flush(&mut parts, &mut batch, &mut styles)?;
        if sh.n == 0 { continue; }
        let list = crate::sheet::sheet_list(&parts)?;
        let p = crate::sheet_sheets::resolve(&parts, part)?;
        shift_package(&mut parts, &list, &p, sh)?;
    }
    flush(&mut parts, &mut batch, &mut styles)?;
    if let Some(xml) = styles.and_then(|sb| sb.finish()) { put(&mut parts, "xl/styles.xml", xml); }
    if !ops.is_empty() {
        if let Some(wb) = get(&parts, "xl/workbook.xml") { put(&mut parts, "xl/workbook.xml", full_calc(&wb)); }
        drop_calc_chain(&mut parts);
    }
    let replaced: std::collections::HashMap<String, Vec<u8>> = parts.iter().filter(|(k, v)| orig.get(*k) != Some(*v)).map(|(k, v)| (k.clone(), v.clone())).collect();
    let removed: HashSet<String> = orig.keys().filter(|k| !parts.contains_key(*k)).cloned().collect();
    rezip(bytes, &replaced, &removed)
}

#[cfg(test)]
#[path = "sheet_struct_tests.rs"]
mod tests;
