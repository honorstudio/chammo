#!/usr/bin/env python3
"""셸 탭 E2E(11-17) — 진짜 시험 앱(디버그 빌드·가짜 HOME·화면 밖·알림 0)에서 셸 탭을 열어 진짜 zsh -l 에 치고, 단계마다 뜬 DOM 을 헤드리스 크롬으로 그린다.

  python3 app/e2e/shell-pane/run.py --bin <시험 앱 실행 파일> --dist <vite dist> [--before] [--out .shots/shell-pane]

시험 앱 = cargo build(디버그) 를 TAURI_CONFIG='{"build":{"devUrl":"http://localhost:47511"}}' 로 — 여기서 dist 를 그 포트로 띄운다.
--before = 옛 판(탭 줄만 떠 간다, 검사 안 함). 끝 줄: '통과' 또는 '실패: …'. 부하(uptime 1분)가 150 넘으면 기다린다.
"""
import argparse, functools, http.server, json, os, shutil, signal, subprocess, sys, tempfile, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FAKEHOME = os.path.join(ROOT, "scripts", "perf-bench", "fakehome.py")
NAME = "chammo-shell-test"  # 웹킷 캐시 칸(~/Library/Caches/<이름>) — 끝나고 지운다
PORT = 47511


def wait_load(limit=150, most=900):
    t = time.time()
    while os.getloadavg()[0] > limit:
        if time.time() - t > most:
            raise SystemExit(f"실패: 부하가 {limit} 밑으로 안 내려옴")
        time.sleep(30)


def zsh_kids(pid):
    """시험 앱이 띄운 셸 수(앱 바로 아래 zsh)"""
    o = subprocess.run(["ps", "-axo", "pid=,ppid=,comm="], capture_output=True, text=True).stdout
    return [int(l.split()[0]) for l in o.splitlines() if len(l.split()) >= 3 and int(l.split()[1]) == pid and l.split()[2].endswith("zsh")]


def judge(r, shells):
    """결과 → 틀린 것 목록"""
    st = dict((k, v) for k, v in r.get("steps", []))
    bad = []
    if "error" in st:
        return [f"시나리오가 멈춤: {st['error'][:300]}"]
    if not st.get("done"):
        return ["시나리오가 끝나지 않음"]
    echo = " ".join(st.get("echo", []))
    for want, why in (("ok-42 한글", "셸 답·한글"), ("[xterm-256color]", "TERM"), ("UTF-8]", "LANG 이 UTF-8"), ("[Chammo]", "TERM_PROGRAM"), ("[없음] [없음]", "앱 env(HONOR_ORCH_DEBUG_JS·CHAMMO_NO_OS_NOTIFY)가 셸에 샘")):
        if want not in echo:
            bad.append(f"{why} — {echo}")
    if not any(l.startswith("/") and l.rstrip("/").endswith("/dev") for l in st.get("echo", [])):
        bad.append(f"첫 셸 시작 폴더가 devRoot 가 아님 — {st.get('echo')}")
    sz = st.get("size", {})
    s0, s1 = sz.get("s0") or {}, sz.get("s1") or {}
    if not s0 or s0.get("rows") != sz.get("xrows0"):
        bad.append(f"stty 줄 수가 화면 줄 수와 다름 — {sz}")
    if not s1 or not (s1.get("rows", 0) < s0.get("rows", 0) and s1.get("cols", 0) < s0.get("cols", 0)):
        bad.append(f"⌘+ 뒤 칸 수가 안 줄었다(resize 가 셸에 안 감) — {sz}")
    k = st.get("cmdK", {})
    if not (k.get("after", 99) <= 1 < k.get("before", 0)) or k.get("searchOpened"):
        bad.append(f"⌘K 가 셸 화면을 안 지웠다 — {k}")
    t3 = st.get("tabs3", {})
    if len(t3.get("titles", [])) != 3 or not (t3.get("pwd") or "").endswith("/alpha-app") or "alpha-app" not in t3["titles"][-1]:
        bad.append(f"탭 셋(⌥⌘T·여기서 터미널)이 아님 — {t3}")
    if not st.get("kept", {}).get("mark"):
        bad.append("홈에 갔다 오니 셸이 새로 떴다(살려 두기 안 됨)")
    b = st.get("busyClose", {})
    if not (b.get("ask") and "sleep" in b["ask"] and b.get("stillThere") and b.get("afterClose") == 2 and not b.get("dialog")):
        bad.append(f"돌던 프로그램 닫기 확인이 틀림 — {b}")
    if st.get("exitClose", {}).get("tabs") != 1:
        bad.append(f"exit 뒤 탭이 안 닫힘 — {st.get('exitClose')}")
    if shells.get("peak", 0) < 3 or shells.get("end", 99) != 1:
        bad.append(f"셸 프로세스 수가 탭 수와 다름(닫은 셸이 남음) — {shells}")
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bin", required=True)
    ap.add_argument("--dist", required=True)
    ap.add_argument("--before", action="store_true")
    ap.add_argument("--out", default=os.path.join(ROOT, ".shots", "shell-pane"))
    ap.add_argument("--secs", type=int, default=150)
    a = ap.parse_args()
    tag = "before" if a.before else "after"
    os.makedirs(a.out, exist_ok=True)
    wait_load()
    w = tempfile.mkdtemp(prefix="chammo-shell-")
    home = os.path.join(w, "home")
    subprocess.run([sys.executable, FAKEHOME, home], check=True, capture_output=True)
    open(os.path.join(home, ".zshrc"), "w").write("")  # 없으면 zsh 가 새 사용자 설정 마법사를 띄운다
    env = dict(os.environ)
    env.update(json.load(open(os.path.join(home, "env.json"))))
    for k in ("CHAMMO_TEST_SHOW", "CHAMMO_DEV_WINDOW", "CHAMMO_TEST_NOTIFY"):
        env.pop(k, None)
    dump = os.path.join(w, "dump")
    open(os.path.join(w, "drive.js"), "w").write(open(os.path.join(HERE, "drive.js")).read().replace("__MODE__", tag))
    env.update(HONOR_ORCH_DEBUG_JS=os.path.join(w, "drive.js"), HONOR_ORCH_DEBUG_REPEAT="1", HONOR_ORCH_DEBUG_OUT=dump,
               CHAMMO_PERF_VISIBLE="1", CHAMMO_NO_OS_NOTIFY="1", SHELL="/bin/zsh")
    http.server.SimpleHTTPRequestHandler.log_message = lambda *x: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(http.server.SimpleHTTPRequestHandler, directory=a.dist))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    exe = os.path.join(w, NAME)
    shutil.copy(a.bin, exe)
    shutil.rmtree(os.path.expanduser(f"~/Library/Caches/{NAME}"), ignore_errors=True)
    p = subprocess.Popen([exe], env=env, cwd=w, stdout=open(os.path.join(w, "app.out"), "w"), stderr=subprocess.STDOUT, start_new_session=True)
    res, t0, shells, seen = {}, time.time(), {"peak": 0}, set()
    try:
        while time.time() - t0 < a.secs and p.poll() is None:
            f = os.path.join(dump, "result.txt")
            if os.path.exists(f):
                try:
                    res = json.load(open(f))
                except ValueError:
                    pass
            kids = zsh_kids(p.pid)
            seen.update(kids)
            shells["peak"] = max(shells["peak"], len(kids))
            st = dict((k, v) for k, v in res.get("steps", []))
            if "done" in st or "error" in st:
                time.sleep(1.5)
                break
            time.sleep(0.5)
        shells["end"] = len(zsh_kids(p.pid))
    finally:
        try:
            os.killpg(p.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        for pid in json.load(open(os.path.join(home, "sleepers.json"))):
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        shutil.rmtree(os.path.expanduser(f"~/Library/Caches/{NAME}"), ignore_errors=True)
    time.sleep(1)
    left = [q for q in seen if subprocess.run(["kill", "-0", str(q)], capture_output=True).returncode == 0]  # 앱을 끄면 셸도 끝난다(고아로 남지 않는다)
    # 뜬 DOM → 헤드리스 크롬 그림(dist 를 같은 주소로 띄워 글꼴·그림이 실린다)
    snaps = sorted(f for f in os.listdir(dump) if f.startswith("snap-")) if os.path.isdir(dump) else []
    try:
        if snaps:  # 같은 dist 서버(앱이 쓰던 것)를 그대로
            r = subprocess.run(["node", os.path.join(HERE, "render.mjs"), dump, a.out, tag, f"http://127.0.0.1:{PORT}/"], capture_output=True, text=True, timeout=300)
            print(r.stdout.strip() or r.stderr[-1500:])
    finally:
        srv.shutdown()
        srv.server_close()
    json.dump(dict(result=res, shells=shells), open(os.path.join(a.out, f"result-{tag}.json"), "w"), ensure_ascii=False, indent=1)
    print(json.dumps(dict(steps=res.get("steps"), shells=shells), ensure_ascii=False)[:3000])
    bad = [] if a.before else judge(res, shells)
    if a.before and not res.get("steps"):
        bad.append("옛 판 시나리오가 안 돌았다")
    if left:
        bad.append(f"앱을 껐는데 셸이 남음 {left}")
    if bad:
        print("실패: " + " / ".join(bad) + f"  (기록 {w})")
        sys.exit(1)
    shutil.rmtree(w, ignore_errors=True)
    print("통과")


if __name__ == "__main__":
    main()
