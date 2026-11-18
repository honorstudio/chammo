//! 키즈 참모가 태어나고·지워지고·켜지고·꺼질 때(1단계 둘째 조각, 사용자 11-17).
//! - 참모가 새로 태어나거나(orch_roles::start_role) 지워지면(claude::remove_blocking) 키즈 칸을 지우고 아이 집은 kids/_archive/<키>-<시각>/ 으로 비킨다
//!   — 같은 이름의 새 참모에 옛 아이·설정이 안 붙고, 아이 기록·작품(보호자 기록)은 남는다
//! - 프로필에서 켜고 끄면 그 참모가 쉴 때 [앱] 한 줄로 알린다(일하는 중엔 기다림, 30분 넘으면 버림)
//! - 키즈 참모로 만들면 첫 인사도 키즈 판(폰·데스크톱 같은 글 — domain/orchIntro.test 가 대조)
use crate::kids;
use std::path::{Path, PathBuf};

/// 키즈 칸 지우기 + 아이 집 비키기. 무엇이든 했으면 Some(비킨 자리 또는 빈 경로)
pub fn retire_in(data: &Path, key: &str, now: u64) -> Result<Option<PathBuf>, String> {
    let Ok(key) = crate::avatar::safe_key(key) else { return Ok(None) };
    let had = kids::read_in(data).orchs.contains_key(&key);
    if had {
        kids::set_in(data, &key, None)?;
    }
    let home = data.join("kids").join(&key);
    if !home.is_dir() {
        return Ok(had.then(PathBuf::new));
    }
    let arch = data.join("kids").join("_archive");
    std::fs::create_dir_all(&arch).map_err(|e| e.to_string())?;
    let mut dst = arch.join(format!("{key}-{now}"));
    let mut n = 2;
    while dst.exists() {
        dst = arch.join(format!("{key}-{now}-{n}"));
        n += 1;
    }
    std::fs::rename(&home, &dst).map_err(|e| e.to_string())?;
    Ok(Some(dst))
}

/// 키즈 칸·아이 집을 비키고 아이 세션이 떠 있었으면 뒤에서 끈다 — 파일은 데이터 폴더만(set_orch_role 이 메인 스레드에서 부른다), 끄기는 다른 스레드
pub(crate) fn retire(data: &Path, key: &str, now: u64) {
    let id = kids::kid_dir(data, key).ok().and_then(|k| crate::kids_wire::read_session(&k)).map(|s| s.id);
    let r = retire_in(data, key, now);
    // 시험(임시 폴더)에선 세션을 끄거나 진짜 데이터 폴더 notify.log 에 쓰지 않는다
    if cfg!(test) {
        return;
    }
    if let Some(id) = id {
        std::thread::spawn(move || {
            let _ = crate::platform::command(crate::claude::claude_bin()).args(["stop", &id]).output();
        });
    }
    match r {
        Ok(Some(p)) => crate::claude::log_out("kids", &format!("키즈 칸 비킴 {key} → {}", p.display())),
        Ok(None) => {}
        Err(e) => crate::claude::log_out("kids", &format!("키즈 칸 못 비킴 {key}: {e}")),
    }
}

/// 키즈 참모 첫 인사(자기소개) — 보호자 얼굴이라는 걸 처음부터
pub fn intro(child: &str) -> String {
    let head = crate::i18n::tr(
        "[앱] 안녕! 너는 키즈 참모야 — 너와 말하는 사람은 아이의 보호자(어른)고, 아이는 따로 잠긴 아이 화면 세션과 이야기해. 네 이름과 맡은 일로 2~3줄 자기소개해 줘 — 보호자에게 무엇을 도와주는지(아이 대화 보기·아이 화면 규칙 정하기)와 시킬 일 예 하나. 영어 직함 없이 우리말로, 도구는 쓰지 말고, 질문으로 끝내지 마.",
        "[앱] Hi! You are a kids assistant — the person talking to you is the child's guardian (an adult); the child talks to a separate locked kids-screen session. Introduce yourself in 2-3 lines from your name and role — how you help the guardian (reading the child's chats, setting kids-screen rules) and one example of what to ask you. Write in English, don't use tools, and don't end with a question.",
    );
    with_child(head, child)
}

fn with_child(head: &str, child: &str) -> String {
    let c = kids::clean_child(child);
    if c.is_empty() { head.to_string() } else { format!("{head} {}{c}", crate::i18n::tr("아이 이름: ", "Child's name: ")) }
}

/// 프로필에서 켜고 끌 때 그 참모에게 가는 한 줄
pub fn notice(on: bool, child: &str) -> String {
    if on {
        with_child(crate::i18n::tr(
            "[앱] 이제 너는 키즈 참모야 — 너와 말하는 사람은 아이의 보호자(어른)고, 아이는 따로 잠긴 아이 화면 세션과 이야기해(그 세션에 말 걸지 마). 보호자가 아이 대화를 보거나 아이 화면 규칙을 정하는 걸 도와줘. 알았다고 한 줄로만 답해.",
            "[앱] You are now a kids assistant — the person talking to you is the child's guardian (an adult); the child talks to a separate locked kids-screen session (don't message it). Help the guardian read the child's chats and set kids-screen rules. Reply with one line that you got it.",
        ), child)
    } else {
        crate::i18n::tr("[앱] 이제 키즈 참모가 아니야 — 일반 참모로 돌아왔고 아이 화면 세션은 꺼졌어. 알았다고 한 줄로만 답해.", "[앱] You are no longer a kids assistant — back to a regular assistant, and the kids-screen session is off. Reply with one line that you got it.").to_string()
    }
}

fn hq_rows(agents_json: &str, hq: &str) -> Vec<serde_json::Value> {
    serde_json::from_str::<serde_json::Value>(agents_json).ok().and_then(|v| v.as_array().cloned()).unwrap_or_default().into_iter().filter(|a| crate::platform::same_dir(a["cwd"].as_str().unwrap_or(""), hq)).collect()
}

/// HQ 에서 도는 그 참모(이름 앞부분 = 키)의 번호 — 꺼진 건 빼고
pub fn orch_id_in(agents_json: &str, hq: &str, key: &str) -> Option<String> {
    hq_rows(agents_json, hq)
        .into_iter()
        .find(|a| crate::orch_roles::base_of(a["name"].as_str().unwrap_or("")) == key.trim() && !matches!(a["state"].as_str(), Some("stopped" | "failed" | "exited")))
        .and_then(|a| a["id"].as_str().map(str::to_string))
}

/// 지우는 세션이 HQ 참모면 그 키(아이 세션·프로젝트 세션은 None — 폴더가 HQ 가 아니다)
pub fn hq_key_of(agents_json: &str, hq: &str, id: &str) -> Option<String> {
    hq_rows(agents_json, hq).into_iter().find(|a| a["id"] == id).map(|a| crate::orch_roles::base_of(a["name"].as_str().unwrap_or("")).to_string()).filter(|k| !k.is_empty())
}

fn hq() -> String {
    crate::config::hq_dir(&crate::config::home(), &crate::config::current(), |k| std::env::var(k).ok())
}

/// 참모를 지울 때(remove_blocking 이 rm 하기 전에) — 그 참모가 키즈 칸을 갖고 있으면 비킨다
pub(crate) fn on_remove(id: &str) {
    let Ok(all) = crate::claude::agents_json_all() else { return };
    if let Some(key) = hq_key_of(&all, &hq(), id) {
        let data = crate::config::data_dir();
        if kids::read_in(data).orchs.contains_key(&key) || kids::kid_dir(data, &key).is_ok_and(|k| k.is_dir()) {
            retire(data, &key, crate::notes::now_ms());
        }
    }
}

/// 그 참모가 쉴 때 한 줄 보내기 — 5초마다 보고 30분 넘으면 버린다(뒤 스레드)
pub(crate) fn notify_when_idle(key: String, text: String) {
    std::thread::spawn(move || {
        for _ in 0..360 {
            crate::claude::forget_agents();
            if let Ok(j) = crate::claude::agents_json() {
                if let Some(id) = orch_id_in(&j, &hq(), &key) {
                    if !crate::mobile_http::session_busy(&j, &id) {
                        let _ = crate::claude::type_text_tagged(&id, &text, "kids-notice");
                        return;
                    }
                } else {
                    return; // 그 참모가 없다(꺼짐)
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(5));
        }
        crate::claude::log_out("kids", &format!("키즈 알림 못 보냄(30분 내내 일하는 중) {key}"));
    });
}

/// 폰에서 깨울 때 첫 인사 — 키즈 참모면 키즈 판
pub(crate) fn intro_for(name: &str) -> Option<String> {
    let key = crate::orch_roles::base_of(name);
    let data = crate::config::data_dir();
    kids::is_kids(data, crate::config::current().features.kids, key).then(|| intro(&kids::read_in(data).orchs.get(key).map(|o| o.child.clone()).unwrap_or_default()))
}

#[cfg(test)]
#[path = "kids_life_tests.rs"]
mod tests;
