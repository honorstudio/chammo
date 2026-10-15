//! 스페이스 엑셀 — 시트 모양(병합·열 너비·행 높이·고정 틀·조건부 서식·입력 목록·차트 수)과 화면에 넘길 통합 문서 한 벌(read_sheet_book)

use quick_xml::events::Event;
use quick_xml::reader::Reader;
use serde::Serialize;

use crate::sheet::{attr, part_str, push_text, read_cells, rels, shared_strings, sheet_list, unzip, Cell, Parts};
use crate::sheet_style::{styles, Styles};

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Col { pub min: u32, pub max: u32, #[serde(skip_serializing_if = "Option::is_none")] pub width: Option<f64>, #[serde(skip_serializing_if = "std::ops::Not::not")] pub hidden: bool }

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct RowInfo { pub r: u32, #[serde(skip_serializing_if = "Option::is_none")] pub ht: Option<f64>, #[serde(skip_serializing_if = "std::ops::Not::not")] pub hidden: bool }

/// 조건부 서식 규칙 하나 — kind = cfRule type(cellIs·expression·colorScale…), 화면이 못 그리는 종류는 화면이 건너뛴다
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cond {
    pub sqref: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")] pub op: Option<String>,
    pub formulas: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub dxf: Option<u32>,
    pub priority: i64,
    #[serde(skip_serializing_if = "Option::is_none")] pub text: Option<String>,
}

/// 입력 목록(데이터 유효성) — list 면 formula1 이 "가,나,다" 또는 범위
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Valid { pub sqref: String, pub kind: String, pub formula1: String }

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub merges: Vec<String>,
    pub cols: Vec<Col>,
    pub rows: Vec<RowInfo>,
    /// 고정 틀 — 위에서 몇 행, 왼쪽에서 몇 열
    #[serde(skip_serializing_if = "Option::is_none")] pub freeze: Option<[u32; 2]>,
    pub cond: Vec<Cond>,
    pub valid: Vec<Valid>,
    #[serde(skip_serializing_if = "Option::is_none")] pub default_col_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub default_row_height: Option<f64>,
    /// 시트의 그림 부품 rId — 차트 수 세는 데만
    #[serde(skip)]
    pub drawing: Option<String>,
}

pub fn read_layout(xml: &str) -> Layout {
    let mut l = Layout::default();
    let mut r = Reader::from_str(xml);
    let mut cond: Option<Cond> = None;
    let mut valid: Option<Valid> = None;
    let (mut buf, mut in_formula) = (String::new(), false);
    loop {
        let ev = match r.read_event() { Ok(e) => e, Err(_) => break };
        match &ev {
            Event::Start(e) | Event::Empty(e) => {
                let empty = matches!(ev, Event::Empty(_));
                let num = |k: &str| attr(e, k).and_then(|v| v.parse::<f64>().ok());
                let yes = |k: &str| attr(e, k).is_some_and(|v| v == "1" || v == "true");
                match e.local_name().as_ref() {
                    "sheetFormatPr" => { l.default_col_width = num("defaultColWidth"); l.default_row_height = num("defaultRowHeight"); }
                    "col" => if let (Some(min), Some(max)) = (num("min"), num("max")) {
                        l.cols.push(Col { min: min as u32 - 1, max: max as u32 - 1, width: num("width").filter(|_| yes("customWidth") || attr(e, "customWidth").is_none()), hidden: yes("hidden") });
                    },
                    "row" => if let Some(n) = num("r") {
                        let (ht, hidden) = (num("ht").filter(|_| yes("customHeight")), yes("hidden"));
                        if ht.is_some() || hidden { l.rows.push(RowInfo { r: n as u32 - 1, ht, hidden }); }
                    },
                    "pane" if attr(e, "state").is_some_and(|s| s.starts_with("frozen")) => {
                        l.freeze = Some([num("ySplit").unwrap_or(0.0) as u32, num("xSplit").unwrap_or(0.0) as u32]);
                    }
                    "mergeCell" => if let Some(x) = attr(e, "ref") { l.merges.push(x) },
                    "conditionalFormatting" => cond = attr(e, "sqref").map(|sqref| Cond { sqref, kind: String::new(), op: None, formulas: vec![], dxf: None, priority: 0, text: None }),
                    "cfRule" => if let Some(c) = cond.as_mut() {
                        // 한 범위에 규칙이 여럿이면 범위를 복사해 따로 낸다
                        if !c.kind.is_empty() { l.cond.push(c.clone()); c.formulas.clear(); }
                        c.kind = attr(e, "type").unwrap_or_default();
                        c.op = attr(e, "operator");
                        c.dxf = attr(e, "dxfId").and_then(|v| v.parse().ok());
                        c.priority = attr(e, "priority").and_then(|v| v.parse().ok()).unwrap_or(0);
                        c.text = attr(e, "text");
                    },
                    "dataValidation" => valid = attr(e, "sqref").map(|sqref| Valid { sqref, kind: attr(e, "type").unwrap_or_default(), formula1: String::new() }),
                    "formula" | "formula1" if !empty => { in_formula = true; buf.clear(); }
                    "drawing" => l.drawing = e.attributes().flatten().find(|a| a.key.as_ref().ends_with(":id") || a.key.as_ref() == "id")
                        .and_then(|a| a.normalized_value(quick_xml::XmlVersion::Implicit1_0).ok()).map(|v| v.into_owned()),
                    _ => {}
                }
            }
            Event::End(e) => match e.local_name().as_ref() {
                "formula" if in_formula => { in_formula = false; if let Some(c) = cond.as_mut() { c.formulas.push(std::mem::take(&mut buf)); } }
                "formula1" if in_formula => { in_formula = false; if let Some(v) = valid.as_mut() { v.formula1 = std::mem::take(&mut buf); } }
                "conditionalFormatting" => if let Some(c) = cond.take() { if !c.kind.is_empty() { l.cond.push(c); } },
                "dataValidation" => if let Some(v) = valid.take() { l.valid.push(v); },
                _ => {}
            },
            Event::Eof => break,
            _ if in_formula => push_text(&mut buf, &ev),
            _ => {}
        }
    }
    l
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SheetOut {
    pub name: String,
    pub part: String,
    pub hidden: bool,
    pub cells: Vec<Cell>,
    #[serde(flatten)]
    pub layout: Layout,
    /// 화면이 못 그리는 것 — 저장해도 원본에 그대로 남는다(차트 칩)
    pub charts: u32,
    pub images: u32,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Book { pub sheets: Vec<SheetOut>, pub styles: Styles }

/// 그림 부품의 차트·그림 수
fn drawing_counts(parts: &Parts, drawing: &str) -> (u32, u32) {
    let rel = rels(parts, drawing);
    let n = |k: &str| rel.values().filter(|(kind, _)| kind == k).count() as u32;
    (n("chart"), n("image"))
}

pub fn read_book(bytes: &[u8]) -> Result<Book, String> {
    let parts = unzip(bytes)?;
    let sst = shared_strings(&parts);
    let mut sheets = Vec::new();
    for info in sheet_list(&parts)? {
        let xml = part_str(&parts, &info.part).ok_or_else(|| format!("{} 시트 부품이 없어", info.name))?;
        let layout = read_layout(xml);
        let (charts, images) = layout.drawing.as_ref()
            .and_then(|id| rels(&parts, &info.part).get(id).map(|(_, p)| drawing_counts(&parts, p)))
            .unwrap_or((0, 0));
        sheets.push(SheetOut { cells: read_cells(xml, &sst)?, name: info.name, part: info.part, hidden: info.hidden, layout, charts, images });
    }
    Ok(Book { sheets, styles: styles(&parts) })
}

/// 열어 둔 xlsx 를 화면용으로 — 홈 안 xlsx·xlsm 만. 도장(stamp)을 같이 줘서 저장·다시 읽기가 바깥 변경을 알아본다
#[derive(Serialize)]
pub struct Opened { pub book: Book, pub stamp: String }

pub fn sheet_file(path: &str) -> Result<std::path::PathBuf, String> {
    let home = std::path::PathBuf::from(crate::platform::home());
    let p = crate::reader::safe_path(path, &home).ok_or(crate::i18n::tr("홈 폴더 밖이거나 없는 파일", "Outside the home folder or file not found"))?;
    let ok = matches!(p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(), Some("xlsx" | "xlsm"));
    if ok { Ok(p) } else { Err(crate::i18n::tr("엑셀(.xlsx) 파일만 열 수 있어", "Only Excel (.xlsx) files can be opened").into()) }
}

#[tauri::command]
pub async fn read_sheet_book(path: String) -> Result<Opened, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = sheet_file(&path)?;
        let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
        let stamp = crate::reader::stamp_of(&p).unwrap_or_default();
        Ok(Opened { book: read_book(&bytes)?, stamp })
    })
    .await
    .map_err(|e| e.to_string())?
}
