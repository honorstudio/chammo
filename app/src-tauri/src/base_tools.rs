//! 맥 기본 도구 — 명령줄 도구(CLT)가 없는 맥에서 앱이 파이썬·git 을 <데이터>/tools 에 받는다(ADR 0027, 사용자 11-05 '웬만하면 다 자동으로').
//! /usr/bin/git·python3 은 CLT 가 없으면 설치 창을 띄우는 껍데기다. Claude Code 는 세션을 켤 때마다 저장소 밖에서도 git 을 부르고(rev-parse·config·status — 11-05 실측),
//! scripts/* 는 #!/usr/bin/env python3 이라, 앱 PATH 맨 앞 tools/bin 에 진짜 파이썬 링크와 git 대리(아래 git_wrapper)를 둔다.
//! git 은 처음 필요할 때 받는다 — 저장소 밖 읽기 명령엔 '저장소 아님'으로 답하고, 저장소 안이거나 만드는 명령이면 받아서 잇는다. CLT 가 있는 맥은 아무것도 안 바뀐다.
//! 받기·풀기는 앱과 git 대리가 같이 쓰는 셸 스크립트 하나(chammo-get-tool, curl·shasum·tar 는 CLT 없이도 있는 시스템 도구). 받은 압축은 박아 둔 sha256 과 맞아야만 쓴다
use std::path::{Path, PathBuf};

/// (도구, uname -m, 주소, sha256) — 판을 올릴 땐 GitHub 릴리스 digest 와 받은 파일 shasum 을 둘 다 대조하고 실행·복제까지 본다
pub type Pin = (&'static str, &'static str, &'static str, &'static str);
pub const PINS: [Pin; 4] = [
    ("python", "arm64", "https://github.com/astral-sh/python-build-standalone/releases/download/20261026/cpython-3.12.16%2B20261026-aarch64-apple-darwin-install_only_stripped.tar.gz", "353d5f1b4fd2715e7053f12f068435d5bbad16b91e057006b5d01e0925709a7e"),
    ("python", "x86_64", "https://github.com/astral-sh/python-build-standalone/releases/download/20261026/cpython-3.12.16%2B20261026-x86_64-apple-darwin-install_only_stripped.tar.gz", "37c38fda76fec1fbf310adcbafb7f0d96af13b5511bf8ea954c3aa8eec185734"),
    ("git", "arm64", "https://github.com/desktop/dugite-native/releases/download/v2.56.0-2/dugite-native-v2.56.0-a44aeca-macOS-arm64.lzma", "0db3bc84019b9241a1ec86b5d5855e74f59fc289347584605874c0792c0bb97c"),
    ("git", "x86_64", "https://github.com/desktop/dugite-native/releases/download/v2.56.0-2/dugite-native-v2.56.0-a44aeca-macOS-x64.lzma", "b085ebfdcfd800e1e4c0f2040abfdbf7a7240bcf1c1c83982537c88f72d1ae70"),
];

const GET: &str = "chammo-get-tool";

fn sq(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// 도구 하나 받기 — 있으면 바로 끝, 동시에 불려도 한 번만 받고(자물쇠 폴더, 10분 넘은 건 죽은 것), 끝까지 맞아야 제자리로 옮긴다.
/// 종료 코드: 2 모르는 도구·기계 · 3 받기 실패 · 4 체크섬 다름 · 5 풀기·실행 실패 · 6 다른 쪽이 너무 오래 쥠
pub fn get_script(tools: &str, curl: &str, pins: &[Pin]) -> String {
    let cases: String = pins.iter().map(|(n, a, u, s)| format!("  {a}-{n}) url={}; sha={s} ;;\n", sq(u))).collect();
    format!(r#"#!/bin/sh
# Chammo — 맥 기본 도구 받기(base_tools.rs 가 만든다, 고치지 말 것)
T={tools}
name=$1
case "$name" in python) bin=python3 ;; git) bin=git ;; *) echo "unknown tool: $name" >&2; exit 2 ;; esac
case "$(/usr/bin/uname -m)-$name" in
{cases}  *) echo "no $name for this Mac" >&2; exit 2 ;;
esac
dest="$T/$name"
[ -x "$dest/bin/$bin" ] && exit 0
/bin/mkdir -p "$T"
lock="$T/.get-$name.lock"
i=0
until /bin/mkdir "$lock" 2>/dev/null; do
  [ -x "$dest/bin/$bin" ] && exit 0
  if [ -n "$(/usr/bin/find "$lock" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then /bin/rmdir "$lock" 2>/dev/null; continue; fi
  i=$((i + 1))
  [ "$i" -ge 600 ] && {{ echo "$name download is busy" >&2; exit 6; }}
  /bin/sleep 1
done
work="$T/.get-$name.$$"
trap '/bin/rm -rf "$work" "$lock"' EXIT
trap 'exit 130' INT TERM HUP
[ -x "$dest/bin/$bin" ] && exit 0  # 기다리는 동안 다른 쪽이 받았다 — 또 받으면 쓰는 중인 걸 지운다
/bin/mkdir -p "$work/x"
{curl} -fsSL --proto =https --proto-redir =https --retry 2 --retry-delay 2 --connect-timeout 20 --speed-limit 1024 --speed-time 60 -o "$work/a" "$url" || exit 3
got=$(/usr/bin/shasum -a 256 "$work/a" | /usr/bin/cut -d' ' -f1)
[ "$got" = "$sha" ] || {{ echo "$name download does not match the official file (checksum)" >&2; exit 4; }}
/usr/bin/tar -xf "$work/a" -C "$work/x" || exit 5
src="$work/x"
[ -d "$work/x/$name" ] && src="$work/x/$name"
"$src/bin/$bin" --version >/dev/null 2>&1 || {{ echo "$name does not run" >&2; exit 5; }}
/bin/rm -rf "$dest"
/bin/mv "$src" "$dest" || exit 5
"#, tools = sq(tools), curl = sq(curl), cases = cases)
}

/// tools/bin/git — 받은 git → (뒤에 깐) CLT → 아직 없으면: 저장소 밖 읽기 명령엔 진짜 git 과 같은 답, 저장소 안이거나 만드는 명령이면 받아서 잇는다
pub fn git_wrapper(tools: &str, xcode_select: &str) -> String {
    format!(r#"#!/bin/sh
# Chammo — 명령줄 도구 없는 맥의 git(base_tools.rs 가 만든다, 고치지 말 것). /usr/bin/git 은 설치 창을 띄우는 껍데기라 앞에 선다
T={tools}
if [ -x "$T/git/bin/git" ]; then
  GIT_EXEC_PATH="$T/git/libexec/git-core" GIT_TEMPLATE_DIR="$T/git/share/git-core/templates" exec "$T/git/bin/git" "$@"
fi
if {xcs} -p >/dev/null 2>&1; then exec /usr/bin/git "$@"; fi
dir=.; cmd=; words=0
scan() {{
  while [ $# -gt 0 ]; do
    case "$1" in
      -C) dir=$2; shift 2 ;;
      -c|--git-dir|--work-tree|--namespace) shift 2 ;;
      --version|-v) cmd=--version; return ;;
      -*) shift ;;
      *) cmd=$1; shift; break ;;
    esac
  done
  for a in "$@"; do case "$a" in -*) ;; *) words=$((words + 1)) ;; esac; done
}}
scan "$@"
[ "$cmd" = --version ] && {{ echo 'git version 2.56.0'; exit 0; }}
d=$(cd "$dir" 2>/dev/null && pwd -P)
repo=
while [ -n "$d" ]; do
  [ -e "$d/.git" ] && {{ repo=1; break; }}
  [ "$d" = / ] && break
  d=${{d%/*}}; [ -z "$d" ] && d=/
done
if [ -z "$repo" ]; then
  case "$cmd" in
    rev-parse|status|log|diff|show|ls-files|remote|branch|tag|symbolic-ref|describe|blame|shortlog|worktree|cat-file|for-each-ref|check-ignore|stash|grep|"")
      echo 'fatal: not a git repository (or any of the parent directories): .git' >&2; exit 128 ;;
    config) [ "$words" -lt 2 ] && exit 1 ;;
  esac
fi
"$T/bin/{get}" git >&2 || {{ echo 'git could not be downloaded. Check the internet connection and try again.' >&2; exit 1; }}
exec "$T/bin/git" "$@"
"#, tools = sq(tools), xcs = sq(xcode_select), get = GET)
}

/// 명령줄 도구가 있나 — 있으면 시스템 git·python3 이 진짜다. 시험은 CHAMMO_TEST_NO_CLT 로 '없는 맥'을 흉내 낸다(디버그 빌드만)
pub fn clt_present() -> bool {
    use std::sync::atomic::{AtomicBool, Ordering};
    #[cfg(debug_assertions)]
    if std::env::var_os("CHAMMO_TEST_NO_CLT").is_some() {
        return false;
    }
    static OK: AtomicBool = AtomicBool::new(false);
    if OK.load(Ordering::Relaxed) {
        return true;
    }
    let ok = crate::platform::command("/usr/bin/xcode-select").arg("-p").output().is_ok_and(|o| o.status.success());
    if ok {
        OK.store(true, Ordering::Relaxed);
    }
    ok
}

/// 앱이 도구를 챙겨야 하는 기기인가 — 맥이고 명령줄 도구가 없을 때만
pub fn needed() -> bool {
    cfg!(target_os = "macos") && !clt_present()
}

fn tools_of(data: &Path) -> PathBuf {
    data.join("tools")
}
pub fn own_python(data: &Path) -> PathBuf {
    tools_of(data).join("python/bin/python3")
}
pub fn own_git(data: &Path) -> PathBuf {
    tools_of(data).join("git/bin/git")
}

/// 파이썬을 쓸 수 있나(맥) — 명령줄 도구가 있거나 앱이 받았거나
pub fn python_ok(data: &Path) -> bool {
    !needed() || own_python(data).is_file()
}

/// 맥에서 쓸 파이썬 — 명령줄 도구가 있으면 지금까지처럼 시스템 것
pub fn python_path(data: &Path) -> PathBuf {
    if needed() { own_python(data) } else { PathBuf::from("/usr/bin/python3") }
}

/// tools/bin 에 대리 git·받기 스크립트·파이썬 링크를 쓴다 — 내용이 같으면 안 건드린다
#[cfg(unix)]
pub fn write_shims(data: &Path) -> std::io::Result<()> {
    let tools = tools_of(data);
    let bin = tools.join("bin");
    std::fs::create_dir_all(&bin)?;
    let t = tools.to_string_lossy();
    for (name, text) in [(GET, get_script(&t, crate::platform::curl(), &PINS)), ("git", git_wrapper(&t, "/usr/bin/xcode-select"))] {
        let p = bin.join(name);
        if std::fs::read_to_string(&p).ok().as_deref() != Some(text.as_str()) {
            std::fs::write(&p, text)?;
            crate::platform::make_executable(&p);
        }
    }
    for (link, to) in [("python3", "../python/bin/python3"), ("pip3", "../python/bin/pip3")] {
        let p = bin.join(link);
        if std::fs::read_link(&p).ok().as_deref() != Some(Path::new(to)) {
            let _ = std::fs::remove_file(&p);
            std::os::unix::fs::symlink(to, &p)?;
        }
    }
    Ok(())
}
#[cfg(not(unix))]
pub fn write_shims(_data: &Path) -> std::io::Result<()> {
    Ok(())
}

/// dir 를 PATH 맨 앞으로 — 이미 맨 앞이면 None
pub fn path_first(path: &str, dir: &str) -> Option<String> {
    if path.split(':').next() == Some(dir) {
        return None;
    }
    let rest: Vec<&str> = path.split(':').filter(|d| !d.is_empty() && *d != dir).collect();
    Some(if rest.is_empty() { dir.to_string() } else { format!("{dir}:{}", rest.join(":")) })
}

/// 켤 때 한 번(세션·데몬이 PATH 를 물려받기 전, 메인 스레드) — 명령줄 도구가 없는 맥만
pub fn adopt() {
    if !needed() {
        return;
    }
    let data = crate::config::data_dir();
    if let Err(e) = write_shims(data) {
        crate::claude::log_out("boot", &format!("base tools shims: {e}"));
    }
    let dir = tools_of(data).join("bin").to_string_lossy().into_owned();
    if let Some(p) = path_first(&std::env::var("PATH").unwrap_or_default(), &dir) {
        std::env::set_var("PATH", p);
    }
}

/// 설정 '코드 프로젝트에 git 쓰기'가 켜졌으면 git 을 뒤에서 받아 둔다 — 켤 때·설정을 저장할 때. 실패해도 조용히(처음 쓸 때 대리가 다시 받는다)
pub fn kick_git(git_on: bool) {
    if !git_on {
        return;
    }
    std::thread::spawn(|| {
        let data = crate::config::data_dir();
        if !needed() || own_git(data).is_file() {
            return;
        }
        let get = tools_of(data).join("bin").join(GET);
        let ok = crate::platform::command(get).arg("git").output().is_ok_and(|o| o.status.success());
        crate::claude::log_out("boot", &format!("base tools git {}", if ok { "ready" } else { "download failed — retried on first use" }));
    });
}

#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BaseTools {
    /// 맥이고 명령줄 도구가 없다 — 앱이 챙겨야 한다
    pub needed: bool,
    pub python: bool,
    pub git: bool,
    /// 받기 스크립트 — `<getter> python`
    pub getter: String,
}

/// 첫 설치·설정 점검 — 무엇을 받아야 하나. 받기는 웹이 숨은 터미널로 getter 를 돌린다(실패 줄을 그대로 받으려고)
#[tauri::command]
pub async fn base_tools() -> Result<BaseTools, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let data = crate::config::data_dir();
        let needed = needed();
        if needed {
            let _ = write_shims(data);
        }
        BaseTools { needed, python: own_python(data).is_file(), git: own_git(data).is_file(), getter: tools_of(data).join("bin").join(GET).to_string_lossy().into_owned() }
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(all(test, unix))]
#[path = "base_tools_tests.rs"]
mod tests;
