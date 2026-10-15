//! 스페이스 엑셀 서식 읽기 — styles.xml 의 칸 서식(cellXfs)을 화면이 바로 쓰는 모양으로 푼다.
//! 색은 #RRGGBB 로(테마 색·tint·옛 팔레트 번호까지 풀어서), 숫자 서식은 번호(내장 서식)도 글로

use quick_xml::events::{BytesStart, Event};
use quick_xml::reader::Reader;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::sheet::{attr, part_str, Parts};

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Font {
    #[serde(skip_serializing_if = "std::ops::Not::not")] pub b: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")] pub i: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")] pub u: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")] pub strike: bool,
    #[serde(skip_serializing_if = "Option::is_none")] pub sz: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub name: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Edge { pub style: String, #[serde(skip_serializing_if = "Option::is_none")] pub color: Option<String> }

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(default)]
pub struct Border {
    #[serde(skip_serializing_if = "Option::is_none")] pub l: Option<Edge>,
    #[serde(skip_serializing_if = "Option::is_none")] pub r: Option<Edge>,
    #[serde(skip_serializing_if = "Option::is_none")] pub t: Option<Edge>,
    #[serde(skip_serializing_if = "Option::is_none")] pub b: Option<Edge>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(default)]
pub struct Align {
    #[serde(skip_serializing_if = "Option::is_none")] pub h: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub v: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")] pub wrap: bool,
}

/// 칸 서식 하나(cellXfs 의 한 줄, 또는 조건부 서식의 dxf)
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Style {
    #[serde(skip_serializing_if = "Option::is_none")] pub num_fmt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub font: Option<Font>,
    #[serde(skip_serializing_if = "Option::is_none")] pub fill: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub border: Option<Border>,
    #[serde(skip_serializing_if = "Option::is_none")] pub align: Option<Align>,
}

/// 내장 숫자 서식(번호만 적힌 것) — 한국어 엑셀이 보여 주는 모양에 가깝게
pub fn builtin_fmt(id: u32) -> Option<&'static str> {
    Some(match id {
        1 => "0", 2 => "0.00", 3 => "#,##0", 4 => "#,##0.00", 9 => "0%", 10 => "0.00%", 11 => "0.00E+00", 12 => "# ?/?", 13 => "# ??/??",
        14 => "yyyy-mm-dd", 15 => "d-mmm-yy", 16 => "d-mmm", 17 => "mmm-yy", 18 => "h:mm AM/PM", 19 => "h:mm:ss AM/PM", 20 => "h:mm", 21 => "h:mm:ss",
        22 => "yyyy-mm-dd h:mm", 37 => "#,##0 ;(#,##0)", 38 => "#,##0 ;[Red](#,##0)", 39 => "#,##0.00;(#,##0.00)", 40 => "#,##0.00;[Red](#,##0.00)",
        45 => "mm:ss", 46 => "[h]:mm:ss", 47 => "mmss.0", 48 => "##0.0E+0", 49 => "@",
        _ => return None,
    })
}

/// 옛 팔레트(indexed) 0~63 — 엑셀 기본값
const INDEXED: [u32; 64] = [
    0x000000, 0xFFFFFF, 0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 0xFF00FF, 0x00FFFF, 0x000000, 0xFFFFFF, 0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 0xFF00FF, 0x00FFFF,
    0x800000, 0x008000, 0x000080, 0x808000, 0x800080, 0x008080, 0xC0C0C0, 0x808080, 0x9999FF, 0x993366, 0xFFFFCC, 0xCCFFFF, 0x660066, 0xFF8080, 0x0066CC, 0xCCCCFF,
    0x000080, 0xFF00FF, 0xFFFF00, 0x00FFFF, 0x800080, 0x800000, 0x008080, 0x0000FF, 0x00CCFF, 0xCCFFFF, 0xCCFFCC, 0xFFFF99, 0x99CCFF, 0xFF99CC, 0xCC99FF, 0xFFCC99,
    0x3366FF, 0x33CCCC, 0x99CC00, 0xFFCC00, 0xFF9900, 0xFF6600, 0x666699, 0x969696, 0x003366, 0x339966, 0x003300, 0x333300, 0x993300, 0x993366, 0x333399, 0x333333,
];

/// 테마 색 12개(theme1.xml clrScheme) — 순서는 엑셀 theme 번호(0=lt1 1=dk1 2=lt2 3=dk2 4~9=accent 10 hlink 11 folHlink)
pub fn theme_colors(parts: &Parts) -> Vec<u32> {
    let mut by_name: HashMap<String, u32> = HashMap::new();
    if let Some(s) = part_str(parts, "xl/theme/theme1.xml") {
        let mut r = Reader::from_str(s);
        let mut cur = String::new();
        while let Ok(ev) = r.read_event() {
            match &ev {
                Event::Start(e) => cur = e.local_name().as_ref().to_string(),
                Event::Empty(e) => {
                    let v = match e.local_name().as_ref() { "srgbClr" => attr(e, "val"), "sysClr" => attr(e, "lastClr"), _ => None };
                    if let Some(v) = v.and_then(|v| u32::from_str_radix(&v, 16).ok()) { by_name.entry(cur.clone()).or_insert(v); }
                }
                Event::Eof => break,
                _ => {}
            }
        }
    }
    let defaults = [0xFFFFFF, 0x000000, 0xE7E6E6, 0x44546A, 0x4472C4, 0xED7D31, 0xA5A5A5, 0xFFC000, 0x5B9BD5, 0x70AD47, 0x0563C1, 0x954F72];
    ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"]
        .iter().zip(defaults).map(|(n, d)| by_name.get(*n).copied().unwrap_or(d)).collect()
}

/// tint(-1~1)로 밝게·어둡게 — 엑셀이 쓰는 HSL 밝기 계산
fn tinted(rgb: u32, tint: f64) -> u32 {
    if tint == 0.0 { return rgb; }
    let ch = |s: u32| ((rgb >> s) & 0xFF) as f64 / 255.0;
    let (r, g, b) = (ch(16), ch(8), ch(0));
    let (mx, mn) = (r.max(g).max(b), r.min(g).min(b));
    let mut l = (mx + mn) / 2.0;
    let d = mx - mn;
    let (h, s) = if d == 0.0 { (0.0, 0.0) } else {
        let s = if l > 0.5 { d / (2.0 - mx - mn) } else { d / (mx + mn) };
        let h = if mx == r { (g - b) / d + if g < b { 6.0 } else { 0.0 } } else if mx == g { (b - r) / d + 2.0 } else { (r - g) / d + 4.0 };
        (h / 6.0, s)
    };
    l = if tint < 0.0 { l * (1.0 + tint) } else { l * (1.0 - tint) + tint };
    let hue = |p: f64, q: f64, mut t: f64| {
        if t < 0.0 { t += 1.0 } if t > 1.0 { t -= 1.0 }
        if t < 1.0 / 6.0 { p + (q - p) * 6.0 * t } else if t < 0.5 { q } else if t < 2.0 / 3.0 { p + (q - p) * (2.0 / 3.0 - t) * 6.0 } else { p }
    };
    let (r, g, b) = if s == 0.0 { (l, l, l) } else {
        let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
        let p = 2.0 * l - q;
        (hue(p, q, h + 1.0 / 3.0), hue(p, q, h), hue(p, q, h - 1.0 / 3.0))
    };
    let to = |x: f64| (x * 255.0).round().clamp(0.0, 255.0) as u32;
    (to(r) << 16) | (to(g) << 8) | to(b)
}

/// <color rgb=… theme=… tint=… indexed=…/> → "#RRGGBB". auto·없음은 None
pub fn color_of(e: &BytesStart, theme: &[u32]) -> Option<String> {
    let base = if let Some(rgb) = attr(e, "rgb") {
        u32::from_str_radix(rgb.get(rgb.len().saturating_sub(6)..)?, 16).ok()?
    } else if let Some(t) = attr(e, "theme").and_then(|v| v.parse::<usize>().ok()) {
        *theme.get(t)?
    } else if let Some(i) = attr(e, "indexed").and_then(|v| v.parse::<usize>().ok()) {
        *INDEXED.get(i)? // 64 = 시스템 글자색(auto) — 없음
    } else { return None };
    let tint = attr(e, "tint").and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
    Some(format!("#{:06X}", tinted(base, tint)))
}

fn on(e: &BytesStart) -> bool {
    !matches!(attr(e, "val").as_deref(), Some("0" | "false" | "none"))
}

/// 통합 문서 서식 — cell = cellXfs 순서(칸의 s 번호), dxf = 조건부 서식이 쓰는 것, font = 기본 글꼴(0번)
#[derive(Serialize, Debug, Clone, Default, PartialEq)]
pub struct Styles { pub cell: Vec<Style>, pub dxf: Vec<Style>, pub font: Font }

/// styles.xml → Styles. 칸 서식의 글꼴이 기본 글꼴(0번)이면 안 넣는다 — 화면 기본값이 쓰이게
pub fn styles(parts: &Parts) -> Styles {
    let Some(s) = part_str(parts, "xl/styles.xml") else { return Styles { cell: vec![Style::default()], ..Default::default() } };
    let theme = theme_colors(parts);
    let mut fmts: HashMap<u32, String> = HashMap::new();
    let (mut fonts, mut fills, mut borders) = (Vec::<Font>::new(), Vec::<Option<String>>::new(), Vec::<Border>::new());
    let (mut xfs, mut dxfs) = (Vec::<(u32, usize, usize, usize, Option<Align>)>::new(), Vec::<Style>::new());
    // 지금 어느 칸 안인가
    let mut section = String::new();
    let (mut font, mut fill, mut border, mut dxf) = (None::<Font>, None::<(Option<String>, Option<String>, bool)>, None::<Border>, None::<Style>);
    let mut edge: Option<(String, Edge)> = None;
    let mut r = Reader::from_str(s);
    loop {
        let ev = match r.read_event() { Ok(e) => e, Err(_) => break };
        let (e, empty) = match &ev { Event::Start(e) => (e, false), Event::Empty(e) => (e, true), Event::End(e) => {
            match e.local_name().as_ref() {
                "font" => if let Some(f) = font.take() { if let Some(d) = dxf.as_mut() { d.font = Some(f) } else { fonts.push(f) } },
                "fill" => if let Some((fg, bg, solid)) = fill.take() {
                    // dxf 의 단색 채우기는 bgColor 에 색을 둔다(엑셀)
                    let c = if !solid { None } else if dxf.is_some() { bg.or(fg) } else { fg.or(bg) };
                    if let Some(d) = dxf.as_mut() { d.fill = c } else { fills.push(c) }
                },
                "border" => if let Some(b) = border.take() { if let Some(d) = dxf.as_mut() { d.border = Some(b) } else { borders.push(b) } },
                "left" | "right" | "top" | "bottom" | "start" | "end" => if let (Some((side, ed)), Some(b)) = (edge.take(), border.as_mut()) { put_edge(b, &side, ed) },
                "dxf" => if let Some(d) = dxf.take() { dxfs.push(d) },
                n if n == section => section.clear(),
                _ => {}
            }
            continue;
        }, Event::Eof => break, _ => continue };
        let name = e.local_name().as_ref().to_string();
        match name.as_str() {
            "numFmts" | "fonts" | "fills" | "borders" | "cellXfs" | "cellStyleXfs" | "dxfs" | "cellStyles" if !empty => section = name.clone(),
            "numFmt" => {
                let (id, code) = (attr(e, "numFmtId").and_then(|v| v.parse().ok()), attr(e, "formatCode"));
                if let Some(d) = dxf.as_mut() { d.num_fmt = code.or_else(|| id.and_then(builtin_fmt).map(String::from)) }
                else if let (Some(id), Some(code)) = (id, code) { fmts.insert(id, code); }
            }
            "font" => { font = Some(Font::default()); if empty { if let Some(f) = font.take() { fonts.push(f) } } }
            "b" | "i" | "u" | "strike" if font.is_some() => if let Some(f) = font.as_mut() {
                let v = on(e);
                match name.as_str() { "b" => f.b = v, "i" => f.i = v, "u" => f.u = v, _ => f.strike = v }
            },
            "sz" if font.is_some() => if let Some(f) = font.as_mut() { f.sz = attr(e, "val").and_then(|v| v.parse().ok()) },
            "name" if font.is_some() => if let Some(f) = font.as_mut() { f.name = attr(e, "val") },
            "fill" => { fill = Some((None, None, false)); if empty { fills.push(None); fill = None; } }
            "patternFill" => if let Some(f) = fill.as_mut() {
                // patternType 이 없으면 단색으로 본다(dxf 에서 흔함)
                f.2 = attr(e, "patternType").map_or(dxf.is_some(), |p| p != "none");
            },
            "gradientFill" => if let Some(f) = fill.as_mut() { f.2 = true },
            "fgColor" | "bgColor" => if let Some(f) = fill.as_mut() {
                let c = color_of(e, &theme);
                if name == "fgColor" { f.0 = c } else { f.1 = c }
            },
            "color" => {
                let c = color_of(e, &theme);
                if let Some((_, ed)) = edge.as_mut() { ed.color = c }
                else if let Some(f) = font.as_mut() { f.color = c }
                else if let Some(f) = fill.as_mut() { if f.0.is_none() { f.0 = c } } // 그라데이션 첫 색
            }
            "border" => { border = Some(Border::default()); if empty { if let Some(b) = border.take() { if let Some(d) = dxf.as_mut() { d.border = Some(b) } else { borders.push(b) } } } }
            "left" | "right" | "top" | "bottom" | "start" | "end" if border.is_some() => {
                if let Some(st) = attr(e, "style") {
                    let ed = Edge { style: st, color: None };
                    if empty { if let Some(b) = border.as_mut() { put_edge(b, &name, ed) } } else { edge = Some((name.clone(), ed)) }
                }
            }
            "xf" if section == "cellXfs" => {
                let n = |k: &str| attr(e, k).and_then(|v| v.parse::<usize>().ok()).unwrap_or(0);
                xfs.push((n("numFmtId") as u32, n("fontId"), n("fillId"), n("borderId"), None));
            }
            "alignment" if section == "cellXfs" => if let Some(x) = xfs.last_mut() {
                // 가로 'general' 은 기본값(안 적은 것과 같다) — 따로 적으면 화면에서 돌아온 같은 서식이 다른 서식으로 보인다
                x.4 = Some(Align { h: attr(e, "horizontal").filter(|h| h != "general"), v: attr(e, "vertical"), wrap: attr(e, "wrapText").is_some_and(|v| v == "1" || v == "true") });
            },
            "alignment" if dxf.is_some() => {}
            "dxf" => { dxf = Some(Style::default()); if empty { dxfs.push(Style::default()); dxf = None; } }
            _ => {}
        }
    }
    let base = fonts.first().cloned().unwrap_or_default();
    let cell = xfs.into_iter().map(|(nf, fo, fi, bo, al)| Style {
        num_fmt: if nf == 0 { None } else { fmts.get(&nf).cloned().or_else(|| builtin_fmt(nf).map(String::from)) },
        // 기본 글꼴(0번)과 같으면 안 보낸다 — 화면 기본값이 쓰이게
        font: fonts.get(fo).filter(|f| **f != base).cloned(),
        fill: fills.get(fi).cloned().flatten(),
        border: borders.get(bo).filter(|b| **b != Border::default()).cloned(),
        align: al.filter(|a| *a != Align::default()),
    }).collect::<Vec<_>>();
    Styles { cell: if cell.is_empty() { vec![Style::default()] } else { cell }, dxf: dxfs, font: base }
}

fn put_edge(b: &mut Border, side: &str, ed: Edge) {
    match side { "left" | "start" => b.l = Some(ed), "right" | "end" => b.r = Some(ed), "top" => b.t = Some(ed), _ => b.b = Some(ed) }
}
