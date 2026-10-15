//! 엑셀 칸 주소(A1)와 수식 속 참조 — 공유 수식 펼치기(sheet.rs)와 행열 끼우기·지우기 참조 밀기(sheet_patch.rs)가 같이 쓴다.
//! 수식을 글 조각과 참조 조각으로 나눠, 참조만 바꾸고 나머지(문자열 "…"·함수 이름·표 참조[…]·바깥 통합 문서)는 그대로 둔다

/// 칸 주소 한쪽 — 열만(A:A), 행만(1:1)도 있다. 0부터. bool = $ 붙은 고정
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Part {
    pub col: Option<(u32, bool)>,
    pub row: Option<(u32, bool)>,
}

/// 수식 속 참조 하나 — 시트 이름(따옴표 풀린 것)과 한 칸 또는 범위
#[derive(Clone, Debug, PartialEq)]
pub struct Ref {
    pub sheet: Option<String>,
    pub a: Part,
    pub b: Option<Part>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Tok {
    Text(String),
    Ref(Ref),
    /// 지워진 칸을 가리키던 참조 — #REF! 로 쓴다
    Gone(Option<String>),
}

pub const MAX_COL: u32 = 16384;
pub const MAX_ROW: u32 = 1_048_576;

/// "B3" → (2, 1) — 0부터 (행, 열). $ 는 무시
pub fn parse_a1(s: &str) -> Option<(u32, u32)> {
    let p = parse_part(s)?;
    Some((p.row?.0, p.col?.0))
}

/// (2, 1) → "B3"
pub fn a1(row: u32, col: u32) -> String {
    format!("{}{}", col_name(col), row + 1)
}

pub fn col_name(mut c: u32) -> String {
    let mut s = Vec::new();
    loop {
        s.push(b'A' + (c % 26) as u8);
        if c < 26 { break; }
        c = c / 26 - 1;
    }
    s.reverse();
    String::from_utf8(s).unwrap_or_default()
}

/// "$A$1"·"A"·"12"·"$B" → Part. 글자 3개까지·범위 안만
fn parse_part(s: &str) -> Option<Part> {
    let b = s.as_bytes();
    let mut i = 0;
    let cabs = b.first() == Some(&b'$');
    if cabs { i += 1; }
    let cs = i;
    while i < b.len() && b[i].is_ascii_uppercase() { i += 1; }
    let letters = &s[cs..i];
    let rabs = i < b.len() && b[i] == b'$' && !letters.is_empty();
    if rabs { i += 1; }
    let rs = i;
    while i < b.len() && b[i].is_ascii_digit() { i += 1; }
    let digits = &s[rs..i];
    if i != b.len() || letters.len() > 3 || (letters.is_empty() && digits.is_empty()) { return None; }
    if letters.is_empty() && (cabs && rabs) { return None; }
    let col = if letters.is_empty() { None } else {
        let n = letters.bytes().fold(0u32, |n, x| n * 26 + (x - b'A' + 1) as u32) - 1;
        if n >= MAX_COL { return None; }
        Some((n, cabs))
    };
    let row = if digits.is_empty() { None } else {
        let n: u32 = digits.parse().ok()?;
        if n == 0 || n > MAX_ROW { return None; }
        Some((n - 1, if letters.is_empty() { cabs } else { rabs }))
    };
    if digits.starts_with('0') { return None; }
    Some(Part { col, row })
}

fn render_part(p: &Part) -> String {
    let mut s = String::new();
    if let Some((c, abs)) = p.col {
        if abs { s.push('$'); }
        s.push_str(&col_name(c));
    }
    if let Some((r, abs)) = p.row {
        if abs { s.push('$'); }
        s.push_str(&(r + 1).to_string());
    }
    s
}

fn quote_sheet(name: &str) -> String {
    let plain = name.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '.')
        && !name.chars().next().is_some_and(|c| c.is_ascii_digit())
        && parse_part(name).is_none();
    if plain { name.to_string() } else { format!("'{}'", name.replace('\'', "''")) }
}

fn ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '.' || c == '$'
}

/// 수식(앞의 = 없이) → 조각들
pub fn tokenize(f: &str) -> Vec<Tok> {
    let cs: Vec<char> = f.chars().collect();
    let mut out: Vec<Tok> = Vec::new();
    let mut text = String::new();
    let flush = |text: &mut String, out: &mut Vec<Tok>| if !text.is_empty() { out.push(Tok::Text(std::mem::take(text))); };
    let mut i = 0;
    while i < cs.len() {
        let c = cs[i];
        if c == '"' || c == '[' {
            // 문자열 "…"("" 는 따옴표) · 표 참조·바깥 통합 문서 […] — 통째로 글
            let close = if c == '"' { '"' } else { ']' };
            text.push(c);
            i += 1;
            while i < cs.len() {
                text.push(cs[i]);
                if cs[i] == close {
                    if close == '"' && cs.get(i + 1) == Some(&'"') { text.push('"'); i += 2; continue; }
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }
        // 시트 이름: '…'! 또는 이름!
        let mut sheet: Option<String> = None;
        let mut j = i;
        if c == '\'' {
            let mut name = String::new();
            let mut k = i + 1;
            let mut ok = false;
            while k < cs.len() {
                if cs[k] == '\'' {
                    if cs.get(k + 1) == Some(&'\'') { name.push('\''); k += 2; continue; }
                    ok = cs.get(k + 1) == Some(&'!');
                    break;
                }
                name.push(cs[k]);
                k += 1;
            }
            if ok { sheet = Some(name); j = k + 2; }
        } else if ident_char(c) && (i == 0 || !ident_char(cs[i - 1])) {
            let mut k = i;
            while k < cs.len() && ident_char(cs[k]) { k += 1; }
            if cs.get(k) == Some(&'!') {
                sheet = Some(cs[i..k].iter().collect());
                j = k + 1;
            }
        }
        // 참조 자리: 앞이 이름 글자가 아니어야
        if sheet.is_some() || ((ident_char(c)) && (i == 0 || !ident_char(cs[i - 1]))) {
            let mut k = j;
            while k < cs.len() && ident_char(cs[k]) && cs[k] != '.' { k += 1; }
            let first: String = cs[j..k].iter().collect();
            let next = cs.get(k).copied();
            if next != Some('(') && next.is_none_or(|n| !ident_char(n)) {
                if let Some(a) = parse_part(&first) {
                    // 범위 A1:B2 · A:B · 1:2
                    let mut end = k;
                    let mut b = None;
                    if next == Some(':') {
                        let mut m = k + 1;
                        while m < cs.len() && ident_char(cs[m]) && cs[m] != '.' { m += 1; }
                        let second: String = cs[k + 1..m].iter().collect();
                        if let Some(p) = parse_part(&second) {
                            let same_kind = (a.col.is_some(), a.row.is_some()) == (p.col.is_some(), p.row.is_some());
                            if same_kind && cs.get(m).is_none_or(|n| *n != '(') { b = Some(p); end = m; }
                        }
                    }
                    let whole = a.col.is_some() && a.row.is_some();
                    if whole || b.is_some() {
                        flush(&mut text, &mut out);
                        out.push(Tok::Ref(Ref { sheet, a, b }));
                        i = end;
                        continue;
                    }
                }
            }
            if sheet.is_some() {
                // 시트 이름 뒤가 참조가 아니다(이름 정의 등) — 글로
                text.extend(cs[i..j].iter());
                i = j;
                continue;
            }
            // 참조 아닌 이름(함수·정의된 이름·숫자) — 통째로 글
            if ident_char(c) {
                let mut k = i;
                while k < cs.len() && ident_char(cs[k]) { k += 1; }
                text.extend(cs[i..k].iter());
                i = k;
                continue;
            }
        }
        text.push(c);
        i += 1;
    }
    flush(&mut text, &mut out);
    out
}

pub fn render(toks: &[Tok]) -> String {
    let mut s = String::new();
    for t in toks {
        match t {
            Tok::Text(x) => s.push_str(x),
            Tok::Ref(r) => {
                if let Some(sh) = &r.sheet { s.push_str(&quote_sheet(sh)); s.push('!'); }
                s.push_str(&render_part(&r.a));
                if let Some(b) = &r.b { s.push(':'); s.push_str(&render_part(b)); }
            }
            Tok::Gone(sh) => {
                if let Some(sh) = sh { s.push_str(&quote_sheet(sh)); s.push('!'); }
                s.push_str("#REF!");
            }
        }
    }
    s
}

/// 공유 수식 펼치기 — 기준 칸 수식을 (dr, dc) 만큼 옮긴 칸의 수식으로. $ 고정은 그대로
pub fn translate(f: &str, dr: i64, dc: i64) -> String {
    let mv = |p: &mut Part| {
        if let Some((c, false)) = p.col { p.col = Some(((c as i64 + dc).clamp(0, MAX_COL as i64 - 1) as u32, false)); }
        if let Some((r, false)) = p.row { p.row = Some(((r as i64 + dr).clamp(0, MAX_ROW as i64 - 1) as u32, false)); }
    };
    let toks: Vec<Tok> = tokenize(f).into_iter().map(|t| match t {
        Tok::Ref(mut r) => { mv(&mut r.a); if let Some(b) = r.b.as_mut() { mv(b); } Tok::Ref(r) }
        t => t,
    }).collect();
    render(&toks)
}

/// 행이냐 열이냐
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Axis { Row, Col }

/// 행·열 끼우기(n > 0)·지우기(n < 0) 한 번 — at 자리부터. 0부터
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shift { pub axis: Axis, pub at: u32, pub n: i64 }

impl Shift {
    fn get(&self, p: &Part) -> Option<u32> { match self.axis { Axis::Row => p.row.map(|x| x.0), Axis::Col => p.col.map(|x| x.0) } }
    fn set(&self, p: &mut Part, v: u32) {
        match self.axis { Axis::Row => if let Some(x) = p.row.as_mut() { x.0 = v }, Axis::Col => if let Some(x) = p.col.as_mut() { x.0 = v } }
    }
    fn max(&self) -> i64 { if self.axis == Axis::Row { MAX_ROW as i64 } else { MAX_COL as i64 } }

    /// 한 자리(행 번호나 열 번호) — 지워진 자리면 None
    pub fn point(&self, v: u32) -> Option<u32> {
        let (at, k) = (self.at as i64, self.n.unsigned_abs() as i64);
        let v = v as i64;
        if self.n >= 0 { return Some(if v >= at { (v + self.n).min(self.max() - 1) } else { v } as u32); }
        if v < at { Some(v as u32) } else if v < at + k { None } else { Some((v - k) as u32) }
    }

    /// 범위 [a, b] — 끼우기는 끝마다 밀고(가운데에 끼우면 늘어남), 지우기는 줄이고 다 지워지면 None
    pub fn span(&self, a: u32, b: u32) -> Option<(u32, u32)> {
        if self.n >= 0 { return Some((self.point(a)?, self.point(b)?)); }
        let (at, k) = (self.at as i64, self.n.unsigned_abs() as i64);
        let (a, b) = (a as i64, b as i64);
        let na = if a >= at + k { a - k } else if a >= at { at } else { a };
        let nb = if b >= at + k { b - k } else if b >= at { at - 1 } else { b };
        (nb >= na).then_some((na as u32, nb as u32))
    }

    /// 참조 하나 — 이 축이 없는 참조(행 연산에 A:A)는 그대로
    pub fn apply(&self, r: &Ref) -> Option<Ref> {
        let mut r = r.clone();
        match r.b {
            None => {
                let Some(v) = self.get(&r.a) else { return Some(r) };
                let nv = self.point(v)?;
                self.set(&mut r.a, nv);
            }
            Some(mut b) => {
                let (Some(x), Some(y)) = (self.get(&r.a), self.get(&b)) else { return Some(r) };
                let (lo, hi) = (x.min(y), x.max(y));
                let (nlo, nhi) = self.span(lo, hi)?;
                if x <= y { self.set(&mut r.a, nlo); self.set(&mut b, nhi); } else { self.set(&mut r.a, nhi); self.set(&mut b, nlo); }
                r.b = Some(b);
            }
        }
        Some(r)
    }
}

/// 수식 속 참조 밀기 — target = 행열을 바꾼 시트 이름, here = 이 수식이 있는 시트 이름(시트 이름 없는 참조의 주인)
pub fn shift_formula(f: &str, target: &str, here: &str, sh: Shift) -> String {
    map_refs(f, here, |r, sheet| if sheet == target { sh.apply(r).map(Tok::Ref).unwrap_or(Tok::Gone(r.sheet.clone())) } else { Tok::Ref(r.clone()) })
}

/// 시트 이름 바꾸기·지우기 — new = None 이면 지운 것(그 시트 참조는 #REF!)
pub fn rename_formula(f: &str, old: &str, new: Option<&str>) -> String {
    map_refs(f, "", |r, sheet| match (sheet == old && r.sheet.is_some(), new) {
        (true, Some(n)) => Tok::Ref(Ref { sheet: Some(n.to_string()), ..r.clone() }),
        (true, None) => Tok::Gone(None),
        _ => Tok::Ref(r.clone()),
    })
}

fn map_refs(f: &str, here: &str, mut g: impl FnMut(&Ref, &str) -> Tok) -> String {
    let toks: Vec<Tok> = tokenize(f).into_iter().map(|t| match t {
        Tok::Ref(r) => { let sheet = r.sheet.clone().unwrap_or_else(|| here.to_string()); g(&r, &sheet) }
        t => t,
    }).collect();
    render(&toks)
}

/// "A1:B2 C3" 같은 범위 목록 밀기 — 다 지워진 범위는 뺀다(다 빠지면 None)
pub fn shift_sqref(sq: &str, sh: Shift) -> Option<String> {
    let out: Vec<String> = sq.split_whitespace().filter_map(|one| {
        let (a, b) = one.split_once(':').unwrap_or((one, one));
        let r = Ref { sheet: None, a: parse_part(a)?, b: (a != b).then(|| parse_part(b)).flatten() };
        let n = sh.apply(&r)?;
        Some(render(&[Tok::Ref(n)]))
    }).collect();
    (!out.is_empty()).then(|| out.join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a1_왕복() {
        assert_eq!(parse_a1("B3"), Some((2, 1)));
        assert_eq!(parse_a1("$AA$10"), Some((9, 26)));
        assert_eq!(parse_a1("XFD1048576"), Some((1_048_575, 16383)));
        assert_eq!(parse_a1("XFE1"), None);
        assert_eq!(parse_a1("A0"), None);
        assert_eq!(a1(9, 26), "AA10");
        assert_eq!(col_name(701), "ZZ");
        assert_eq!(col_name(702), "AAA");
    }

    #[test]
    fn 참조만_골라낸다() {
        let refs: Vec<String> = tokenize("SUM(B2:B13)+매출!E9+'월 합계'!$C$3+LOG10(A1)+\"A1\"+Table1[금액]+A:A+3:5")
            .into_iter().filter_map(|t| if let Tok::Ref(r) = t { Some(render(&[Tok::Ref(r)])) } else { None }).collect();
        assert_eq!(refs, vec!["B2:B13", "매출!E9", "'월 합계'!$C$3", "A1", "A:A", "3:5"]);
    }

    #[test]
    fn 함수_이름과_정의된_이름은_참조가_아니다() {
        assert!(tokenize("LOG10(2)+ATAN2(1,2)+세율*2").iter().all(|t| matches!(t, Tok::Text(_))));
        assert_eq!(render(&tokenize("IF(B1>300000,\"목표 \"\"달성\"\"\",\"미달\")")), "IF(B1>300000,\"목표 \"\"달성\"\"\",\"미달\")");
    }

    #[test]
    fn 공유_수식_옮기기() {
        assert_eq!(translate("D2*E2", 3, 0), "D5*E5");
        assert_eq!(translate("B2<AVERAGE(B$2:B$13)*0.8", 1, 2), "D3<AVERAGE(D$2:D$13)*0.8");
        assert_eq!(translate("$A$1+A1", 1, 1), "$A$1+B2");
        assert_eq!(translate("SUMIF('매출'!A3:A8,\"1월\",'매출'!C3:C8)", 1, 0), "SUMIF(매출!A4:A9,\"1월\",매출!C4:C9)");
    }

    fn row(at: u32, n: i64) -> Shift { Shift { axis: Axis::Row, at, n } }
    fn col(at: u32, n: i64) -> Shift { Shift { axis: Axis::Col, at, n } }

    #[test]
    fn 행_끼우기는_아래를_밀고_범위_가운데면_늘린다() {
        // 4행 앞(0부터 3)에 1행 끼우기
        assert_eq!(shift_formula("C4*D4+SUM(E3:E8)+$A$9+A1", "매출", "매출", row(3, 1)), "C5*D5+SUM(E3:E9)+$A$10+A1");
        // 다른 시트에서 이 시트를 가리키는 것도, 이 시트 이름 없는 건 그 시트 것이라 안 민다
        assert_eq!(shift_formula("매출!E9+E9", "매출", "요약", row(3, 1)), "매출!E10+E9");
        assert_eq!(shift_formula("SUM(A:A)+SUM(3:5)", "매출", "매출", row(0, 2)), "SUM(A:A)+SUM(5:7)");
    }

    #[test]
    fn 행_지우기는_당기고_지운_칸은_REF_범위는_줄인다() {
        // 4~5행(0부터 3~4) 지우기
        assert_eq!(shift_formula("C4+C6+SUM(E3:E8)", "매출", "매출", row(3, -2)), "#REF!+C4+SUM(E3:E6)");
        assert_eq!(shift_formula("SUM(E4:E5)+'매출'!B4", "매출", "요약", row(3, -2)), "SUM(E4:E5)+매출!#REF!");
        assert_eq!(shift_formula("SUM(E4:E5)", "매출", "매출", row(3, -2)), "SUM(#REF!)");
        assert_eq!(shift_formula("SUM(E5:E9)", "매출", "매출", row(3, -2)), "SUM(E4:E7)");
    }

    #[test]
    fn 열_끼우기_지우기() {
        assert_eq!(shift_formula("B2+D2+SUM(B2:D2)", "s", "s", col(2, 1)), "B2+E2+SUM(B2:E2)");
        assert_eq!(shift_formula("B2+C2+D2+SUM(B2:D2)", "s", "s", col(2, -1)), "B2+#REF!+C2+SUM(B2:C2)");
        assert_eq!(shift_formula("SUM(3:3)+SUM(C:C)", "s", "s", col(2, -1)), "SUM(3:3)+SUM(#REF!)");
    }

    #[test]
    fn 범위_목록_밀기() {
        assert_eq!(shift_sqref("B2:E13 G7 H5", row(3, -2)).as_deref(), Some("B2:E11 G5"));
        assert_eq!(shift_sqref("A4:B5", row(3, -2)), None);
        assert_eq!(shift_sqref("A1:E1", col(1, 2)).as_deref(), Some("A1:G1"));
    }

    #[test]
    fn 시트_이름_바꾸기와_지우기() {
        assert_eq!(rename_formula("'매출'!E9+매출!A1:B2+E9+'다른 시트'!A1", "매출", Some("월 매출")), "'월 매출'!E9+'월 매출'!A1:B2+E9+'다른 시트'!A1");
        assert_eq!(rename_formula("매출!E9+E9", "매출", None), "#REF!+E9");
    }
}
