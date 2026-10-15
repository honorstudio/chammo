// 스페이스 엑셀 읽기 시험 — 시험 xlsx 는 여기서 XML 로 지어 zip 으로 묶는다(지어낸 값만)
use super::*;
use std::io::Write;

pub(crate) const CT: &str = r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#;
pub(crate) const ROOT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#;
pub(crate) const WB: &str = r#"<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="매출" sheetId="1" r:id="rId1"/><sheet name="요약 &amp; 메모" sheetId="2" state="hidden" r:id="rId2"/></sheets><calcPr calcId="191029"/></workbook>"#;
pub(crate) const WB_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/s2.xml"/><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>"#;
pub(crate) const SST: &str = r#"<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4"><si><t>품목</t></si><si><r><rPr><b/></rPr><t>연</t></r><r><t xml:space="preserve">필 </t></r></si><si><t>A&amp;B &lt;끝&gt;</t></si><si/></sst>"#;
pub(crate) const SHEET1: &str = r#"<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:D5"/><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s" s="2"><v>1</v></c></row><row r="2"><c r="A2"><v>120</v></c><c r="B2"><v>500</v></c><c r="C2" s="3"><f>A2*B2</f><v>60000</v></c></row><row r="3"><c r="A3"><v>80</v></c><c r="B3"><v>1200.5</v></c><c r="C3"><f t="shared" ref="C3:C4" si="0">A3*B3</f><v>96040</v></c></row><row r="4"><c r="A4"><v>1</v></c><c r="B4"><v>2</v></c><c r="C4"><f t="shared" si="0"/><v>2</v></c></row><row r="5"><c t="b"><v>1</v></c><c t="e"><v>#DIV/0!</v></c><c t="inlineStr"><is><t>바로 &amp; 글</t></is></c><c r="D5" s="1"/></row></sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells></worksheet>"#;
pub(crate) const SHEET2: &str = r#"<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="str"><f>'매출'!C2&amp;"원"</f><v>60000원</v></c></row></sheetData></worksheet>"#;

/// 부품들 → xlsx 바이트
pub(crate) fn zip_of(parts: &[(&str, &[u8])]) -> Vec<u8> {
    let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, data) in parts {
        w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(data).unwrap();
    }
    w.finish().unwrap().into_inner()
}

/// 기본 시험 통합 문서 — extra 로 부품을 더하거나 바꾼다
pub(crate) fn book(extra: &[(&str, &str)]) -> Vec<u8> {
    let mut parts: Vec<(&str, &str)> = vec![
        ("[Content_Types].xml", CT), ("_rels/.rels", ROOT_RELS), ("xl/workbook.xml", WB), ("xl/_rels/workbook.xml.rels", WB_RELS),
        ("xl/sharedStrings.xml", SST), ("xl/worksheets/sheet1.xml", SHEET1), ("xl/worksheets/s2.xml", SHEET2),
    ];
    for (n, d) in extra {
        if let Some(p) = parts.iter_mut().find(|p| p.0 == *n) { p.1 = d; } else { parts.push((n, d)); }
    }
    zip_of(&parts.iter().map(|(n, d)| (*n, d.as_bytes())).collect::<Vec<_>>())
}

fn cell<'a>(cells: &'a [Cell], a: &str) -> &'a Cell {
    let (r, c) = parse_a1(a).unwrap();
    cells.iter().find(|x| x.r == r && x.c == c).unwrap_or_else(|| panic!("{a} 칸이 없어"))
}

#[test]
fn 시트_목록은_통합_문서_순서와_rels_경로대로() {
    let parts = unzip(&book(&[])).unwrap();
    let list = sheet_list(&parts).unwrap();
    assert_eq!(list, vec![
        SheetInfo { name: "매출".into(), part: "xl/worksheets/sheet1.xml".into(), hidden: false },
        SheetInfo { name: "요약 & 메모".into(), part: "xl/worksheets/s2.xml".into(), hidden: true },
    ]);
}

#[test]
fn 공유_문자열은_서식_섞인_글을_잇고_엔티티를_푼다() {
    let parts = unzip(&book(&[])).unwrap();
    assert_eq!(shared_strings(&parts), vec!["품목", "연필 ", "A&B <끝>", ""]);
}

#[test]
fn 칸_값_종류와_수식() {
    let parts = unzip(&book(&[])).unwrap();
    let cells = read_cells(part_str(&parts, "xl/worksheets/sheet1.xml").unwrap(), &shared_strings(&parts)).unwrap();
    assert_eq!(cell(&cells, "A1").v, Some(serde_json::json!("품목")));
    assert_eq!(cell(&cells, "B1").s, 2);
    assert_eq!(cell(&cells, "B3").v, Some(serde_json::json!(1200.5)));
    let c2 = cell(&cells, "C2");
    assert_eq!((c2.f.as_deref(), c2.v.clone(), c2.s), (Some("A2*B2"), Some(serde_json::json!(60000.0)), 3));
    // r 없는 칸은 앞 칸 다음 자리
    assert_eq!(cell(&cells, "A5").v, Some(serde_json::json!(true)));
    let b5 = cell(&cells, "B5");
    assert!(b5.err && b5.v == Some(serde_json::json!("#DIV/0!")));
    assert_eq!(cell(&cells, "C5").v, Some(serde_json::json!("바로 & 글")));
    // 값 없는 서식만 있는 칸도 남긴다(서식이 보여야 하니)
    let d5 = cell(&cells, "D5");
    assert_eq!((d5.v.is_none(), d5.s), (true, 1));
}

#[test]
fn 공유_수식은_기준_칸에서_옮겨_펼친다() {
    let parts = unzip(&book(&[])).unwrap();
    let cells = read_cells(part_str(&parts, "xl/worksheets/sheet1.xml").unwrap(), &[]).unwrap();
    assert_eq!(cell(&cells, "C3").f.as_deref(), Some("A3*B3"));
    assert_eq!(cell(&cells, "C4").f.as_deref(), Some("A4*B4"));
}

#[test]
fn 다른_시트_참조_수식과_글_결과() {
    let parts = unzip(&book(&[])).unwrap();
    let cells = read_cells(part_str(&parts, "xl/worksheets/s2.xml").unwrap(), &[]).unwrap();
    let a1 = cell(&cells, "A1");
    assert_eq!((a1.f.as_deref(), a1.v.clone()), (Some("'매출'!C2&\"원\""), Some(serde_json::json!("60000원"))));
}

#[test]
fn xlsx_가_아니면_알아듣게_실패() {
    assert!(unzip(b"not a zip").unwrap_err().contains("xlsx"));
}

pub(crate) const STYLES: &str = r##"<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0&quot;원&quot;"/></numFmts><fonts count="2"><font><sz val="11"/><color theme="1"/><name val="맑은 고딕"/></font><font><b/><i val="0"/><u/><sz val="14"/><color rgb="FFFF0000"/><name val="맑은 고딕"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor theme="4" tint="0.39997558519241921"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color indexed="8"/></left><right/><top/><bottom style="double"/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="14" fontId="0" fillId="1" borderId="0" xfId="0"><alignment horizontal="general" vertical="top"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><dxfs count="1"><dxf><font><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf></dxfs></styleSheet>"##;

#[test]
fn 칸_서식_글꼴_채우기_테두리_숫자_서식() {
    let parts = unzip(&book(&[("xl/styles.xml", STYLES)])).unwrap();
    let st = crate::sheet_style::styles(&parts);
    assert_eq!(st.cell.len(), 4);
    assert_eq!(st.cell[0], crate::sheet_style::Style::default());
    assert_eq!((st.font.sz, st.font.name.as_deref(), st.font.color.as_deref()), (Some(11.0), Some("맑은 고딕"), Some("#000000")));
    let x = &st.cell[1];
    assert_eq!(x.num_fmt.as_deref(), Some("#,##0\"원\""));
    let f = x.font.as_ref().unwrap();
    assert_eq!((f.b, f.i, f.u, f.sz, f.color.as_deref()), (true, false, true, Some(14.0), Some("#FF0000")));
    assert_eq!(x.fill.as_deref(), Some("#8FAADC")); // 강조 1, 40% 밝게
    let b = x.border.as_ref().unwrap();
    assert_eq!((b.l.as_ref().map(|e| (e.style.as_str(), e.color.as_deref())), b.b.as_ref().map(|e| e.style.as_str()), b.r.is_none()), (Some(("thin", Some("#000000"))), Some("double"), true));
    let a = x.align.as_ref().unwrap();
    assert_eq!((a.h.as_deref(), a.v.as_deref(), a.wrap), (Some("center"), Some("center"), true));
    // 내장 번호 서식, 무늬 채우기(gray125)는 단색이 아니라 색 없음
    assert_eq!((st.cell[2].num_fmt.as_deref(), st.cell[2].fill.as_ref()), (Some("yyyy-mm-dd"), None));
    // 가로 general 은 기본값이라 안 적는다
    assert_eq!(st.cell[2].align.as_ref().map(|a| (a.h.clone(), a.v.clone())), Some((None, Some("top".into()))));
    assert_eq!(st.cell[3].num_fmt.as_deref(), Some("#,##0"));
}

#[test]
fn 조건부_서식_서식은_bgColor_가_채우기() {
    let parts = unzip(&book(&[("xl/styles.xml", STYLES)])).unwrap();
    let d = &crate::sheet_style::styles(&parts).dxf[0];
    assert_eq!((d.fill.as_deref(), d.font.as_ref().and_then(|f| f.color.as_deref())), (Some("#FFC7CE"), Some("#9C0006")));
}

#[test]
fn 서식_부품이_없어도_기본_한_칸() {
    let parts = unzip(&book(&[])).unwrap();
    assert_eq!(crate::sheet_style::styles(&parts).cell, vec![crate::sheet_style::Style::default()]);
}

const SHEET_LAYOUT: &str = r#"<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="2" topLeftCell="B3" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="16.5"/><cols><col min="1" max="1" width="8.5" customWidth="1"/><col min="2" max="4" width="16" customWidth="1" hidden="1"/></cols><sheetData><row r="1" ht="28" customHeight="1"><c r="A1"><v>1</v></c></row><row r="2" hidden="1"/><row r="3" ht="15"><c r="A3"><v>2</v></c></row></sheetData><mergeCells count="2"><mergeCell ref="A1:E1"/><mergeCell ref="B5:C6"/></mergeCells><conditionalFormatting sqref="B2:E13"><cfRule type="expression" dxfId="0" priority="2"><formula>B2&lt;AVERAGE(B$2:B$13)*0.8</formula></cfRule><cfRule type="cellIs" dxfId="1" priority="3" operator="between"><formula>10</formula><formula>20</formula></cfRule></conditionalFormatting><dataValidations count="1"><dataValidation type="list" allowBlank="1" sqref="B3:B8"><formula1>"연필,공책"</formula1></dataValidation></dataValidations><drawing r:id="rId7"/></worksheet>"#;
const SHEET_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>"#;
const DRAWING_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>"#;

pub(crate) fn layout_book() -> Vec<u8> {
    book(&[("xl/worksheets/sheet1.xml", SHEET_LAYOUT), ("xl/worksheets/_rels/sheet1.xml.rels", SHEET_RELS), ("xl/drawings/drawing1.xml", "<wsDr/>"),
        ("xl/drawings/_rels/drawing1.xml.rels", DRAWING_RELS), ("xl/charts/chart1.xml", "<chartSpace/>"), ("xl/styles.xml", STYLES)])
}

#[test]
fn 시트_모양_병합_너비_높이_고정틀() {
    let b = crate::sheet_book::read_book(&layout_book()).unwrap();
    let s = &b.sheets[0];
    let l = &s.layout;
    assert_eq!(l.merges, vec!["A1:E1", "B5:C6"]);
    assert_eq!(l.freeze, Some([2, 1]));
    assert_eq!(l.default_row_height, Some(16.5));
    assert_eq!(l.cols.len(), 2);
    assert_eq!((l.cols[1].min, l.cols[1].max, l.cols[1].width, l.cols[1].hidden), (1, 3, Some(16.0), true));
    // 사용자 지정 높이·숨김만(ht 만 있고 customHeight 없는 3행은 뺀다)
    assert_eq!(l.rows.iter().map(|r| (r.r, r.ht, r.hidden)).collect::<Vec<_>>(), vec![(0, Some(28.0), false), (1, None, true)]);
    assert_eq!((s.charts, s.images), (1, 1));
    assert_eq!(b.sheets[1].charts, 0);
}

#[test]
fn 조건부_서식_규칙과_입력_목록() {
    let b = crate::sheet_book::read_book(&layout_book()).unwrap();
    let l = &b.sheets[0].layout;
    assert_eq!(l.cond.len(), 2);
    assert_eq!((l.cond[0].sqref.as_str(), l.cond[0].kind.as_str(), l.cond[0].formulas.clone(), l.cond[0].dxf), ("B2:E13", "expression", vec!["B2<AVERAGE(B$2:B$13)*0.8".to_string()], Some(0)));
    assert_eq!((l.cond[1].op.as_deref(), l.cond[1].formulas.len(), l.cond[1].priority), (Some("between"), 2, 3));
    assert_eq!(l.valid, vec![crate::sheet_book::Valid { sqref: "B3:B8".into(), kind: "list".into(), formula1: "\"연필,공책\"".into() }]);
}

#[test]
fn 화면에_넘기는_json_모양() {
    let b = crate::sheet_book::read_book(&layout_book()).unwrap();
    let j = serde_json::to_value(&b).unwrap();
    let s0 = &j["sheets"][0];
    assert_eq!(s0["name"], "매출");
    assert_eq!(s0["merges"][0], "A1:E1"); // 모양은 시트에 펼쳐서
    assert!(s0.get("drawing").is_none());
    assert_eq!(j["styles"]["cell"][1]["numFmt"], "#,##0\"원\"");
}

/// 실제 시험 파일로 한 번(.shots 에 있을 때만): SHEET_EVAL=<xlsx> cargo test sheet_eval -- --ignored --nocapture
#[test]
#[ignore]
fn sheet_eval() {
    let p = std::env::var("SHEET_EVAL").unwrap();
    let t = std::time::Instant::now();
    let b = crate::sheet_book::read_book(&std::fs::read(&p).unwrap()).unwrap();
    let n: usize = b.sheets.iter().map(|s| s.cells.len()).sum();
    println!("{p}: 시트 {} · 칸 {n} · 서식 {} · {}ms · json {}KB", b.sheets.len(), b.styles.cell.len(), t.elapsed().as_millis(), serde_json::to_vec(&b).unwrap().len() / 1024);
    for s in &b.sheets { println!("  {} 병합 {:?} 고정 {:?} 조건부 {} 차트 {} 그림 {}", s.name, s.layout.merges, s.layout.freeze, s.layout.cond.len(), s.charts, s.images); }
    if let Ok(out) = std::env::var("SHEET_JSON") { std::fs::write(out, serde_json::to_vec(&b).unwrap()).unwrap(); }
}
