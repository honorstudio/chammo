// 행·열 끼우기/지우기 시험 — 바꾼 시트와 그 시트를 가리키는 곳이 다 같이 밀리는지(지어낸 값만)
use super::*;
use crate::sheet::tests::{book, layout_book, WB};
use crate::sheet::unzip;
use crate::sheet_book::read_book;
use crate::sheet_patch::CellEdit;
use serde_json::json;

const S1: &str = "xl/worksheets/sheet1.xml";

fn rows(op: &str, at: u32, n: u32) -> Op {
    let part = S1.to_string();
    match op { "ir" => Op::InsertRows { part, at, n }, "dr" => Op::DeleteRows { part, at, n }, "ic" => Op::InsertCols { part, at, n }, _ => Op::DeleteCols { part, at, n } }
}

fn f_at(bytes: &[u8], sheet: usize, a: &str) -> Option<String> {
    let (r, c) = parse_a1(a).unwrap();
    read_book(bytes).unwrap().sheets[sheet].cells.iter().find(|x| x.r == r && x.c == c).and_then(|x| x.f.clone())
}

fn v_at(bytes: &[u8], sheet: usize, a: &str) -> Option<serde_json::Value> {
    let (r, c) = parse_a1(a).unwrap();
    read_book(bytes).unwrap().sheets[sheet].cells.iter().find(|x| x.r == r && x.c == c).and_then(|x| x.v.clone())
}

fn part(bytes: &[u8], name: &str) -> String {
    String::from_utf8(unzip(bytes).unwrap()[name].clone()).unwrap()
}

#[test]
fn 행_끼우기_칸과_수식과_다른_시트_참조가_같이_밀린다() {
    // 2행 앞(0부터 1)에 한 행
    let out = apply_ops(&book(&[]), &[rows("ir", 1, 1)]).unwrap();
    assert_eq!(v_at(&out, 0, "A1"), Some(json!("품목")));
    assert_eq!(v_at(&out, 0, "A3"), Some(json!(120.0)));
    assert_eq!(f_at(&out, 0, "C3").as_deref(), Some("A3*B3"));
    // 공유 수식 묶음도 펼쳐서 제자리
    assert_eq!(f_at(&out, 0, "C4").as_deref(), Some("A4*B4"));
    assert_eq!(f_at(&out, 0, "C5").as_deref(), Some("A5*B5"));
    assert_eq!(f_at(&out, 1, "A1").as_deref(), Some("매출!C3&\"원\""));
    assert!(part(&out, S1).contains("<mergeCell ref=\"A1:B1\"/>"));
}

#[test]
fn 행_지우기_지운_칸을_가리키던_다른_시트는_REF() {
    let out = apply_ops(&book(&[]), &[rows("dr", 1, 1)]).unwrap();
    assert_eq!(v_at(&out, 0, "A2"), Some(json!(80.0)));
    assert_eq!(f_at(&out, 0, "C2").as_deref(), Some("A2*B2"));
    assert_eq!(f_at(&out, 1, "A1").as_deref(), Some("매출!#REF!&\"원\""));
}

#[test]
fn 행_끼우기_병합_조건부_서식_입력_목록_고정틀() {
    let out = apply_ops(&layout_book(), &[rows("ir", 0, 2)]).unwrap();
    let x = part(&out, S1);
    for want in ["<mergeCell ref=\"A3:E3\"/>", "<mergeCell ref=\"B7:C8\"/>", "sqref=\"B4:E15\"", "<formula>B4&lt;AVERAGE(B$4:B$15)*0.8</formula>", "sqref=\"B5:B10\"", "topLeftCell=\"B5\""] {
        assert!(x.contains(want), "{want} 없음:\n{x}");
    }
    // 높이 준 1행은 3행으로
    let b = read_book(&out).unwrap();
    assert_eq!(b.sheets[0].layout.rows.first().map(|r| (r.r, r.ht)), Some((2, Some(28.0))));
}

#[test]
fn 열_지우기_병합은_줄고_열_너비_줄도_당겨진다() {
    let out = apply_ops(&layout_book(), &[rows("dc", 1, 1)]).unwrap();
    let x = part(&out, S1);
    for want in ["<mergeCell ref=\"A1:D1\"/>", "<mergeCell ref=\"B5:B6\"/>", "sqref=\"B2:D13\"", "<col min=\"1\" max=\"1\"", "<col min=\"2\" max=\"3\""] {
        assert!(x.contains(want), "{want} 없음:\n{x}");
    }
    // 입력 목록이 걸린 B 열을 지웠으니 그 규칙은 빠진다
    assert!(!x.contains("<dataValidations"));
}

#[test]
fn 조작_순서대로_칸_주소는_앞_조작이_끝난_뒤_자리() {
    let e = |a: &str, v: i64| { let (r, c) = parse_a1(a).unwrap(); Op::Cell(CellEdit { part: S1.into(), r, c, v: Some(json!(v)), f: None, s: None, style: None }) };
    let out = apply_ops(&book(&[]), &[e("A2", 7), rows("ir", 0, 1), e("A1", 9)]).unwrap();
    assert_eq!(v_at(&out, 0, "A1"), Some(json!(9.0)));
    assert_eq!(v_at(&out, 0, "A3"), Some(json!(7.0)));
    assert_eq!(v_at(&out, 0, "A2"), Some(json!("품목")));
}

#[test]
fn 차트_범위_정의된_이름_그림_자리_메모도_밀린다() {
    let wb = WB.replace("<calcPr", "<definedNames><definedName name=\"합계칸\">'매출'!$C$2:$C$4</definedName></definedNames><calcPr");
    let sheet_rels = r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/></Relationships>"#;
    let drawing = r#"<xdr:wsDr xmlns:xdr="x"><xdr:twoCellAnchor><xdr:from><xdr:col>6</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>9</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>15</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to></xdr:twoCellAnchor></xdr:wsDr>"#;
    let chart = r#"<c:chartSpace xmlns:c="c"><c:ser><c:val><c:numRef><c:f>매출!$C$2:$C$4</c:f></c:numRef></c:val></c:ser></c:chartSpace>"#;
    let comments = r#"<comments><authors><author>a</author></authors><commentList><comment ref="B3" authorId="0"><text><t>메모</t></text></comment></commentList></comments>"#;
    let vml = r#"<xml><v:shape id="s1"><x:ClientData ObjectType="Note"><x:Anchor>2, 15, 1, 10, 4, 15, 5, 4</x:Anchor><x:Row>2</x:Row><x:Column>1</x:Column></x:ClientData></v:shape></xml>"#;
    let src = book(&[("xl/workbook.xml", &wb), ("xl/worksheets/_rels/sheet1.xml.rels", sheet_rels), ("xl/drawings/drawing1.xml", drawing), ("xl/charts/chart1.xml", chart), ("xl/comments1.xml", comments), ("xl/drawings/vmlDrawing1.vml", vml)]);
    let out = apply_ops(&src, &[rows("ir", 0, 1)]).unwrap();
    assert!(part(&out, "xl/charts/chart1.xml").contains("<c:f>매출!$C$3:$C$5</c:f>"));
    assert!(part(&out, "xl/workbook.xml").contains(">매출!$C$3:$C$5</definedName>"));
    let d = part(&out, "xl/drawings/drawing1.xml");
    assert!(d.contains("<xdr:row>2</xdr:row>") && d.contains("<xdr:row>16</xdr:row>") && d.contains("<xdr:col>6</xdr:col>"));
    assert!(part(&out, "xl/comments1.xml").contains("ref=\"B4\""));
    let v = part(&out, "xl/drawings/vmlDrawing1.vml");
    assert!(v.contains("<x:Row>3</x:Row>") && v.contains("<x:Anchor>2, 15, 2, 10, 4, 15, 6, 4</x:Anchor>"), "{v}");
    // 메모 줄을 지우면 메모와 상자가 같이 빠진다
    let gone = apply_ops(&src, &[rows("dr", 2, 1)]).unwrap();
    assert!(!part(&gone, "xl/comments1.xml").contains("<comment "));
    assert!(!part(&gone, "xl/drawings/vmlDrawing1.vml").contains("<v:shape"));
}

#[test]
fn 표_안에_열_끼우기는_알아듣게_거절() {
    let rels = r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/></Relationships>"#;
    let table = r#"<table id="1" name="표1" ref="A1:C5"><autoFilter ref="A1:C5"/></table>"#;
    let src = book(&[("xl/worksheets/_rels/sheet1.xml.rels", rels), ("xl/tables/table1.xml", table)]);
    assert!(apply_ops(&src, &[rows("ic", 1, 1)]).unwrap_err().contains("표"));
    // 표 오른쪽 밖은 된다, 행 끼우기는 표 범위를 늘린다
    assert!(apply_ops(&src, &[rows("ic", 5, 1)]).is_ok());
    let out = apply_ops(&src, &[rows("ir", 2, 1)]).unwrap();
    assert!(part(&out, "xl/tables/table1.xml").contains("ref=\"A1:C6\""));
}

/// 실제 파일 첫 시트 4행 앞에 한 행 끼워 저장(.shots 확인용): SHEET_EVAL=<xlsx> SHEET_OUT=<out> cargo test sheet_struct_eval -- --ignored
#[test]
#[ignore]
fn sheet_struct_eval() {
    let src = std::fs::read(std::env::var("SHEET_EVAL").unwrap()).unwrap();
    let part = read_book(&src).unwrap().sheets[0].part.clone();
    let out = apply_ops(&src, &[Op::InsertRows { part, at: 3, n: 1 }]).unwrap();
    std::fs::write(std::env::var("SHEET_OUT").unwrap(), out).unwrap();
}

/// 화면(하네스)이 보낸 조작 목록을 실제 파일에 적용(.shots 확인용): SHEET_EVAL=<xlsx> SHEET_OPS=<ops.json> SHEET_OUT=<out> cargo test sheet_ops_eval -- --ignored
#[test]
#[ignore]
fn sheet_ops_eval() {
    let src = std::fs::read(std::env::var("SHEET_EVAL").unwrap()).unwrap();
    let ops: Vec<Op> = serde_json::from_slice(&std::fs::read(std::env::var("SHEET_OPS").unwrap()).unwrap()).unwrap();
    let out = apply_ops(&src, &ops).unwrap();
    read_book(&out).unwrap();
    std::fs::write(std::env::var("SHEET_OUT").unwrap(), out).unwrap();
}
