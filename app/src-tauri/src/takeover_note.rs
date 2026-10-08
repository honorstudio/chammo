//! 사람 개입 기록 한 줄씩(takeover.rs) — 간 주소·탭·키·대화상자·파일 수, 누른 곳·글자 넣은 칸의 이름. **값은 없다**:
//! 주소는 출처+경로, 글칸·편집 영역은 페이지가 붙인 이름표만(친 글은 안 읽는다), 비밀번호 칸은 이름도 안 쓴다
use serde_json::{json, Value};

const MAX_NAME: usize = 60;

/// 이름 한 줄 — 줄바꿈·제어 문자 없이, 60자
fn name(s: &str) -> String {
    let one: String = s.split_whitespace().collect::<Vec<_>>().join(" ").chars().filter(|c| !c.is_control()).collect();
    if one.chars().count() > MAX_NAME {
        format!("{}…", one.chars().take(MAX_NAME - 1).collect::<String>())
    } else {
        one
    }
}

/// 주소 → 출처+경로(쿼리·조각엔 토큰이 붙어 온다). http(s) 가 아니면 종류만, 빈 탭은 None
pub fn bare_url(url: &str) -> Option<String> {
    if url.is_empty() || url == "about:blank" {
        return None;
    }
    let cut = url.split(['?', '#']).next().unwrap_or_default();
    match cut.split_once("://") {
        Some((scheme, rest)) if scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https") => {
            let (auth, path) = rest.split_once('/').map(|(a, p)| (a, format!("/{p}"))).unwrap_or((rest, "/".into()));
            Some(format!("{}://{}{}", scheme.to_ascii_lowercase(), auth.rsplit('@').next().unwrap_or_default().to_ascii_lowercase(), path))
        }
        _ => Some(format!("{}:", cut.split(':').next().unwrap_or_default().to_ascii_lowercase())),
    }
}

pub fn nav(url: &str) -> Option<Value> {
    bare_url(url).map(|u| json!({ "k": "nav", "url": u }))
}
pub fn tab_opened(url: &str) -> Value {
    json!({ "k": "tab+", "url": bare_url(url).unwrap_or_default() })
}
pub fn tab_closed(url: &str) -> Value {
    json!({ "k": "tab-", "url": bare_url(url).unwrap_or_default() })
}
pub fn key(k: &str) -> Value {
    json!({ "k": "key", "key": name(k) })
}
pub fn dialog(accept: bool) -> Value {
    json!({ "k": "dialog", "accept": accept })
}
pub fn files(n: usize) -> Value {
    json!({ "k": "files", "n": n })
}

/// 페이지에서 요소를 설명하는 JS — 누른 자리(x,y) 또는 포커스 칸. **값은 안 읽는다**: 글칸·편집 영역은 페이지가 붙인 이름표(aria-label·label·placeholder·name)만,
/// 누를 수 있는 요소는 보이는 글(innerText)을 60자까지, 그 밖(글 덩어리·칸 묶음)은 20자 넘는 글이면 이름 없이 '빈 곳' — 페이지 글을 통째로 싣지 않게(QA: 'Pizza Size Small Medium Large'). 결과는 {tag,type,role,name,editable,password} JSON 글
pub fn describe_js(at: Option<(f64, f64)>) -> String {
    let pick = match at {
        Some((x, y)) => format!("document.elementFromPoint({x},{y})"),
        None => "document.activeElement".into(),
    };
    format!(
        r#"(()=>{{try{{let e={pick};if(!e)return '';const hit=e.closest&&e.closest('a,button,input,select,textarea,label,summary,option,[role],[contenteditable=""],[contenteditable="true"],[onclick]');const t=hit||e;
const tag=t.tagName.toLowerCase(),type=(t.getAttribute('type')||'').toLowerCase(),ac=(t.getAttribute('autocomplete')||'').toLowerCase();
const btnInput=tag==='input'&&['submit','button','reset','image'].includes(type);
const editable=!btnInput&&(tag==='input'||tag==='textarea'||tag==='select'||!!t.isContentEditable);
const lab=()=>{{let l=t.getAttribute('aria-label')||'';if(!l&&t.labels&&t.labels[0])l=t.labels[0].innerText;if(!l&&t.id){{const q=document.querySelector('label[for="'+CSS.escape(t.id)+'"]');if(q)l=q.innerText;}}return l||t.getAttribute('placeholder')||t.getAttribute('name')||t.getAttribute('title')||'';}};
const txt=(t.innerText||'').trim();const nm=editable?lab():btnInput?(t.getAttribute('aria-label')||t.value||''):(t.getAttribute('aria-label')||(hit||txt.length<=20?txt:'')||t.getAttribute('title')||t.getAttribute('alt')||'');
return JSON.stringify({{tag,type,role:t.getAttribute('role')||'',name:String(nm).replace(/\s+/g,' ').slice(0,80),editable,password:type==='password'||ac.includes('password')}});}}catch(_){{return '';}}}})()"#
    )
}

/// describe_js 결과 → 사람이 읽을 이름('버튼 '로그인'', '칸 '이메일'', '비밀번호 칸'). 모양이 이상하면 None
pub fn describe(raw: &str) -> Option<(String, bool, bool)> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let tag = v["tag"].as_str()?.to_ascii_lowercase();
    let ty = v["type"].as_str().unwrap_or_default();
    let role = v["role"].as_str().unwrap_or_default();
    let nm = name(v["name"].as_str().unwrap_or_default());
    let editable = v["editable"].as_bool().unwrap_or(false);
    let password = v["password"].as_bool().unwrap_or(false);
    if password {
        return Some(("비밀번호 칸".into(), true, true));
    }
    let word = if editable {
        match (tag.as_str(), ty) {
            ("input", "checkbox") => "체크박스",
            ("input", "radio") => "선택지",
            ("select", _) => "고르기 칸",
            _ => "칸",
        }
    } else if tag == "a" || role == "link" {
        "링크"
    } else if tag == "button" || tag == "input" || role == "button" || tag == "summary" {
        "버튼"
    } else if role == "tab" {
        "탭"
    } else if role == "checkbox" || role == "switch" {
        "스위치"
    } else if tag == "iframe" {
        "프레임 안"
    } else {
        ""
    };
    let what = match (word, nm.is_empty()) {
        ("", true) => "빈 곳".to_string(),
        ("", false) => format!("'{nm}'"),
        (w, true) => w.to_string(),
        (w, false) => format!("{w} '{nm}'"),
    };
    let field = editable && !matches!((tag.as_str(), ty), ("input", "checkbox") | ("input", "radio"));
    Some((what, field, false))
}

/// 누른 자리 설명 → 기록
pub fn click(raw: &str) -> Option<Value> {
    describe(raw).map(|(what, _, _)| json!({ "k": "click", "what": what }))
}

/// 글자를 넣은 칸 설명 → 기록(값 없이). 글칸이 아니면(빈 곳에 친 것) '페이지'
pub fn typed(raw: &str) -> Value {
    match describe(raw) {
        Some((_, _, true)) => json!({ "k": "type", "what": "비밀번호 칸", "password": true }),
        Some((what, true, _)) => json!({ "k": "type", "what": what }),
        _ => json!({ "k": "type", "what": "페이지(글칸 아님)" }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn 주소는_출처와_경로만() {
        assert_eq!(bare_url("https://User@Example.com/a/b?x=1#y").as_deref(), Some("https://example.com/a/b"));
        assert_eq!(bare_url("http://a.com").as_deref(), Some("http://a.com/"));
        assert_eq!(bare_url("about:blank"), None);
        assert_eq!(bare_url("data:text/html,<secret>").as_deref(), Some("data:"));
        assert_eq!(bare_url("chrome://settings").as_deref(), Some("chrome:"));
    }

    #[test]
    fn 요소_설명은_이름만_값은_없다() {
        let d = |v: Value| describe(&v.to_string());
        assert_eq!(d(json!({ "tag": "BUTTON", "name": "Submit order", "editable": false })).unwrap().0, "버튼 'Submit order'");
        assert_eq!(d(json!({ "tag": "a", "name": "다음\n페이지", "editable": false })).unwrap().0, "링크 '다음 페이지'");
        assert_eq!(d(json!({ "tag": "input", "type": "text", "name": "Customer name:", "editable": true })).unwrap(), ("칸 'Customer name:'".into(), true, false));
        assert_eq!(d(json!({ "tag": "input", "type": "password", "name": "비번", "editable": true, "password": true })).unwrap(), ("비밀번호 칸".into(), true, true));
        assert_eq!(d(json!({ "tag": "input", "type": "checkbox", "name": "Bacon", "editable": true })).unwrap(), ("체크박스 'Bacon'".into(), false, false));
        assert_eq!(d(json!({ "tag": "div", "name": "", "editable": false })).unwrap().0, "빈 곳");
        assert_eq!(d(json!({ "tag": "p", "name": "x".repeat(200), "editable": false })).unwrap().0.chars().count(), MAX_NAME + 2);
        assert!(describe("not json").is_none());
        assert!(describe("").is_none());
    }

    #[test]
    fn 입력_기록은_칸_이름만_비밀번호는_이름도_안_쓴다() {
        let t = typed(&json!({ "tag": "input", "type": "password", "name": "회사 비밀번호", "editable": true, "password": true }).to_string());
        assert_eq!(t["what"], "비밀번호 칸");
        assert!(!t.to_string().contains("회사"));
        let t = typed(&json!({ "tag": "textarea", "name": "Delivery instructions:", "editable": true }).to_string());
        assert_eq!(t["what"], "칸 'Delivery instructions:'");
        assert_eq!(typed("")["what"], "페이지(글칸 아님)");
    }

    #[test]
    fn 설명_js_는_값을_읽지_않는다() {
        let js = describe_js(Some((10.0, 20.0)));
        assert!(js.contains("elementFromPoint(10,20)"));
        assert!(!js.contains("t.value||''):(") || js.contains("btnInput?"), "value 는 버튼 모양 input 에서만");
        assert!(!js.contains(".textContent"));
        // 글칸은 innerText 를 안 쓴다 — editable 이면 lab() 만
        assert!(js.contains("editable?lab()"));
        // 누를 수 없는 곳(글 덩어리)은 짧은 글만 이름으로
        assert!(js.contains("hit||txt.length<=20"));
        assert!(describe_js(None).contains("document.activeElement"));
    }
}

