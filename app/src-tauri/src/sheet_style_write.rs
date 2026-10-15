//! 스페이스 엑셀 저장 — 칸 서식을 바꿨을 때 styles.xml 에 서식을 덧붙이고 그 번호를 준다.
//! 원래 있던 서식과 똑같으면 그 번호를 다시 쓰고, 원래 서식 줄은 건드리지 않는다(덧붙이기만)

use std::collections::HashMap;

use crate::sheet::{part_str, Parts};
use crate::sheet_patch::esc;
use crate::sheet_style::{builtin_fmt, styles, Align, Border, Edge, Font, Style};

pub struct StyleBook {
    xml: String,
    known: Vec<Style>,
    base: Font,
    fmts: HashMap<String, u32>,
    next_fmt: u32,
    count: HashMap<&'static str, usize>,
    changed: bool,
}

/// 그 칸 묶음(fonts·fills·borders·cellXfs·numFmts) 안 항목 수
fn count_in(xml: &str, section: &str, item: &str) -> usize {
    let Some(i) = xml.find(&format!("<{section}")) else { return 0 };
    let head_end = xml[i..].find('>').map(|k| i + k).unwrap_or(i);
    if xml[..=head_end].ends_with("/>") { return 0; }
    let end = xml[i..].find(&format!("</{section}>")).map(|k| i + k).unwrap_or(xml.len());
    let body = &xml[head_end..end];
    body.matches(&format!("<{item}>")).count() + body.matches(&format!("<{item} ")).count() + body.matches(&format!("<{item}/>")).count()
}

fn argb(c: &str) -> String {
    format!("FF{}", c.trim_start_matches('#').to_ascii_uppercase())
}

fn font_xml(f: &Font) -> String {
    let mut s = String::from("<font>");
    if f.b { s.push_str("<b/>"); }
    if f.i { s.push_str("<i/>"); }
    if f.strike { s.push_str("<strike/>"); }
    if f.u { s.push_str("<u/>"); }
    if let Some(sz) = f.sz { s.push_str(&format!("<sz val=\"{sz}\"/>")); }
    if let Some(c) = &f.color { s.push_str(&format!("<color rgb=\"{}\"/>", argb(c))); }
    if let Some(n) = &f.name { s.push_str(&format!("<name val=\"{}\"/>", esc(n))); }
    s.push_str("</font>");
    s
}

fn edge_xml(tag: &str, e: &Option<Edge>) -> String {
    match e {
        Some(e) => match &e.color {
            Some(c) => format!("<{tag} style=\"{}\"><color rgb=\"{}\"/></{tag}>", esc(&e.style), argb(c)),
            None => format!("<{tag} style=\"{}\"/>", esc(&e.style)),
        },
        None => format!("<{tag}/>"),
    }
}

fn border_xml(b: &Border) -> String {
    format!("<border>{}{}{}{}<diagonal/></border>", edge_xml("left", &b.l), edge_xml("right", &b.r), edge_xml("top", &b.t), edge_xml("bottom", &b.b))
}

fn align_xml(a: &Align) -> String {
    let mut s = String::from("<alignment");
    if let Some(h) = &a.h { s.push_str(&format!(" horizontal=\"{}\"", esc(h))); }
    if let Some(v) = &a.v { s.push_str(&format!(" vertical=\"{}\"", esc(v))); }
    if a.wrap { s.push_str(" wrapText=\"1\""); }
    s.push_str("/>");
    s
}

impl StyleBook {
    pub fn new(parts: &Parts) -> Option<StyleBook> {
        let xml = part_str(parts, "xl/styles.xml")?.to_string();
        let st = styles(parts);
        let mut fmts = HashMap::new();
        let mut next_fmt = 164;
        let mut rest = xml.as_str();
        while let Some(i) = rest.find("<numFmt ") {
            let tag = &rest[i..i + rest[i..].find('>').unwrap_or(0)];
            let get = |k: &str| tag.split(&format!("{k}=\"")).nth(1).and_then(|x| x.split('"').next());
            if let (Some(id), Some(code)) = (get("numFmtId").and_then(|v| v.parse::<u32>().ok()), get("formatCode")) {
                fmts.insert(code.replace("&quot;", "\"").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">"), id);
                next_fmt = next_fmt.max(id + 1);
            }
            rest = &rest[i + 8..];
        }
        let count = [("fonts", "font"), ("fills", "fill"), ("borders", "border"), ("cellXfs", "xf")].iter()
            .map(|(sec, item)| (*sec, count_in(&xml, sec, item))).collect();
        Some(StyleBook { known: st.cell, base: st.font, fmts, next_fmt, count, changed: false, xml })
    }

    /// 이 서식의 번호 — 이미 있으면 그 번호, 없으면 덧붙인다
    pub fn index_of(&mut self, want: &Style) -> u32 {
        if let Some(i) = self.known.iter().position(|k| k == want) { return i as u32; }
        let nf = match &want.num_fmt {
            None => 0,
            Some(code) => (1..50).find(|id| builtin_fmt(*id) == Some(code.as_str())).unwrap_or_else(|| self.fmt_id(code)),
        };
        let font = match &want.font { Some(f) if *f != self.base => self.append("fonts", &font_xml(f)), _ => 0 };
        let fill = match &want.fill {
            Some(c) => self.append("fills", &format!("<fill><patternFill patternType=\"solid\"><fgColor rgb=\"{}\"/><bgColor indexed=\"64\"/></patternFill></fill>", argb(c))),
            None => 0,
        };
        let border = match &want.border { Some(b) if *b != Border::default() => self.append("borders", &border_xml(b)), _ => 0 };
        let align = want.align.as_ref().filter(|a| **a != Align::default());
        let xf = format!(
            "<xf numFmtId=\"{nf}\" fontId=\"{font}\" fillId=\"{fill}\" borderId=\"{border}\" xfId=\"0\"{}{}{}{}{}",
            if nf != 0 { " applyNumberFormat=\"1\"" } else { "" }, if font != 0 { " applyFont=\"1\"" } else { "" },
            if fill != 0 { " applyFill=\"1\"" } else { "" }, if border != 0 { " applyBorder=\"1\"" } else { "" },
            match align { Some(a) => format!(" applyAlignment=\"1\">{}</xf>", align_xml(a)), None => "/>".into() },
        );
        let i = self.append("cellXfs", &xf);
        self.known.push(want.clone());
        i as u32
    }

    fn fmt_id(&mut self, code: &str) -> u32 {
        if let Some(id) = self.fmts.get(code) { return *id; }
        let id = self.next_fmt;
        self.next_fmt += 1;
        self.fmts.insert(code.to_string(), id);
        let item = format!("<numFmt numFmtId=\"{id}\" formatCode=\"{}\"/>", esc(code));
        if self.xml.contains("</numFmts>") {
            self.xml = self.xml.replacen("</numFmts>", &format!("{item}</numFmts>"), 1);
            self.bump("numFmts");
        } else {
            // numFmts 는 styleSheet 의 첫 칸이어야 한다
            let at = self.xml.find("<styleSheet").and_then(|i| self.xml[i..].find('>').map(|k| i + k + 1)).unwrap_or(0);
            let empty = self.xml.find("<numFmts").map(|i| (i, i + self.xml[i..].find("/>").map(|k| k + 2).unwrap_or(0)));
            if let Some((i, j)) = empty { self.xml.replace_range(i..j, ""); }
            self.xml.insert_str(at, &format!("<numFmts count=\"1\">{item}</numFmts>"));
        }
        self.changed = true;
        id
    }

    /// 그 칸 묶음 끝에 덧붙이고 새 번호를 준다
    fn append(&mut self, section: &'static str, item: &str) -> usize {
        let n = self.count.get(section).copied().unwrap_or(0);
        self.xml = self.xml.replacen(&format!("</{section}>"), &format!("{item}</{section}>"), 1);
        self.count.insert(section, n + 1);
        self.bump(section);
        self.changed = true;
        n
    }

    /// 묶음 여는 태그의 count 를 실제 수로
    fn bump(&mut self, section: &str) {
        let item = match section { "fonts" => "font", "fills" => "fill", "borders" => "border", "cellXfs" => "xf", _ => "numFmt" };
        let n = count_in(&self.xml, section, item);
        let Some(i) = self.xml.find(&format!("<{section}")) else { return };
        let Some(j) = self.xml[i..].find('>').map(|k| i + k) else { return };
        let tag = crate::sheet_patch::drop_attr(&self.xml[i..j], "count");
        self.xml.replace_range(i..j, &format!("{tag} count=\"{n}\""));
    }

    /// 바뀌었으면 새 styles.xml
    pub fn finish(self) -> Option<String> {
        self.changed.then_some(self.xml)
    }
}
