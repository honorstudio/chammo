#!/usr/bin/env python3
"""첫 설치 실측 — 진짜 시험 앱(디버그 빌드)을 빈 HOME·빈 CHAMMO_HOME 으로, 명령줄 도구가 없는 맥처럼(CHAMMO_TEST_NO_CLT) 띄워 처음부터 끝까지.
진짜로 받는 것: 파이썬·Claude Code·브라우저 부품·git(새 프로젝트 --git 때). 가짜인 것: 브라우저(사람이 허용을 누른 셈 치고 claude auth status 만 '됨'으로 바꾼다).
장면: ① 망이 막힌 채 시작 → '인터넷' 안내, 끔 ② 다시 켜면 시작 없이 준비부터, Claude 받는 중 끔 ③ 다시 켜면 이어서 끝까지 → 로그인 → 끝 → 메인 창.
창은 가짜 화면(Chammo agents)에만 둔다 — 사용자 화면에 안 띄운다. 맨 앞 앱은 lsappinfo 로 지킨다.

python3 app/e2e/first-run/real.py <디버그 실행 파일> [캡처·기록 폴더]
"""
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, "../.."))
BIN = sys.argv[1]
OUT = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else os.path.join(APP, "../.shots/onboarding/real"))
REAL_HOME = os.path.expanduser("~")
os.makedirs(OUT, exist_ok=True)
# 저장소 밖 자리 — ~/.claude 는 git 저장소일 수 있어 그 아래면 git 대리가 '저장소 안'으로 본다
S = tempfile.mkdtemp(prefix="chammo-fr-real-", dir="/tmp")
S = os.path.realpath(S)
HOME = os.path.join(S, "home")
DATA = os.path.join(HOME, ".chammo-fr")  # .chammo 면 진짜 폴더로 쳐서 launchd 를 건다(config::is_real_data)
os.makedirs(HOME)
failed = 0
log = open(os.path.join(OUT, "run.log"), "w")


def say(*a):
    t = " ".join(str(x) for x in a)
    print(t, flush=True)
    log.write(t + "\n")
    log.flush()


def ok(name, cond, extra=""):
    global failed
    failed += 0 if cond else 1
    say(("ok  " if cond else "FAIL"), name, ("— " + str(extra)) if extra else "")


# 가짜 화면 자리 — 없으면 시작하지 않는다
vd = json.load(open(os.path.join(REAL_HOME, ".honor-orchestrator/browser/vdisplay.json")))
os.kill(vd["pid"], 0)
SPOT = f'{int(vd["bounds"][0]) + 60},{int(vd["bounds"][1]) + 60}'

# 가짜 브라우저 — auth login 이 부른다. 사람이 허용을 누른 셈: 잠깐 뒤 claude auth status 만 '됨'으로
browser = os.path.join(S, "fake-browser")
with open(browser, "w") as f:
    f.write(f"""#!/bin/sh
echo "$1" >> '{S}/browser.log'
(
  sleep 8
  c='{HOME}/.local/bin/claude'
  real=$(/usr/bin/readlink -f "$c" 2>/dev/null || echo "$c")
  rm -f "$c"
  printf '#!/bin/sh\\ncase "$1 $2" in "auth status") echo "{{\\\\"loggedIn\\\\":true}}";; *) exec "%s" "$@";; esac\\n' "$real" > "$c"
  chmod +x "$c"
) >/dev/null 2>&1 &
""")
os.chmod(browser, 0o755)

BASE = {k: v for k, v in os.environ.items() if k in ("USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "__CF_USER_TEXT_ENCODING")}
BASE.update(HOME=HOME, CHAMMO_HOME=DATA, SHELL="/bin/zsh", PATH="/usr/bin:/bin:/usr/sbin:/sbin", CHAMMO_TEST_NO_CLT="1", BROWSER=browser, CHAMMO_VDISPLAY="0",
            CHAMMO_DEV_WINDOW=SPOT, HONOR_ORCH_DEBUG_JS=os.path.join(S, "drive.js"), HONOR_ORCH_DEBUG_REPEAT="1", HONOR_ORCH_DEBUG_OUT=os.path.join(S, "dump"),
            CHAMMO_PERF_VISIBLE="1", CHAMMO_ACCOUNT_LIVE_SERVICE="chammo-fr-real-claude")

DRIVE = """(async()=>{
 const I=window.__TAURI_INTERNALS__&&window.__TAURI_INTERNALS__.invoke; if(!I)return;
 const fr=document.querySelector('.fr');
 const fail=document.querySelector('.fr-fail');const s={t:Date.now(),why:fail?fail.title:'',fr:!!fr,cls:fr?fr.className:'',text:(fr||document.body).innerText.slice(0,500),w:innerWidth,h:innerHeight,xterm:document.querySelectorAll('.xterm').length,gate:!!document.querySelector('.lg-gate'),click:''};
 const want=%s;
 for(const b of document.querySelectorAll('.fr button')){const n=(b.textContent||'').trim()||b.getAttribute('aria-label')||''; if(!b.disabled&&want.includes(n)){window.__clicks=(window.__clicks||0)+1;b.click();s.click=n;break;}}
 s.run=await I('browser_setup_state').then((r)=>(r.step||'')+' '+(r.text||''),()=>'');
 await I('debug_dump',{name:'state',text:JSON.stringify(s)}).catch(()=>{});
 if(s.click) await I('debug_dump',{name:'click-'+Date.now(),text:s.click}).catch(()=>{});
 if(fail){const st=await I('browser_status').catch(String);const ru=await I('browser_setup_state').catch(String);await I('debug_dump',{name:'fail',text:JSON.stringify({st,ru},null,1)}).catch(()=>{});}
})()"""


def drive(*want):
    with open(os.path.join(S, "drive.js"), "w") as f:
        f.write(DRIVE % json.dumps(list(want), ensure_ascii=False))


def state():
    try:
        return json.load(open(os.path.join(S, "dump/state.txt")))
    except (OSError, ValueError):
        return {}


def wait(pred, secs, what):
    end = time.time() + secs
    seen = None
    while time.time() < end:
        s = state()
        if s and pred(s):
            return s
        # 단계가 바뀔 때마다 시각 — 어디서 오래 걸리나 보려고
        now = (" ".join(l for l in s.get("text", "").split("\n") if "개 중" in l or "설치 중" in l or "준비 중" == l), s.get("run", "").split(" (")[0])
        if now != seen:
            seen = now
            say(f"  {time.strftime('%H:%M:%S')} {now[0]} | {now[1]}")
        time.sleep(1)
    say("  시간 초과:", what, "| 지금:", json.dumps(state(), ensure_ascii=False)[:300])
    return None


class Front(threading.Thread):
    """시험 앱이 맨 앞이 되면 사람이 쓰던 앱으로 되돌린다"""

    def __init__(self):
        super().__init__(daemon=True)
        self.pid = None
        self.stop = False
        self.back = self.front_path()

    @staticmethod
    def front_pid():
        o = subprocess.run(["lsappinfo", "info", "-only", "pid", subprocess.run(["lsappinfo", "front"], capture_output=True, text=True).stdout.strip()], capture_output=True, text=True).stdout
        return int(o.split("=")[-1]) if "=" in o and o.split("=")[-1].strip().isdigit() else None

    def front_path(self):
        p = self.front_pid()
        if not p:
            return None
        c = subprocess.run(["ps", "-o", "comm=", "-p", str(p)], capture_output=True, text=True).stdout.strip()
        i = c.find(".app/")
        return c[: i + 4] if i > 0 else None

    def run(self):
        while not self.stop:
            if self.pid and self.back and self.front_pid() == self.pid:
                subprocess.run(["open", "-a", self.back], capture_output=True)
            time.sleep(0.3)


guard = Front()
guard.start()
vite = subprocess.Popen([os.path.join(APP, "node_modules/.bin/vite"), "--port", "1420", "--strictPort"], cwd=APP, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
                        env={**os.environ, "PATH": "/opt/homebrew/opt/node@24/bin:" + os.environ["PATH"]})
time.sleep(4)
proc = None


def up(**extra):
    global proc
    os.makedirs(os.path.join(S, "dump"), exist_ok=True)
    try:
        os.remove(os.path.join(S, "dump/state.txt"))
    except OSError:
        pass
    proc = subprocess.Popen([BIN], env={**BASE, **extra}, cwd=S, stdout=open(os.path.join(OUT, "app.out"), "a"), stderr=subprocess.STDOUT, start_new_session=True)
    guard.pid = proc.pid


def down():
    global proc
    guard.pid = None
    if proc:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait(timeout=20)
    proc = None
    time.sleep(1)


def clicks():
    d = os.path.join(S, "dump")
    return [open(os.path.join(d, n)).read() for n in sorted(os.listdir(d)) if n.startswith("click-")]


try:
    # ① 망이 막힌 채 — 안내하고 안 넘어간다
    drive("시작")
    NO_NET = "http://127.0.0.1:9"
    up(HTTPS_PROXY=NO_NET, https_proxy=NO_NET, ALL_PROXY=NO_NET, all_proxy=NO_NET)
    s = wait(lambda s: s.get("fr"), 60, "첫 설치 창")
    ok("빈 HOME 이면 첫 설치 창", bool(s))
    ok("고정 창 640×440", s and abs(s["w"] - 640) <= 2 and abs(s["h"] - 440) <= 2, s and (s["w"], s["h"]))
    s = wait(lambda s: "인터넷" in s.get("text", ""), 90, "인터넷 안내")
    ok("망이 막히면 인터넷을 확인하라고 멈춘다", bool(s), s and s["text"][:80])
    ok("터미널이 안 보인다", s and s["xterm"] == 0)
    ok("기본 폴더 — 묻지 않고 만들었다", os.path.isdir(os.path.join(HOME, "Developer")))
    ok("못 받았으면 파이썬이 없다", not os.path.exists(os.path.join(DATA, "tools/python/bin/python3")))
    ok("시작 = 폴더 동의가 남았다", os.path.isfile(os.path.join(DATA, "trust-consent.json")))
    down()

    # ② 다시 켜면 시작 없이 준비부터 — 파이썬을 받고 Claude 받는 중에 끈다
    drive()
    up()
    s = wait(lambda s: s.get("fr"), 60, "다시 켠 창")
    ok("다시 켜면 시작 화면이 아니다", s and "시작해요" not in s["text"], s and s["text"][:40])
    s = wait(lambda s: "Claude Code" in s.get("text", "") and "개 중 1개" in s.get("text", ""), 300, "파이썬 받기")
    ok("파이썬을 진짜로 받았다", os.access(os.path.join(DATA, "tools/python/bin/python3"), os.X_OK))
    out = subprocess.run([os.path.join(DATA, "tools/bin/python3"), "-c", "import sys,ssl,sqlite3;print(sys.version.split()[0])"], capture_output=True, text=True, env={"HOME": HOME})
    ok("PATH 쪽 파이썬 링크가 돈다", out.stdout.startswith("3.12"), out.stdout.strip() or out.stderr[:120])
    time.sleep(2)
    down()

    # ③ 이어서 끝까지
    drive()
    up()
    t0 = time.time()
    s = wait(lambda s: "Claude 로그인" in s.get("text", "") or s.get("why"), 1200, "로그인 장까지(진짜 받기)")
    if s and s.get("why"):
        say("  실패 이유:", s["why"])
        time.sleep(4)
        say("  상태:", open(os.path.join(S, "dump/fail.txt")).read()[:900] if os.path.exists(os.path.join(S, "dump/fail.txt")) else "없음")
        s = None
    ok("준비가 저절로 끝난다", bool(s), f"{time.time() - t0:.0f}초")
    if s:
        ok("Claude Code 를 진짜로 깔았다", os.path.exists(os.path.join(HOME, ".local/bin/claude")))
        ok("브라우저 — 시험 열기까지 통과", os.path.isfile(os.path.join(DATA, "tools/chammo-browser/.checked")))
        cj = json.load(open(os.path.join(HOME, ".claude.json")))
        dev, hq = os.path.join(HOME, "Developer"), os.path.join(DATA, "hq")
        ok("프로젝트·작업 폴더 믿음을 앱이 적었다", cj["projects"].get(dev, {}).get("hasTrustDialogAccepted") and cj["projects"].get(hq, {}).get("hasTrustDialogAccepted"), list(cj["projects"])[:3])
        ok("작업 폴더를 만들었다", os.path.isfile(os.path.join(hq, "CLAUDE.md")))
        drive("로그인")
        s = wait(lambda s: "허용" in s.get("text", ""), 40, "로그인 기다림")
        ok("로그인을 누르면 기다림", bool(s))
        time.sleep(3)
        ok("브라우저가 숨은 터미널에서 열렸다", os.path.isfile(os.path.join(S, "browser.log")) and "oauth" in open(os.path.join(S, "browser.log")).read())
        drive()
        s = wait(lambda s: "로그인됐어요" in s.get("text", ""), 40, "로그인 확인")
        ok("로그인이 끝나면 알아챈다", bool(s))
        s = wait(lambda s: "됐어요!" in s.get("text", "") or "party" in s.get("cls", ""), 30, "끝 장면")
        ok("저절로 끝 장면", bool(s))
        wait(lambda s: "party" in s.get("cls", ""), 15, "채움")
        drive("시작하기")
        s = wait(lambda s: s.get("fr") is False, 40, "메인 창")
        ok("시작하기 → 메인 창", bool(s))
        ok("창이 원래 크기로", s and s["w"] > 900, s and (s["w"], s["h"]))
        ok("로그인 문이 안 막는다(Chammo 계정 없음)", s and not s["gate"])
        cfg = json.load(open(os.path.join(DATA, "config.json")))
        ok("설정 끝 표시", cfg.get("setupDone") is True)
        ck = clicks()
        ok("사람이 누른 앱 단추 = 시작·로그인·시작하기", ck == ["시작", "로그인", "시작하기"], ck)
        ok("git 은 아직 안 받았다(비개발자는 영영 안 받는다)", not os.path.exists(os.path.join(DATA, "tools/git")))

        # 새 프로젝트 — git 없이 / --git 은 그 자리에서 받는다
        env = {**BASE, "PATH": f"{DATA}/tools/bin:/usr/bin:/bin:/usr/sbin:/sbin"}
        np = os.path.join(hq, "scripts/new-project")
        r = subprocess.run([np, "plain-doc", "문서", "--no-git"], capture_output=True, text=True, env=env, cwd=hq)
        ok("새 프로젝트(깃 없음)", r.returncode == 0 and not os.path.exists(os.path.join(HOME, "Developer/plain-doc/.git")), (r.stdout + r.stderr)[-160:])
        r = subprocess.run(["git", "-C", os.path.join(HOME, "Developer/plain-doc"), "status"], capture_output=True, text=True, env=env)
        ok("저장소 밖 git 은 받지 않고 128", r.returncode == 128 and not os.path.exists(os.path.join(DATA, "tools/git")), r.stderr[:80])
        # 이 맥엔 진짜 명령줄 도구가 있어 대리가 시스템 git 으로 넘어간다 — 받기는 받기 스크립트로 직접, 그다음은 받은 git 으로(저장소 안 받기 판단은 cargo 시험 base_tools)
        r = subprocess.run([os.path.join(DATA, "tools/bin/chammo-get-tool"), "git"], capture_output=True, text=True, env=env, timeout=400)
        own = os.path.join(DATA, "tools/git/bin/git")
        ok("git 을 진짜로 받았다", r.returncode == 0 and os.access(own, os.X_OK), r.stderr[:160])
        r = subprocess.run(["git", "--exec-path"], capture_output=True, text=True, env=env)
        ok("대리가 받은 git 으로 넘긴다", "tools/git/libexec/git-core" in r.stdout, r.stdout.strip()[:120])
        r = subprocess.run([np, "code-app", "코드", "--git"], capture_output=True, text=True, env=env, cwd=hq, timeout=400)
        repo = os.path.join(HOME, "Developer/code-app")
        ok("새 프로젝트 --git", r.returncode == 0 and os.path.isdir(os.path.join(repo, ".git")), (r.stderr or r.stdout)[:200])
        r0 = subprocess.run(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "x"], capture_output=True, text=True, env=env)
        r = subprocess.run(["git", "-C", repo, "worktree", "add", "-q", "-b", "wt", os.path.join(S, "wt")], capture_output=True, text=True, env=env)
        ok("워크트리", r.returncode == 0 and os.path.isdir(os.path.join(S, "wt")), (r0.stderr + r.stderr)[:160])
        r = subprocess.run(["git", "ls-remote", "--heads", "https://github.com/octocat/Hello-World"], capture_output=True, text=True, env=env, timeout=60)
        ok("받은 git 으로 https 도 된다", r.returncode == 0 and "refs/heads" in r.stdout, r.stderr[:120])
    # 맥 전역에 남은 게 없어야 한다
    lc = subprocess.run(["launchctl", "list"], capture_output=True, text=True).stdout
    ok("launchd 에 시험 폴더가 안 걸렸다", "chammo-fr-real" not in lc)
finally:
    down()
    guard.stop = True
    if vite.poll() is None:
        os.killpg(vite.pid, signal.SIGTERM)
    claude = os.path.join(HOME, ".local/bin/claude")
    if os.path.exists(claude):
        subprocess.run([claude, "daemon", "stop", "--any"], capture_output=True, env={**BASE})
    for n in ("trust-consent.json",):
        p = os.path.join(DATA, n)
        if os.path.exists(p):
            shutil.copy(p, OUT)
    shutil.rmtree(S, ignore_errors=True)

say("실패", failed, "개" if failed else "— 다 통과")
sys.exit(1 if failed else 0)
