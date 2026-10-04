//! 테스트 픽스처 헬퍼.
//!
//! **실제 `~/.claude`를 읽는 테스트는 쓰지 않는다.** 머신마다 결과가 달라져
//! 아무것도 보장하지 못하기 때문이다(engineering-checklist: project-a 실데이터 의존 사고).
//! 픽스처를 임시 폴더로 복사해 쓰고, 테스트가 끝나면 통째로 사라진다.

use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub struct Fixture {
    _dir: tempfile::TempDir,
    pub home: PathBuf,
}

/// 픽스처 하네스를 임시 폴더에 복제하고 절대경로를 확정해 돌려준다.
pub fn load() -> Fixture {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/home");
    let dir = tempfile::tempdir().expect("임시 폴더 생성 실패");
    let home = dir.path().join("home");
    copy_tree(&src, &home);

    // git 저장소인 척할 최소 구조를 **여기서 짓는다.**
    // 픽스처에 `.git/` 을 파일로 두면 중첩 저장소가 되어 바깥 git 이 혼란스러워하고,
    // 빈 폴더는 커밋되지 않아 클론한 사람에게는 아예 없다 — 그러면 같은 테스트가
    // 머신마다 다른 결과를 낸다.
    let g = home.join("projects/proj-a/.git");
    fs::create_dir_all(g.join("refs/heads")).unwrap();
    fs::write(g.join("HEAD"), "ref: refs/heads/main\n").unwrap();
    fs::write(
        g.join("refs/heads/main"),
        "0123456789abcdef0123456789abcdef01234567\n",
    )
    .unwrap();

    // `.claude.json`의 자리표시자를 실제 경로로 바꾼다.
    for rel in [".claude.json", ".claude/plugins/installed_plugins.json"] {
        let p = home.join(rel);
        if let Ok(text) = fs::read_to_string(&p) {
            fs::write(&p, text.replace("FIXTURE_HOME", home.to_str().unwrap())).unwrap();
        }
    }

    Fixture { _dir: dir, home }
}

/// 심볼릭 링크를 **따라가지 않고 링크 그대로** 복사한다.
/// 깨진 링크가 깨진 채로 남아야 그걸 탐지하는 테스트가 성립한다.
fn copy_tree(src: &Path, dst: &Path) {
    for entry in WalkDir::new(src).follow_links(false) {
        let entry = entry.expect("픽스처 순회 실패");
        let rel = entry.path().strip_prefix(src).unwrap();
        let to = dst.join(rel);
        if entry.path_is_symlink() {
            let target = fs::read_link(entry.path()).unwrap();
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            std::os::unix::fs::symlink(target, &to).unwrap();
        } else if entry.file_type().is_dir() {
            fs::create_dir_all(&to).unwrap();
        } else {
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::copy(entry.path(), &to).unwrap();
        }
    }
}
