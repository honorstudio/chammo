//! 이 컴퓨터의 Chammo 데이터 폴더마다 어느 Chammo 계정으로 로그인됐나 — 기기 관리·다른 기기 참모 목록이 보여 준다(10-26:
//! 아이맥 시험판이 남의 계정에 붙어 있었는데 본판 화면에도 다른 기기에도 안 보였다). 폴더 이름·이메일·이름만 — 기기 id·열쇠는 안 낸다
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct HereAccount {
    /// 데이터 폴더 이름(.chammo · .chammo-team3)
    pub folder: String,
    /// 지금 이 앱이 쓰는 폴더
    pub current: bool,
    /// 로그인 안 했으면 빈 글(지금 폴더만 그렇게 남는다)
    pub email: String,
    pub name: String,
}

fn folder_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// 지금 폴더(맨 앞, 로그인 안 했어도) + 홈의 .chammo*·.honor-orchestrator* 중 로그인한 폴더
pub fn scan(home: &Path, current: &Path) -> Vec<HereAccount> {
    let row = |dir: &Path, cur: bool| {
        let a = crate::team_relay::load_state(dir).account.unwrap_or_default();
        HereAccount { folder: folder_name(dir), current: cur, email: a.email, name: a.name }
    };
    let mut out = vec![row(current, true)];
    let mut others: Vec<_> = std::fs::read_dir(home)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p != current && p.is_dir())
        .filter(|p| {
            let n = folder_name(p);
            n.starts_with(crate::config::DATA) || n.starts_with(crate::config::LEGACY)
        })
        .map(|p| row(&p, false))
        .filter(|a| !a.email.is_empty() || !a.name.is_empty())
        .collect();
    others.sort_by(|a, b| a.folder.cmp(&b.folder));
    out.extend(others);
    out
}

/// 이 앱 기준
pub fn here() -> Vec<HereAccount> {
    scan(Path::new(&crate::config::home()), crate::config::data_dir())
}

#[cfg(test)]
#[path = "chammo_here_tests.rs"]
mod tests;
