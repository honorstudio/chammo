//! 스페이스 엑셀 — 부품 XML 을 '고칠 곳만' 바꾸는 도구. 나머지 글자는 한 글자도 안 바꾼다(원본 그대로 원칙)

use quick_xml::events::Event;
use quick_xml::reader::Reader;

use crate::sheet_patch::{esc, unesc};

/// 태그 글 안 속성 값(원문 그대로, 따옴표 안) 자리
fn attr_span(tag: &str, key: &str) -> Option<(usize, usize)> {
    for q in ['"', '\''] {
        let pat = format!(" {key}={q}");
        if let Some(i) = tag.find(&pat) {
            let s = i + pat.len();
            let e = s + tag[s..].find(q)?;
            return Some((s, e));
        }
    }
    None
}

fn splice(xml: &str, mut edits: Vec<(usize, usize, String)>) -> String {
    edits.sort_by_key(|e| e.0);
    let mut out = String::with_capacity(xml.len());
    let mut at = 0;
    for (s, e, rep) in edits {
        if s < at { continue; } // 지운 요소 안의 고침은 버린다
        out.push_str(&xml[at..s]);
        out.push_str(&rep);
        at = e;
    }
    out.push_str(&xml[at..]);
    out
}

/// 이름이 tag 인 요소마다 속성 key 를 f 로 — f 가 None 이면 그 요소를 자식까지 지운다. 속성이 없는 요소는 그대로
pub fn edit_attr(xml: &str, tag: &str, key: &str, f: impl Fn(&str) -> Option<String>) -> String {
    let mut r = Reader::from_str(xml);
    let mut edits = Vec::new();
    let mut dropping: Option<(usize, usize)> = None; // 지우는 요소 시작, 깊이
    let mut depth = 0usize;
    loop {
        let p0 = r.buffer_position() as usize;
        let Ok(ev) = r.read_event() else { break };
        let p1 = r.buffer_position() as usize;
        match &ev {
            Event::Start(e) | Event::Empty(e) => {
                let empty = matches!(ev, Event::Empty(_));
                if !empty { depth += 1; }
                if dropping.is_some() || e.local_name().as_ref() != tag { continue; }
                let raw = &xml[p0..p1];
                let Some((s, t)) = attr_span(raw, key) else { continue };
                match f(&unesc(&raw[s..t])) {
                    Some(v) => edits.push((p0 + s, p0 + t, esc(&v))),
                    None if empty => edits.push((p0, p1, String::new())),
                    None => dropping = Some((p0, depth)),
                }
            }
            Event::End(_) => {
                if let Some((s, d)) = dropping { if d == depth { edits.push((s, p1, String::new())); dropping = None; } }
                depth = depth.saturating_sub(1);
            }
            Event::Eof => break,
            _ => {}
        }
    }
    splice(xml, edits)
}

/// 이름이 tag 인 요소의 글(자식 없는 것)을 f 로 — <formula>…</formula>, <c:f>…</c:f>, <xdr:row>3</xdr:row>
pub fn edit_text(xml: &str, tag: &str, f: impl Fn(&str) -> String) -> String {
    let mut r = Reader::from_str(xml);
    let mut edits = Vec::new();
    let mut open: Option<usize> = None;
    loop {
        let p0 = r.buffer_position() as usize;
        let Ok(ev) = r.read_event() else { break };
        let p1 = r.buffer_position() as usize;
        match &ev {
            Event::Start(e) if e.local_name().as_ref() == tag => open = Some(p1),
            Event::Start(_) => open = None,
            Event::End(e) if e.local_name().as_ref() == tag => if let Some(s) = open.take() {
                let old = unesc(&xml[s..p0]);
                let new = f(&old);
                if new != old { edits.push((s, p0, esc(&new))); }
            },
            Event::Eof => break,
            _ => {}
        }
    }
    splice(xml, edits)
}

/// 빈 묶음 지우기 + count 맞추기 — <mergeCells count="2"> 안 자식이 다 지워지면 묶음째(스키마상 비면 안 된다)
pub fn fix_group(xml: &str, group: &str, item: &str) -> String {
    let Some(i) = xml.find(&format!("<{group}")) else { return xml.to_string() };
    let Some(head_end) = xml[i..].find('>').map(|k| i + k + 1) else { return xml.to_string() };
    if xml[..head_end].ends_with("/>") { return format!("{}{}", &xml[..i], &xml[head_end..]); }
    let close = format!("</{group}>");
    let Some(end) = xml[head_end..].find(&close).map(|k| head_end + k) else { return xml.to_string() };
    let body = &xml[head_end..end];
    let n = body.matches(&format!("<{item} ")).count() + body.matches(&format!("<{item}>")).count();
    if n == 0 { return format!("{}{}", &xml[..i], &xml[end + close.len()..]); }
    let head = &xml[i..head_end];
    let new_head = match attr_span(head, "count") { Some((s, e)) => format!("{}{n}{}", &head[..s], &head[e..]), None => head.to_string() };
    format!("{}{new_head}{}", &xml[..i], &xml[head_end..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 속성만_바꾸고_나머지_글자는_그대로() {
        let x = r#"<a><m ref="A1:B2"/><m  x="1" ref="C3"/><n ref="Z9"/></a>"#;
        assert_eq!(edit_attr(x, "m", "ref", |v| Some(format!("{v}!"))), r#"<a><m ref="A1:B2!"/><m  x="1" ref="C3!"/><n ref="Z9"/></a>"#);
    }

    #[test]
    fn none_이면_요소를_자식까지_지운다() {
        let x = r#"<w><cf sqref="A1"><r><formula>1</formula></r></cf><cf sqref="B2"><r/></cf></w>"#;
        assert_eq!(edit_attr(x, "cf", "sqref", |v| (v != "A1").then(|| v.to_string())), r#"<w><cf sqref="B2"><r/></cf></w>"#);
    }

    #[test]
    fn 글_고치기는_이스케이프를_풀고_다시_싼다() {
        let x = "<x><formula>A1&lt;3</formula><c:f>s!$A$1</c:f></x>";
        assert_eq!(edit_text(x, "formula", |t| t.replace("A1", "A2")), "<x><formula>A2&lt;3</formula><c:f>s!$A$1</c:f></x>");
        assert_eq!(edit_text(x, "f", |t| t.replace("$A$1", "$A$2")), "<x><formula>A1&lt;3</formula><c:f>s!$A$2</c:f></x>");
    }

    #[test]
    fn 빈_묶음은_지우고_count_는_실제_수로() {
        assert_eq!(fix_group(r#"<w><mergeCells count="2"><mergeCell ref="A1"/></mergeCells></w>"#, "mergeCells", "mergeCell"), r#"<w><mergeCells count="1"><mergeCell ref="A1"/></mergeCells></w>"#);
        assert_eq!(fix_group(r#"<w><mergeCells count="2"></mergeCells><x/></w>"#, "mergeCells", "mergeCell"), "<w><x/></w>");
    }
}
