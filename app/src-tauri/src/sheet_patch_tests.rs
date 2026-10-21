// 스페이스 엑셀 저장 시험 — 원본에서 고친 칸만 바뀌고 나머지 부품은 그대로인지(지어낸 값만)
use super::*;
use crate::sheet::tests::{book, layout_book};
use crate::sheet_book::read_book;
use serde_json::json;

const S1: &str = "xl/worksheets/sheet1.xml";

fn ed(a: &str, v: Option<serde_json::Value>, f: Option<&str>) -> CellEdit {
    let (r, c) = parse_a1(a).unwrap();
    CellEdit { part: S1.into(), r, c, v, f: f.map(String::from), s: None, style: None }
}

fn cell_of(bytes: &[u8], sheet: usize, a: &str) -> Option<crate::sheet::Cell> {
    let (r, c) = parse_a1(a).unwrap();
    read_book(bytes).unwrap().sheets[sheet].cells.iter().find(|x| x.r == r && x.c == c).cloned()
}

#[test]
fn 고친_칸만_바뀌고_다른_부품은_그대로() {
    let src = layout_book();
    let out = apply(&src, &[ed("A1", Some(json!(12)), None)]).unwrap();
    assert_eq!(cell_of(&out, 0, "A1").unwrap().v, Some(json!(12.0)));
    let (a, b) = (unzip(&src).unwrap(), unzip(&out).unwrap());
    for name in ["xl/charts/chart1.xml", "xl/drawings/drawing1.xml", "xl/drawings/_rels/drawing1.xml.rels", "xl/styles.xml", "xl/sharedStrings.xml", "xl/worksheets/s2.xml"] {
        assert_eq!(a[name], b[name], "{name} 이 바뀌면 안 돼");
    }
    // 시트 안 sheetData 밖(고정 틀·병합·조건부 서식·그림 연결)도 그대로
    let (x, y) = (part_str(&a, S1).unwrap(), part_str(&b, S1).unwrap());
    for keep in ["<pane xSplit=\"1\"", "<mergeCell ref=\"B5:C6\"/>", "<conditionalFormatting sqref=\"B2:E13\">", "<drawing r:id=\"rId7\"/>"] {
        assert!(x.contains(keep) && y.contains(keep), "{keep}");
    }
    let mut zip_src = zip::ZipArchive::new(std::io::Cursor::new(&src)).unwrap();
    let mut zip_out = zip::ZipArchive::new(std::io::Cursor::new(&out)).unwrap();
    // 부품 순서도 그대로([Content_Types].xml 이 맨 앞)
    let names = |z: &mut zip::ZipArchive<std::io::Cursor<&Vec<u8>>>| (0..z.len()).map(|i| z.by_index_raw(i).unwrap().name().to_string()).collect::<Vec<_>>();
    assert_eq!(names(&mut zip_src), names(&mut zip_out));
}

#[test]
fn 새_행의_글_칸과_특수문자() {
    let out = apply(&book(&[]), &[ed("B10", Some(json!("새 <글> & \"끝\"")), None)]).unwrap();
    assert_eq!(cell_of(&out, 0, "B10").unwrap().v, Some(json!("새 <글> & \"끝\"")));
    // 원래 칸은 그대로
    assert_eq!(cell_of(&out, 0, "A1").unwrap().v, Some(json!("품목")));
}

#[test]
fn 수식과_계산_결과_글_결과_오류() {
    let out = apply(&book(&[]), &[
        ed("D2", Some(json!(120.5)), Some("A2+B2")),
        ed("D3", Some(json!("1월")), Some("TEXT(A3,\"0\")&\"월\"")),
        ed("D4", Some(json!("#DIV/0!")), Some("A4/0")),
        ed("D6", None, Some("SUM(A2:A4)")),
    ]).unwrap();
    let d2 = cell_of(&out, 0, "D2").unwrap();
    assert_eq!((d2.f.as_deref(), d2.v), (Some("A2+B2"), Some(json!(120.5))));
    assert_eq!(cell_of(&out, 0, "D3").unwrap().f.as_deref(), Some("TEXT(A3,\"0\")&\"월\""));
    assert!(cell_of(&out, 0, "D4").unwrap().err);
    let d6 = cell_of(&out, 0, "D6").unwrap();
    assert_eq!((d6.f.as_deref(), d6.v), (Some("SUM(A2:A4)"), None));
}

#[test]
fn 비우면_칸이_빠지고_서식_있는_칸은_서식만_남는다() {
    let out = apply(&book(&[]), &[ed("A2", None, None), ed("B1", None, None)]).unwrap();
    assert!(cell_of(&out, 0, "A2").is_none());
    let b1 = cell_of(&out, 0, "B1").unwrap();
    assert_eq!((b1.v, b1.s), (None, 2));
}

#[test]
fn 공유_수식_기준_칸을_고쳐도_따라오던_칸은_제_수식_유지() {
    let out = apply(&book(&[]), &[ed("C3", Some(json!(7)), None)]).unwrap();
    assert_eq!(cell_of(&out, 0, "C3").unwrap().f, None);
    assert_eq!(cell_of(&out, 0, "C4").unwrap().f.as_deref(), Some("A4*B4"));
    assert!(!part_str(&unzip(&out).unwrap(), S1).unwrap().contains("t=\"shared\""));
}

#[test]
fn 주소_없는_칸은_앞에_칸이_끼어도_제자리() {
    let out = apply(&book(&[]), &[ed("F5", Some(json!(1)), None)]).unwrap();
    assert_eq!(cell_of(&out, 0, "A5").unwrap().v, Some(json!(true)));
    assert_eq!(cell_of(&out, 0, "C5").unwrap().v, Some(json!("바로 & 글")));
    assert!(part_str(&unzip(&out).unwrap(), S1).unwrap().contains("<dimension ref=\"A1:F5\"/>"));
}

#[test]
fn 계산_순서_기록은_지우고_열_때_다시_계산() {
    let chain = r#"<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="C2" i="1"/></calcChain>"#;
    let rels = crate::sheet::tests::WB_RELS.replace("</Relationships>", r#"<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>"#);
    let ct = crate::sheet::tests::CT.replace("</Types>", r#"<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>"#);
    let src = book(&[("xl/calcChain.xml", chain), ("xl/_rels/workbook.xml.rels", &rels), ("[Content_Types].xml", &ct)]);
    let p = unzip(&apply(&src, &[ed("A2", Some(json!(1)), None)]).unwrap()).unwrap();
    assert!(!p.contains_key("xl/calcChain.xml"));
    assert!(!part_str(&p, "xl/_rels/workbook.xml.rels").unwrap().contains("calcChain"));
    assert!(!part_str(&p, "[Content_Types].xml").unwrap().contains("calcChain"));
    assert!(part_str(&p, "xl/workbook.xml").unwrap().contains("<calcPr calcId=\"191029\" fullCalcOnLoad=\"1\"/>"));
}

#[test]
fn calc_pr_없으면_sheets_뒤에_넣는다() {
    assert_eq!(full_calc("<workbook><sheets><sheet/></sheets></workbook>"), "<workbook><sheets><sheet/></sheets><calcPr fullCalcOnLoad=\"1\"/></workbook>");
    assert_eq!(full_calc("<calcPr calcId=\"1\" fullCalcOnLoad=\"0\"></calcPr>"), "<calcPr calcId=\"1\" fullCalcOnLoad=\"1\"></calcPr>");
}

#[test]
fn 고친_행은_spans_힌트를_뺀다() {
    let sheet = crate::sheet::tests::SHEET1.replace("<row r=\"2\">", "<row r=\"2\" spans=\"1:3\">").replace("<row r=\"3\">", "<row r=\"3\" spans=\"1:3\">");
    let p = unzip(&apply(&book(&[(S1, &sheet)]), &[ed("E2", Some(json!(1)), None)]).unwrap()).unwrap();
    let x = part_str(&p, S1).unwrap();
    assert!(x.contains("<row r=\"2\">") && x.contains("<row r=\"3\" spans=\"1:3\">"));
}

#[test]
fn 없는_시트_부품이면_실패() {
    let mut e = ed("A1", Some(json!(1)), None);
    e.part = "xl/worksheets/nope.xml".into();
    assert!(apply(&book(&[]), &[e]).unwrap_err().contains("nope"));
}

/// 실제 파일에 칸 하나 고쳐 저장(.shots 확인용): SHEET_EVAL=<xlsx> SHEET_OUT=<out.xlsx> cargo test sheet_patch_eval -- --ignored
#[test]
#[ignore]
fn sheet_patch_eval() {
    let src = std::fs::read(std::env::var("SHEET_EVAL").unwrap()).unwrap();
    let part = read_book(&src).unwrap().sheets[0].part.clone();
    let out = apply(&src, &[CellEdit { part, r: 3, c: 2, v: Some(json!(777)), f: None, s: None, style: None }]).unwrap();
    std::fs::write(std::env::var("SHEET_OUT").unwrap(), out).unwrap();
}

fn styled(a: &str, st: crate::sheet_style::Style) -> CellEdit {
    let mut e = ed(a, Some(json!(1)), None);
    e.style = Some(st);
    e
}

#[test]
fn 서식_바꾸기_새_서식은_덧붙이고_같은_서식은_원래_번호() {
    use crate::sheet_style::{styles, Font, Style};
    let src = book(&[("xl/styles.xml", crate::sheet::tests::STYLES)]);
    let before = styles(&unzip(&src).unwrap());
    let bold = Style { font: Some(Font { b: true, sz: Some(11.0), color: Some("#2F5597".into()), name: Some("맑은 고딕".into()), ..Default::default() }), fill: Some("#FFF2CC".into()), num_fmt: Some("0.0\"kg\"".into()), ..Default::default() };
    let out = apply(&src, &[styled("A2", bold.clone()), styled("B2", before.cell[1].clone()), styled("A3", bold.clone()), styled("B3", Style { num_fmt: Some("#,##0".into()), ..Default::default() })]).unwrap();
    let after = styles(&unzip(&out).unwrap());
    // 원래 서식 줄은 그대로, 새 서식 하나만 덧붙음(같은 서식 두 칸은 한 번호)
    assert_eq!(&after.cell[..4], &before.cell[..]);
    assert_eq!(after.cell.len(), 5);
    assert_eq!(after.cell[4], bold);
    assert_eq!(cell_of(&out, 0, "A2").unwrap().s, 4);
    assert_eq!(cell_of(&out, 0, "A3").unwrap().s, 4);
    assert_eq!(cell_of(&out, 0, "B2").unwrap().s, 1);
    assert_eq!(cell_of(&out, 0, "B3").unwrap().s, 3); // 내장 #,##0 은 이미 있던 3번
    let xml = String::from_utf8(unzip(&out).unwrap()["xl/styles.xml"].clone()).unwrap();
    assert!(xml.contains("<numFmts count=\"2\">") && xml.contains("<fonts count=\"3\">") && xml.contains("<cellXfs count=\"5\">"));
}

#[test]
fn 서식_묶음이_없던_파일에도_숫자_서식을_첫_칸에() {
    use crate::sheet_style::Style;
    let plain = r#"<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellXfs></styleSheet>"#;
    let out = apply(&book(&[("xl/styles.xml", plain)]), &[styled("A2", Style { num_fmt: Some("yyyy\"년\" m\"월\"".into()), ..Default::default() })]).unwrap();
    let xml = String::from_utf8(unzip(&out).unwrap()["xl/styles.xml"].clone()).unwrap();
    assert!(xml.contains("main\"><numFmts count=\"1\"><numFmt numFmtId=\"164\""));
    assert_eq!(crate::sheet_style::styles(&unzip(&out).unwrap()).cell[1].num_fmt.as_deref(), Some("yyyy\"년\" m\"월\""));
}

fn tmp_file(name: &str, bytes: &[u8]) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-sheet-{}-{name}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    let p = d.join("시험.xlsx");
    std::fs::write(&p, bytes).unwrap();
    p
}

#[test]
fn 저장은_도장이_같을_때만_쓰고_쓰기_전_원본을_남긴다() {
    let p = tmp_file("ok", &book(&[]));
    let stamp = crate::reader::stamp_of(&p).unwrap();
    let kept = std::cell::RefCell::new(Vec::new());
    let new_stamp = save(&p, &[crate::sheet_struct::Op::Cell(ed("A2", Some(json!(5)), None))], &stamp, |q| kept.borrow_mut().push(std::fs::read(q).unwrap())).unwrap();
    assert_ne!(new_stamp, stamp);
    assert_eq!(kept.borrow().len(), 1);
    assert_eq!(cell_of(&kept.borrow()[0], 0, "A2").unwrap().v, Some(json!(120.0))); // 남긴 건 고치기 전
    assert_eq!(cell_of(&std::fs::read(&p).unwrap(), 0, "A2").unwrap().v, Some(json!(5.0)));
    assert!(!p.with_extension("chammo-tmp").exists());
}

#[test]
fn 그새_밖에서_고쳤으면_안_쓰고_CHANGED_OUTSIDE() {
    let p = tmp_file("outside", &book(&[]));
    let old = crate::reader::stamp_of(&p).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(5));
    std::fs::write(&p, book(&[("xl/worksheets/s2.xml", crate::sheet::tests::SHEET2)])).unwrap(); // 참모가 고친 판
    let theirs = std::fs::read(&p).unwrap();
    let err = save(&p, &[crate::sheet_struct::Op::Cell(ed("A2", Some(json!(5)), None))], &old, |_| panic!("안 써야 하는데 남기려 함")).unwrap_err();
    assert_eq!(err, crate::reader::CHANGED_OUTSIDE);
    assert_eq!(std::fs::read(&p).unwrap(), theirs);
}

#[test]
fn 고친_결과가_깨지면_원본을_안_건드린다() {
    let p = tmp_file("broken", &book(&[]));
    let stamp = crate::reader::stamp_of(&p).unwrap();
    let before = std::fs::read(&p).unwrap();
    let mut e = ed("A2", Some(json!(1)), None);
    e.part = "xl/worksheets/없음.xml".into();
    assert!(save(&p, &[crate::sheet_struct::Op::Cell(e)], &stamp, |_| {}).is_err());
    assert_eq!(std::fs::read(&p).unwrap(), before);
}

#[test]
fn 계산_순서_기록_지우기는_닫는_태그가_따로인_연결도_그것만() {
    // 2026-10-21 리뷰: 첫 "/>" 까지 지워서 옆 연결(styles)까지 지웠고, 맨 끝이면 "/>" 가 없어 끝없이 돌았다
    let run = |rels: &'static str| {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut p: crate::sheet::Parts = Default::default();
            p.insert("xl/calcChain.xml".into(), b"<calcChain/>".to_vec());
            p.insert("xl/_rels/workbook.xml.rels".into(), rels.as_bytes().to_vec());
            drop_calc_chain(&mut p);
            let _ = tx.send(String::from_utf8(p["xl/_rels/workbook.xml.rels"].clone()).unwrap());
        });
        rx.recv_timeout(std::time::Duration::from_secs(5)).expect("끝나야 한다")
    };
    let mid = run(r#"<Relationships><Relationship Id="rId9" Type="t/calcChain" Target="calcChain.xml"></Relationship><Relationship Id="rId2" Type="t/styles" Target="styles.xml"/></Relationships>"#);
    assert_eq!(mid, r#"<Relationships><Relationship Id="rId2" Type="t/styles" Target="styles.xml"/></Relationships>"#);
    let last = run(r#"<Relationships><Relationship Id="rId2" Type="t/styles" Target="styles.xml"/><Relationship Id="rId9" Type="t/calcChain" Target="calcChain.xml"></Relationship></Relationships>"#);
    assert_eq!(last, r#"<Relationships><Relationship Id="rId2" Type="t/styles" Target="styles.xml"/></Relationships>"#);
    let selfc = run(r#"<Relationships><Relationship Id="rId9" Type="t/calcChain" Target="calcChain.xml"/><Relationship Id="rId2" Type="t/styles" Target="styles.xml"/></Relationships>"#);
    assert_eq!(selfc, r#"<Relationships><Relationship Id="rId2" Type="t/styles" Target="styles.xml"/></Relationships>"#);
}
