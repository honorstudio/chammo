# 하니터(Harnitor) 사본

참모 안에서 하니터 화면(하네스 — 스킬·훅·MCP·플러그인·CLAUDE.md — 보기·끄고 켜기·되돌리기)을 띄우려고 가져온 사본이다.

- 출처: `honorstudio/harnitor` (로컬 `~/Desktop/dev/Harnitor`), 가지 `chore/license-agpl`, 커밋 `a24b2f4d7e3ffad0caa3e9037122877e1847637b` → 진단 v2 `ecfd06bcb8bfac27fe09a2f99bf55ae13a6555e2`(가지 `feat/diagnostics-v2`, fix/undo-slot 위 — 되돌리기 고침 포함, 엔진·화면 통째)
- 라이선스: AGPL-3.0-only (`harnitor-core/LICENSE`) — 참모와 같다
- `harnitor-core/` = `crates/harnitor-core` 그대로(엔진: 스캔·진단·쓰기 계획·백업·되돌리기)
- `harnitor-ui/index.html` = `crates/harnitor-cli/templates/report.html` 그대로(화면). 하니터 앱은 이걸 `ui/index.html` 로 만들어 쓰고,
  참모는 `harnitor://` 로 내보내며 `/*__HARNITOR_DATA__*/` 자리에 다리 스크립트(`window.__TAURI__` 흉내 → postMessage)를 끼운다
- 안 가져온 것: CLI(`crates/harnitor-cli`), 하니터 앱 셸(`src-tauri` — 명령은 참모 `src/harnitor.rs` 로 옮겼다), AI 최적화(`ai_run.rs` — 참모가 대신한다)

## 고칠 때

- 원본을 먼저 고치고 여기로 다시 복사하는 게 원칙이다. 참모에서만 필요한 변경은 사본을 고치지 말고 다리(`src/harnitor.rs`)·부모 화면 쪽에서 한다
- 다시 복사: `git -C ~/Desktop/dev/Harnitor archive <커밋>:crates/harnitor-core | tar -x -C harnitor-core` 후 `Cargo.toml` 의 `workspace = true` 를 버전으로 다시 풀고 위 커밋 번호를 갱신
- 픽스처 6개(`.mcp.json`×4·`settings.local.json`·`CLAUDE.local.md`)는 예전엔 .gitignore 에 걸려 git 에 없어 `git archive` 로 빠졌다 — 진단 v2(eaa4986)에서 원본에 커밋돼 이제 같이 온다. **새 복사 때 참모 .gitignore 예외로 실제 추적되는지 `git ls-files` 로 확인**
- zsh 에서 `archive $C:crates/…` 는 `:c` 수식어로 깨진다 — `"${C}:crates/harnitor-core"` 로 쓴다

## 참모 사본에서 바꾼 것(원본과 다른 곳 — 다시 복사할 때 다시 적용)

- 테스트만: 심볼릭 링크를 `std::os::unix` 로 만드는 테스트(`src/write.rs` dead_link_tests, `tests/scan.rs`·`tests/write.rs`·`tests/diagnostics.rs`)를 `cfg(unix)` 로 — 윈도우에서 `cargo test` 가 컴파일조차 안 됐다(`cargo check -p harnitor-core --tests --target x86_64-pc-windows-msvc` 로 확인)
