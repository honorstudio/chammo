//! 가벼운 모드끼리 클로드 호스트 하나 같이 쓰기(ADR 0006) — 누가 같이 쓰나·모드별로 거르기·밀림 나누기·다시 띄울 목록.
//! 선언(chammo.json "light": true)이 먼저, 글 검사는 거부권만 — 틀려도 덜 아픈 쪽(자기 호스트)이 기본. 프로세스는 modes_host.rs
use serde_json::Value;
use std::path::Path;

/// 같이 쓰는 호스트 키 — 모드 이름은 점으로 시작할 수 없어(modes::safe_name) 어떤 모드 이름과도 안 겹친다.
/// 작업 폴더 <데이터>/modes/.light/run 은 모드 run 과 깊이가 같아 `../../../tasks.jsonl` 같은 상대 경로가 그대로 맞는다
pub const KEY: &str = ".light";

/// 같은 호스트에 올려도 되는 `$.` 이름 — 모델·세션·프로세스·네트워크를 안 건드리는 것만
pub const ALLOWED: &[&str] = &["clock", "env", "fs", "store", "ui"];

/// 모드 글(소스 파일들)에서 허용 밖 `$.` 이름 → 까닭 한 줄. `$[…]` 처럼 이름을 못 읽는 꼴도 거부
pub fn veto(texts: &[&str]) -> Option<String> {
    for t in texts {
        let c: Vec<char> = t.chars().collect();
        for i in 0..c.len() {
            // `x$.` 처럼 이름 끝 $ 는 남의 이름이다
            if c[i] != '$' || (i > 0 && is_ident(c[i - 1])) {
                continue;
            }
            match c.get(i + 1) {
                Some('.') => {
                    let name: String = c[i + 2..].iter().take_while(|x| is_ident(**x)).collect();
                    if !name.is_empty() && !ALLOWED.contains(&name.as_str()) {
                        return Some(format!("uses $.{name}"));
                    }
                }
                Some('[') => return Some("uses $[…] (name not readable)".into()),
                _ => {}
            }
        }
    }
    None
}

fn is_ident(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '$'
}

/// `const NAME = 'x'` 의 'x' — 모든 파일에서
fn const_str(texts: &[&str], name: &str) -> Option<String> {
    for t in texts {
        let mut from = 0;
        while let Some(at) = t[from..].find("const ").map(|i| from + i) {
            from = at + 6;
            let rest = t[from..].trim_start();
            let Some(after) = rest.strip_prefix(name) else { continue };
            if after.chars().next().is_some_and(is_ident) {
                continue;
            }
            let Some(v) = after.trim_start().strip_prefix('=') else { continue };
            if let Some(s) = quoted(v.trim_start()) {
                return Some(s);
            }
        }
    }
    None
}

/// '…' 또는 "…" 로 시작하면 그 안 글
fn quoted(t: &str) -> Option<String> {
    let q = t.chars().next().filter(|c| *c == '\'' || *c == '"')?;
    let body = &t[1..];
    body.find(q).map(|end| body[..end].to_string())
}

/// 모드가 여는 칸 id — `$.ui.open({ id: 'x' …` 또는 `id: NAME` + `const NAME = 'x'`. 못 읽는 id 가 하나라도 있으면 Err(까닭)
pub fn pane_ids(texts: &[&str]) -> Result<Vec<String>, String> {
    const OPEN: &str = "$.ui.open(";
    let mut out: Vec<String> = Vec::new();
    for t in texts {
        let mut from = 0;
        while let Some(at) = t[from..].find(OPEN).map(|i| from + i) {
            from = at + OPEN.len();
            let obj = t[from..].trim_start();
            let unreadable = || Err::<Vec<String>, String>(format!("pane id not readable: {}", t[at..].chars().take(60).collect::<String>()));
            let Some(obj) = obj.strip_prefix('{') else { return unreadable() };
            let obj = &obj[..obj.find('}').unwrap_or(obj.len())];
            // 첫 `id` 열쇠(앞이 이름 글자가 아닌 것) 뒤 ':'
            let key = obj.match_indices("id").find(|(i, _)| !obj[..*i].chars().last().is_some_and(is_ident) && obj[i + 2..].trim_start().starts_with(':'));
            let Some((i, _)) = key else { return unreadable() };
            let v = obj[i + 2..].trim_start()[1..].trim_start();
            let id = if let Some(s) = quoted(v) {
                s
            } else {
                let name: String = v.chars().take_while(|c| is_ident(*c)).collect();
                let tail = v[name.len()..].trim_start();
                if name.is_empty() || !(tail.is_empty() || tail.starts_with(',')) {
                    return unreadable();
                }
                match const_str(texts, &name) {
                    Some(s) => s,
                    None => return unreadable(),
                }
            };
            if !out.contains(&id) {
                out.push(id);
            }
        }
    }
    Ok(out)
}

/// 호스트 키를 정할 모드 하나 — 목록 순서대로 넘긴다(앞의 것이 자리를 먼저 잡는다)
#[derive(Debug, Clone)]
pub struct Cand {
    pub name: String,
    /// plugin.json name — 밀림·칸에 붙어 오는 이름
    pub plugin: String,
    /// chammo.json "light": true
    pub light: bool,
    pub veto: Option<String>,
    pub ids: Result<Vec<String>, String>,
}

/// 모드 → (호스트 키, 같이 못 쓴 까닭). 선언 안 한 모드는 까닭 없이 자기 이름
pub fn keys(cands: &[Cand]) -> Vec<(String, String, Option<String>)> {
    let mut ids: Vec<(&str, &str)> = Vec::new(); // (칸 id, 모드)
    let mut plugins: Vec<(&str, &str)> = Vec::new();
    cands
        .iter()
        .map(|c| {
            let own = |why: String| (c.name.clone(), c.name.clone(), Some(why));
            if !c.light {
                return (c.name.clone(), c.name.clone(), None);
            }
            if let Some(v) = &c.veto {
                return own(v.clone());
            }
            let mine = match &c.ids {
                Ok(v) => v,
                Err(e) => return own(e.clone()),
            };
            if let Some((_, by)) = plugins.iter().find(|(p, _)| *p == c.plugin) {
                return own(format!("plugin name {} also used by {by}", c.plugin));
            }
            if let Some((id, by)) = ids.iter().find(|(id, _)| mine.iter().any(|m| m == id)) {
                return own(format!("pane id '{id}' also used by {by}"));
            }
            plugins.push((&c.plugin, &c.name));
            ids.extend(mine.iter().map(|m| (m.as_str(), c.name.as_str())));
            (c.name.clone(), KEY.to_string(), None)
        })
        .collect()
}

/// 같이 쓰는 호스트의 칸 목록에서 이 모드 것만
pub fn panes_of(panes: &[Value], plugin: &str) -> Vec<Value> {
    panes.iter().filter(|p| p.get("plugin").and_then(Value::as_str) == Some(plugin)).cloned().collect()
}

/// 이 모드가 보일 칸 — 호스트가 마지막에 연 칸(shown_id)이 이 모드 것이면 그것, 아니면 첫 칸
pub fn shown_of(mine: &[Value], host_shown: Option<&str>) -> Option<String> {
    let id = |p: &Value| p.get("id").and_then(Value::as_str).map(str::to_string);
    host_shown.filter(|s| mine.iter().any(|p| id(p).as_deref() == Some(*s))).map(str::to_string).or_else(|| mine.first().and_then(id))
}

/// 밀림 하나를 받을 모드들 — plugin 이 붙어 오면 그 모드, instances 가 오면 그 칸 주인, 모르면 모두. members = (모드, 플러그인)
pub fn targets(push: &Value, members: &[(String, String)], panes: &[Value]) -> Vec<String> {
    let plugins: Vec<&str> = if let Some(p) = push.get("plugin").and_then(Value::as_str) {
        vec![p]
    } else if let Some(ins) = push.get("instances").and_then(Value::as_array) {
        let owner = |id: &Value| panes.iter().find(|p| p.get("id") == Some(id)).and_then(|p| p.get("plugin")).and_then(Value::as_str);
        ins.iter().filter_map(owner).collect()
    } else {
        vec![]
    };
    let hit: Vec<String> = members.iter().filter(|(_, p)| plugins.contains(&p.as_str())).map(|(n, _)| n.clone()).collect();
    if hit.is_empty() {
        members.iter().map(|(n, _)| n.clone()).collect()
    } else {
        hit
    }
}

#[derive(Debug, PartialEq)]
pub enum Plan {
    /// 지금 호스트 그대로
    Keep,
    /// 켜진 가벼운 모드가 없다 — 끈다
    Stop,
    /// 이 목록으로 새로 띄운다(떠 있던 건 새 것이 붙은 뒤 끈다)
    Start(Vec<String>),
}

/// running = 살아 있는 호스트에 올라간 모드(없으면 None), wanted = 켜져 있고 안 잠든 가벼운 모드(목록 순)
pub fn plan(running: Option<&[String]>, wanted: &[String]) -> Plan {
    match running {
        _ if wanted.is_empty() && running.is_some() => Plan::Stop,
        _ if wanted.is_empty() => Plan::Keep,
        Some(r) if r == wanted => Plan::Keep,
        _ => Plan::Start(wanted.to_vec()),
    }
}

/// 글 검사에 넣을 소스 파일 — 모드 폴더 아래 .ts·.tsx·.js·.jsx·.mjs(시험·node_modules 빼고). 많아도 200개까지만 읽고 넘치면 None(= 같이 못 씀)
pub fn read_texts(dir: &Path) -> Option<Vec<String>> {
    const MAX: usize = 200;
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).ok()?.flatten() {
            let p = e.path();
            let n = e.file_name().to_string_lossy().into_owned();
            if p.is_dir() {
                if n != "node_modules" && n != ".git" {
                    stack.push(p);
                }
                continue;
            }
            let src = [".ts", ".tsx", ".js", ".jsx", ".mjs"].iter().any(|x| n.ends_with(x));
            if !src || n.contains(".test.") || n.contains(".spec.") {
                continue;
            }
            if out.len() == MAX {
                return None;
            }
            out.push(std::fs::read_to_string(&p).unwrap_or_default());
        }
    }
    Some(out)
}

/// 모드 하나 → 판단 재료. 예시는 앱 안 사본에서(풀기 전에도), 그 밖은 폴더에서. 플러그인 이름은 plugin.json name(없으면 모드 이름)
pub fn cand(info: &crate::modes::ModeInfo) -> Cand {
    let embedded = crate::modes::EXAMPLES.iter().find(|(n, _)| info.source == "example" && *n == info.name).map(|(_, f)| *f);
    let texts: Option<Vec<String>> = match embedded {
        Some(files) => {
            let src = |p: &str| [".ts", ".tsx", ".js", ".jsx", ".mjs"].iter().any(|x| p.ends_with(x)) && !p.contains(".test.");
            Some(files.iter().filter(|(p, _)| src(p)).map(|(_, b)| b.to_string()).collect())
        }
        None => read_texts(Path::new(&info.dir)),
    };
    let plugin = crate::modes::plugin_name(info);
    let (veto, ids) = match &texts {
        Some(t) => {
            let t: Vec<&str> = t.iter().map(String::as_str).collect();
            (veto(&t), pane_ids(&t))
        }
        None => (Some("too many source files to check".into()), Ok(vec![])),
    };
    Cand { name: info.name.clone(), plugin, light: info.light, veto, ids }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cand(name: &str, light: bool, ids: &[&str]) -> Cand {
        Cand { name: name.into(), plugin: name.into(), light, veto: None, ids: Ok(ids.iter().map(|s| s.to_string()).collect()) }
    }

    #[test]
    fn 허용_밖_달러_이름이_보이면_같이_못_쓴다() {
        assert_eq!(veto(&["const t = await $.store.get('k'); $.ui.open({ id: 'a' }); $.clock.every(60_000, f); $.fs.read(p); $.env.get('X')"]), None);
        assert!(veto(&["$.ui.open({id:'a'})", "const r = await $.model.complete('hi')"]).unwrap().contains("$.model"));
        assert!(veto(&["await $.process.run('ls')"]).unwrap().contains("$.process"));
        assert!(veto(&["await $.http.fetch(u)"]).unwrap().contains("$.http"));
        assert!(veto(&["const k = 'model'; $[k].complete()"]).is_some(), "이름을 못 읽는 꼴");
        assert_eq!(veto(&["const s = `${a}.${b}`; const x$ = 1; a$.model"]), None, "템플릿 ${{…}}·이름 끝 $ 는 $. 가 아니다");
        assert!(veto(&["on('x', async ($, e) => { const m = $ .model })"]).is_none(), "띄어 쓴 건 못 본다 — 글 검사는 거부권일 뿐(선언이 먼저)");
    }

    #[test]
    fn 칸_id_는_글자와_상수에서_읽고_못_읽으면_거절() {
        assert_eq!(pane_ids(&["void $.ui.open({ id: 'calendar', title: '달력' })"]), Ok(vec!["calendar".to_string()]));
        assert_eq!(pane_ids(&["const PANE = 'todo'\n void $.ui.open({ id: PANE, title: '할 일' })"]), Ok(vec!["todo".to_string()]));
        assert_eq!(pane_ids(&["export const PANE = \"board\"", "$.ui.open({id: PANE})"]), Ok(vec!["board".to_string()]), "다른 파일 상수·큰따옴표");
        assert_eq!(pane_ids(&["$.ui.open({ id: 'a' }); $.ui.open({ id: 'b' }); $.ui.open({ id: 'a' })"]), Ok(vec!["a".to_string(), "b".to_string()]));
        assert!(pane_ids(&["$.ui.open({ id: `p${n}` })"]).is_err(), "글자 틀");
        assert!(pane_ids(&["$.ui.open({ id: makeId() })"]).is_err());
        assert!(pane_ids(&["$.ui.open(opts)"]).is_err(), "id 를 못 본다");
        assert_eq!(pane_ids(&["on('ui.render', …)"]), Ok(vec![]), "칸을 안 여는 모드");
    }

    #[test]
    fn 선언한_모드만_같이_쓰고_선언_없으면_지금처럼_자기_호스트() {
        let k = keys(&[cand("a", true, &["a"]), cand("b", false, &["b"]), cand("c", true, &["c"])]);
        assert_eq!(k.iter().map(|(n, key, why)| (n.as_str(), key.as_str(), why.is_some())).collect::<Vec<_>>(), [("a", KEY, false), ("b", "b", false), ("c", KEY, false)]);
    }

    #[test]
    fn 선언했어도_금지_이름이면_자기_호스트에_까닭() {
        let mut c = cand("ai", true, &["ai"]);
        c.veto = Some("uses $.model".into());
        let k = keys(&[c]);
        assert_eq!((k[0].1.as_str(), k[0].2.as_deref()), ("ai", Some("uses $.model")));
        let mut c = cand("dyn", true, &[]);
        c.ids = Err("pane id not readable".into());
        assert_eq!(keys(&[c])[0].1, "dyn", "칸 id 를 못 읽으면 겹침을 못 보니 자기 호스트");
    }

    #[test]
    fn 칸_id_나_플러그인_이름이_겹치면_뒤_것이_자기_호스트() {
        let mut copy = cand("my-todo", true, &["todo"]);
        copy.plugin = "my-todo".into();
        let mut same_plugin = cand("todo-2", true, &["todo2"]);
        same_plugin.plugin = "home-todo".into();
        let k = keys(&[cand("home-todo", true, &["todo"]), copy, same_plugin, cand("board", true, &["board"])]);
        assert_eq!(k[0].1, KEY);
        assert_eq!(k[1].1, "my-todo");
        assert!(k[1].2.as_deref().unwrap().contains("todo"), "{:?}", k[1].2);
        assert_eq!(k[2].1, "todo-2", "같은 플러그인 이름이면 칸·밀림을 못 가른다");
        assert_eq!(k[3].1, KEY, "겹친 건 빠지고 나머지는 그대로 같이");
        // 겹치는 상대가 선언 안 한 모드면 다른 호스트라 상관없다
        let k = keys(&[cand("heavy", false, &["todo"]), cand("home-todo", true, &["todo"])]);
        assert_eq!(k[1].1, KEY);
    }

    #[test]
    fn 모드별로_칸을_거른다() {
        let panes = vec![json!({"id": "calendar", "title": "달력", "plugin": "home-calendar"}), json!({"id": "board", "title": "현황판", "plugin": "home-board"}), json!({"id": "b2", "plugin": "home-board"})];
        assert_eq!(panes_of(&panes, "home-board").iter().map(|p| p["id"].as_str().unwrap()).collect::<Vec<_>>(), ["board", "b2"]);
        assert!(panes_of(&panes, "home-todo").is_empty());
        let mine = panes_of(&panes, "home-board");
        assert_eq!(shown_of(&mine, Some("b2")).as_deref(), Some("b2"));
        assert_eq!(shown_of(&mine, Some("calendar")).as_deref(), Some("board"), "남의 칸이 마지막에 열렸으면 내 첫 칸");
        assert_eq!(shown_of(&mine, None).as_deref(), Some("board"));
        assert_eq!(shown_of(&[], Some("calendar")), None);
    }

    #[test]
    fn 밀림은_플러그인_칸_주인에게만_모르면_모두() {
        let m = vec![("cal".to_string(), "home-calendar".to_string()), ("todo".to_string(), "home-todo".to_string())];
        let panes = vec![json!({"id": "calendar", "plugin": "home-calendar"}), json!({"id": "todo", "plugin": "home-todo"})];
        assert_eq!(targets(&json!({"subtype": "ui_toast", "plugin": "home-todo", "text": "x"}), &m, &panes), ["todo"]);
        assert_eq!(targets(&json!({"subtype": "ui_invalidate", "instances": ["calendar"]}), &m, &panes), ["cal"]);
        assert_eq!(targets(&json!({"subtype": "ui_invalidate", "instances": ["calendar", "todo"]}), &m, &panes), ["cal", "todo"]);
        assert_eq!(targets(&json!({"subtype": "ui_panes", "panes": []}), &m, &panes), ["cal", "todo"]);
        assert_eq!(targets(&json!({"subtype": "exit"}), &m, &panes), ["cal", "todo"]);
        assert_eq!(targets(&json!({"subtype": "ui_toast", "plugin": "stranger"}), &m, &panes), ["cal", "todo"], "모르는 플러그인이면 모두");
        assert_eq!(targets(&json!({"subtype": "ui_invalidate", "instances": ["gone"]}), &m, &panes), ["cal", "todo"], "모르는 칸이면 모두");
    }

    #[test]
    fn 목록이_바뀔_때만_다시_띄운다() {
        let v = |xs: &[&str]| xs.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(plan(Some(&v(&["a", "b"])), &v(&["a", "b"])), Plan::Keep);
        assert_eq!(plan(Some(&v(&["a", "b"])), &v(&["a", "b", "c"])), Plan::Start(v(&["a", "b", "c"])), "하나 켬");
        assert_eq!(plan(Some(&v(&["a", "b"])), &v(&["b"])), Plan::Start(v(&["b"])), "하나 끔 — 나머지는 새 호스트로 산다");
        assert_eq!(plan(Some(&v(&["a"])), &[]), Plan::Stop);
        assert_eq!(plan(None, &[]), Plan::Keep, "떠 있는 것도 켤 것도 없다");
        assert_eq!(plan(None, &v(&["a", "b"])), Plan::Start(v(&["a", "b"])), "호스트가 죽었으면 다 같이 다시");
    }

    #[test]
    fn 맛보기_넷은_한_호스트에_같이_올라간다() {
        let all = crate::modes::discover(&std::env::temp_dir().join("chammo-light-none"), &Value::Null);
        let try4: Vec<Cand> = all.iter().filter(|m| crate::modes::HOME_TRY.contains(&m.name.as_str())).map(super::cand).collect();
        assert_eq!(try4.len(), 4);
        for c in &try4 {
            assert_eq!((c.veto.as_deref(), c.ids.as_ref().map(|v| v.len())), (None, Ok(1)), "{} — {:?}", c.name, c.ids);
            assert_eq!(c.plugin, c.name, "예시 플러그인 이름 = 모드 이름");
        }
        assert!(keys(&try4).iter().all(|(_, k, _)| k == KEY), "{:?}", keys(&try4));
    }

    #[test]
    fn 소스_파일만_읽고_시험_node_modules_는_뺀다() {
        let d = std::env::temp_dir().join(format!("chammo-light-texts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        for (rel, body) in [("hooks/register.tsx", "$.ui"), ("hooks/kit.ts", "$.store"), ("hooks/a.test.tsx", "$.model"), ("node_modules/x/i.js", "$.http"), ("README.md", "$.process"), ("src/deep/m.mjs", "$.clock")] {
            let p = d.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        }
        let mut got = read_texts(&d).unwrap();
        got.sort();
        assert_eq!(got, ["$.clock", "$.store", "$.ui"]);
        for i in 0..201 {
            std::fs::write(d.join(format!("hooks/f{i}.ts")), "").unwrap();
        }
        assert_eq!(read_texts(&d), None, "너무 많으면 같이 못 쓴다");
        let _ = std::fs::remove_dir_all(&d);
    }
}
