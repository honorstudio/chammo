//! 스페이스 엑셀 — 병합·병합 풀기·열 너비·행 높이 바꾸기. 시트 부품에서 그 줄만 고친다

use crate::sheet_patch::{join_rows, split_rows, Row};
use crate::sheet_xml::{edit_attr, fix_group};

/// 스키마상 mergeCells 뒤에 와야 하는 것들 — 이 중 처음 나오는 것 앞에 넣는다
const AFTER_MERGES: [&str; 16] = ["<phoneticPr", "<conditionalFormatting", "<dataValidations", "<hyperlinks", "<printOptions", "<pageMargins", "<pageSetup", "<headerFooter", "<rowBreaks", "<colBreaks", "<ignoredErrors", "<drawing", "<legacyDrawing", "<picture", "<tableParts", "<extLst"];

/// 접두어 없는 시트 모양(<worksheet>…<sheetData…</worksheet>)인가 — 일부 도구(.NET Open XML SDK)는 <x:worksheet><x:sheetData> 처럼 쓴다.
/// 그런 시트에서 자리 표시(<sheetData·</worksheet>)를 못 찾으면 요소를 루트 밖(문서 끝)에 붙여 엑셀이 '복구' 창을 띄웠다 — 고치지 않고 거절(split_rows 와 같게, 2026-10-21 리뷰 ⑦-14)
fn plain(xml: &str) -> Result<(), String> {
    if xml.contains("<sheetData") && xml.contains("</worksheet>") {
        Ok(())
    } else {
        Err("이 시트 모양(접두어 붙은 XML)은 아직 못 고쳐 / this sheet's XML form (prefixed) can't be edited yet".into())
    }
}

pub fn merge(xml: &str, rf: &str) -> Result<String, String> {
    plain(xml)?;
    let item = format!("<mergeCell ref=\"{rf}\"/>");
    let out = if let Some(i) = xml.find("</mergeCells>") {
        format!("{}{item}{}", &xml[..i], &xml[i..])
    } else {
        let at = AFTER_MERGES.iter().filter_map(|t| xml.find(t)).min().or_else(|| xml.rfind("</worksheet>")).unwrap_or(xml.len());
        format!("{}<mergeCells count=\"1\">{item}</mergeCells>{}", &xml[..at], &xml[at..])
    };
    Ok(fix_group(&out, "mergeCells", "mergeCell"))
}

pub fn unmerge(xml: &str, rf: &str) -> Result<String, String> {
    plain(xml)?;
    Ok(fix_group(&edit_attr(xml, "mergeCell", "ref", |v| (v != rf).then(|| v.to_string())), "mergeCells", "mergeCell"))
}

fn attr_of(tag: &str, k: &str) -> Option<String> {
    tag.split(&format!(" {k}=\"")).nth(1)?.split('"').next().map(String::from)
}

/// 태그 글에 속성 넣거나 바꾸기(<x …/> · <x …>) — 있으면 제자리에서 값만
fn set_attr(tag: &str, k: &str, v: &str) -> String {
    let key = format!(" {k}=\"");
    if let Some(i) = tag.find(&key) {
        let s = i + key.len();
        let e = tag[s..].find('"').map(|x| s + x).unwrap_or(s);
        return format!("{}{v}{}", &tag[..s], &tag[e..]);
    }
    let (body, end) = if tag.ends_with("/>") { (&tag[..tag.len() - 2], "/>") } else { (&tag[..tag.len() - 1], ">") };
    format!("{} {k}=\"{v}\"{end}", body.trim_end())
}

/// 열 at..at+n 의 너비(엑셀 글자 단위) — 겹치는 <col> 줄은 쪼개서 그 부분만 바꾼다. 1부터 쓰는 min·max
pub fn col_width(xml: &str, at: u32, n: u32, width: f64) -> Result<String, String> {
    plain(xml)?;
    let (a, b) = (at + 1, at + n);
    let w = format!("{}", (width * 100.0).round() / 100.0);
    let mut cols: Vec<(u32, u32, String)> = Vec::new();
    let (head, tail, body) = match (xml.find("<cols>"), xml.find("</cols>")) {
        (Some(i), Some(j)) => (xml[..i].to_string(), xml[j + 7..].to_string(), xml[i + 6..j].to_string()),
        _ => {
            let at = xml.find("<sheetData").unwrap_or(xml.len());
            (xml[..at].to_string(), xml[at..].to_string(), String::new())
        }
    };
    let mut rest = body.as_str();
    while let Some(i) = rest.find("<col ") {
        let j = rest[i..].find("/>").map(|k| i + k + 2).unwrap_or(rest.len());
        let tag = &rest[i..j];
        if let (Some(lo), Some(hi)) = (attr_of(tag, "min").and_then(|v| v.parse().ok()), attr_of(tag, "max").and_then(|v| v.parse().ok())) { cols.push((lo, hi, tag.to_string())); }
        rest = &rest[j..];
    }
    let with = |tag: &str, lo: u32, hi: u32| set_attr(&set_attr(&set_attr(&set_attr(tag, "min", &lo.to_string()), "max", &hi.to_string()), "width", &w), "customWidth", "1");
    let keep = |tag: &str, lo: u32, hi: u32| set_attr(&set_attr(tag, "min", &lo.to_string()), "max", &hi.to_string());
    let mut out: Vec<(u32, String)> = Vec::new();
    for (lo, hi, tag) in &cols {
        if *hi < a || *lo > b { out.push((*lo, tag.clone())); continue; }
        if *lo < a { out.push((*lo, keep(tag, *lo, a - 1))); }
        out.push((a.max(*lo), with(tag, a.max(*lo), b.min(*hi))));
        if *hi > b { out.push((b + 1, keep(tag, b + 1, *hi))); }
    }
    // 어떤 줄에도 안 걸린 열
    let mut c = a;
    while c <= b {
        if let Some((_, hi, _)) = cols.iter().find(|(lo, hi, _)| *lo <= c && c <= *hi) { c = hi + 1; continue; }
        let end = cols.iter().filter(|(lo, _, _)| *lo > c).map(|(lo, _, _)| lo - 1).min().unwrap_or(b).min(b);
        out.push((c, format!("<col min=\"{c}\" max=\"{end}\" width=\"{w}\" customWidth=\"1\"/>")));
        c = end + 1;
    }
    out.sort_by_key(|x| x.0);
    Ok(format!("{head}<cols>{}</cols>{tail}", out.into_iter().map(|x| x.1).collect::<String>()))
}

/// 행 at..at+n 의 높이(pt) — 없는 행은 빈 행으로 만든다
pub fn row_height(xml: &str, at: u32, n: u32, pt: f64) -> Result<String, String> {
    let (head, mut rows, tail) = split_rows(xml)?;
    let h = format!("{}", (pt * 100.0).round() / 100.0);
    for r in at..at + n {
        match rows.binary_search_by_key(&r, |x| x.r) {
            Ok(i) => { let row = &mut rows[i]; row.open = set_attr(&set_attr(&row.open, "ht", &h), "customHeight", "1"); }
            Err(i) => rows.insert(i, Row { r, open: format!("<row r=\"{}\" ht=\"{h}\" customHeight=\"1\"/>", r + 1), empty: true, cells: Default::default(), touched: true }),
        }
    }
    Ok(join_rows(&head, &rows, &tail))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 병합은_자리를_지켜_넣고_풀면_빈_묶음째_뺀다() {
        let x = "<worksheet><sheetData/><conditionalFormatting sqref=\"A1\"/><pageMargins/></worksheet>";
        let m = merge(x, "A1:C1").unwrap();
        assert_eq!(m, "<worksheet><sheetData/><mergeCells count=\"1\"><mergeCell ref=\"A1:C1\"/></mergeCells><conditionalFormatting sqref=\"A1\"/><pageMargins/></worksheet>");
        let m2 = merge(&m, "B3:B4").unwrap();
        assert!(m2.contains("<mergeCells count=\"2\">"));
        assert_eq!(unmerge(&unmerge(&m2, "A1:C1").unwrap(), "B3:B4").unwrap(), x);
    }

    #[test]
    fn 열_너비는_겹친_줄을_쪼개서_그_열만() {
        let x = "<worksheet><cols><col min=\"1\" max=\"5\" width=\"9\" style=\"3\"/></cols><sheetData/></worksheet>";
        // C·D(0부터 2, 2칸)를 20 으로
        assert_eq!(col_width(x, 2, 2, 20.0).unwrap(), "<worksheet><cols><col min=\"1\" max=\"2\" width=\"9\" style=\"3\"/><col min=\"3\" max=\"4\" width=\"20\" style=\"3\" customWidth=\"1\"/><col min=\"5\" max=\"5\" width=\"9\" style=\"3\"/></cols><sheetData/></worksheet>");
        // cols 가 없으면 sheetData 앞에 새로
        assert_eq!(col_width("<worksheet><sheetData/></worksheet>", 0, 1, 12.5).unwrap(), "<worksheet><cols><col min=\"1\" max=\"1\" width=\"12.5\" customWidth=\"1\"/></cols><sheetData/></worksheet>");
    }

    #[test]
    fn 접두어_붙은_시트는_고치지_않고_거절한다() {
        // 열 너비·병합만 바꾸면 <cols>·<mergeCells> 를 루트 </x:worksheet> 뒤에 붙여 깨진 xlsx 를 썼다(2026-10-21 리뷰 ⑦-14)
        let x = "<x:worksheet xmlns:x=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><x:sheetData/></x:worksheet>";
        assert!(col_width(x, 0, 1, 12.0).is_err());
        assert!(merge(x, "A1:B1").is_err());
        assert!(unmerge(x, "A1:B1").is_err());
    }

    #[test]
    fn 행_높이는_있는_행은_속성만_없는_행은_빈_행() {
        let x = "<worksheet><sheetData><row r=\"2\" spans=\"1:2\"><c r=\"A2\"><v>1</v></c></row></sheetData></worksheet>";
        let y = row_height(x, 0, 2, 30.0).unwrap();
        assert_eq!(y, "<worksheet><sheetData><row r=\"1\" ht=\"30\" customHeight=\"1\"/><row r=\"2\" spans=\"1:2\" ht=\"30\" customHeight=\"1\"><c r=\"A2\"><v>1</v></c></row></sheetData></worksheet>");
    }
}
