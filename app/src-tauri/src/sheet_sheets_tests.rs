// 시트 추가·이름 바꾸기·지우기 시험(지어낸 값만)
use super::*;
use crate::sheet::tests::{book, WB};
use crate::sheet::unzip;
use crate::sheet_book::read_book;
use crate::sheet_patch::CellEdit;
use crate::sheet_struct::{apply_ops, Op};
use serde_json::json;

fn cell(sheet: &str, r: u32, c: u32, v: serde_json::Value) -> Op { Op::Cell(CellEdit { part: sheet.into(), r, c, v: Some(v), f: None, s: None, style: None }) }
fn part(bytes: &[u8], name: &str) -> String { String::from_utf8(unzip(bytes).unwrap()[name].clone()).unwrap() }

#[test]
fn 새_시트는_맨_뒤에_빈_시트로_이름으로_바로_칸을_쓴다() {
    let out = apply_ops(&book(&[]), &[Op::AddSheet { name: "메모 2".into() }, cell("메모 2", 0, 0, json!("첫 칸"))]).unwrap();
    let b = read_book(&out).unwrap();
    assert_eq!(b.sheets.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), vec!["매출", "요약 & 메모", "메모 2"]);
    assert_eq!(b.sheets[2].part, "xl/worksheets/sheet2.xml");
    assert_eq!(b.sheets[2].cells[0].v, Some(json!("첫 칸")));
    assert!(part(&out, "[Content_Types].xml").contains("PartName=\"/xl/worksheets/sheet2.xml\""));
    assert!(part(&out, "xl/workbook.xml").contains("<sheet name=\"메모 2\" sheetId=\"3\" r:id=\"rId4\"/>"));
}

#[test]
fn 시트_이름_규칙() {
    let p = unzip(&book(&[])).unwrap();
    assert!(check_name(&p, "매출", None).unwrap_err().contains("이미"));
    assert!(check_name(&p, "a/b", None).is_err());
    assert!(check_name(&p, &"가".repeat(32), None).is_err());
    assert!(check_name(&p, "매출", Some("xl/worksheets/sheet1.xml")).is_ok());
}

#[test]
fn 이름_바꾸면_다른_시트_수식과_정의된_이름이_따라온다() {
    let wb = WB.replace("<calcPr", "<definedNames><definedName name=\"칸\">매출!$A$1</definedName></definedNames><calcPr");
    let out = apply_ops(&book(&[("xl/workbook.xml", &wb)]), &[Op::RenameSheet { part: "매출".into(), name: "1월 매출".into() }]).unwrap();
    let b = read_book(&out).unwrap();
    assert_eq!(b.sheets[0].name, "1월 매출");
    assert_eq!(b.sheets[1].cells[0].f.as_deref(), Some("'1월 매출'!C2&\"원\""));
    assert!(part(&out, "xl/workbook.xml").contains(">'1월 매출'!$A$1</definedName>"));
}

#[test]
fn 지우면_가리키던_수식은_REF_그_시트_이름은_빠지고_번호가_당겨진다() {
    let wb = WB.replace(" state=\"hidden\"", "").replace("<calcPr", "<bookViews><workbookView activeTab=\"1\"/></bookViews><definedNames><definedName name=\"a\" localSheetId=\"0\">매출!$A$1</definedName><definedName name=\"b\" localSheetId=\"1\">$A$1</definedName></definedNames><calcPr");
    let out = apply_ops(&book(&[("xl/workbook.xml", &wb)]), &[Op::DeleteSheet { part: "xl/worksheets/sheet1.xml".into() }]).unwrap();
    let b = read_book(&out).unwrap();
    assert_eq!(b.sheets.len(), 1);
    assert_eq!(b.sheets[0].cells[0].f.as_deref(), Some("#REF!&\"원\""));
    let w = part(&out, "xl/workbook.xml");
    assert!(!w.contains("name=\"a\"") && w.contains("name=\"b\" localSheetId=\"0\"") && w.contains("activeTab=\"0\""));
    let p = unzip(&out).unwrap();
    assert!(!p.contains_key("xl/worksheets/sheet1.xml"));
    assert!(!part(&out, "xl/_rels/workbook.xml.rels").contains("worksheets/sheet1.xml"));
}

#[test]
fn 보이는_마지막_시트는_못_지운다() {
    // 요약 시트는 숨김이라 매출이 마지막 보이는 시트
    assert!(apply_ops(&book(&[]), &[Op::DeleteSheet { part: "매출".into() }]).unwrap_err().contains("하나는"));
}

#[test]
fn 화면이_보내는_json_조작_목록() {
    let ops: Vec<Op> = serde_json::from_str(r#"[{"op":"cell","part":"매출","r":1,"c":0,"v":5},{"op":"insertRows","part":"매출","at":0,"n":1},{"op":"addSheet","name":"새 시트"},{"op":"renameSheet","part":"새 시트","name":"정리"}]"#).unwrap();
    let out = apply_ops(&book(&[]), &ops).unwrap();
    let b = read_book(&out).unwrap();
    assert_eq!(b.sheets[2].name, "정리");
    assert_eq!(b.sheets[0].cells.iter().find(|c| c.r == 2 && c.c == 0).and_then(|c| c.v.clone()), Some(json!(5.0)));
}

#[test]
fn 병합_너비_높이_조작_목록() {
    let ops: Vec<Op> = serde_json::from_str(r#"[{"op":"merge","part":"매출","range":"C1:D1"},{"op":"colWidth","part":"매출","at":0,"n":1,"width":20},{"op":"rowHeight","part":"매출","at":0,"n":1,"height":30},{"op":"unmerge","part":"매출","range":"A1:B1"}]"#).unwrap();
    let b = read_book(&apply_ops(&book(&[]), &ops).unwrap()).unwrap();
    let l = &b.sheets[0].layout;
    assert_eq!(l.merges, vec!["C1:D1"]);
    assert_eq!((l.cols[0].min, l.cols[0].width), (0, Some(20.0)));
    assert_eq!(l.rows[0].ht, Some(30.0));
}
