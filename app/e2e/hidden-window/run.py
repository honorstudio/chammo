#!/usr/bin/env python3
"""시험판이 사람 화면에 안 뜨는지 — 시험 데이터 폴더로 띄운 시험 앱 창이 화면 밖이고, 앞으로 안 나오고, Dock 에 없고, 그래도 웹뷰가 그리는지.
알림 0건 — 시험 JS 가 맥 알림(notify)을 하나 불러도 시험판은 안 내고 notify.log 에 notify-quiet 로만 남는지(11-17 시험 참모 알림이 사용자 맥에 떴다).

  python3 app/e2e/hidden-window/run.py <시험 앱 실행 파일> [--port 1488]

시험 앱 = debug_assertions 켠 빌드(개발판, 또는 perf-bench 처럼 CARGO_PROFILE_RELEASE_DEBUG_ASSERTIONS=true 릴리스),
화면 주소(devUrl)는 http://localhost:<port> 로 빌드한 것 — 여기서 빈 쪽을 띄운다(진짜 화면 묶음 없이 창·웹뷰만 본다).
가짜 HOME(perf-bench fakehome — 진짜 ~/.claude·키체인·데이터 폴더에 안 닿는다), 가짜 화면 안 만듦(CHAMMO_VDISPLAY=0).
끝 줄: '통과' 또는 '실패: …'. 부하(uptime 1분)가 50 넘으면 기다린다.
"""
import argparse, http.server, json, os, shutil, signal, subprocess, sys, tempfile, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FAKEHOME = os.path.join(ROOT, "scripts", "perf-bench", "fakehome.py")
NAME = "chammo-hidden-test"  # 시험 앱 복사본 이름 — 웹킷 캐시 칸(~/Library/Caches/<이름>)을 끝나고 지운다
DRIVE = """if (!window.__hidTest) { window.__hidTest = 1; let n = 0; const t0 = performance.now();
  window.__TAURI_INTERNALS__.invoke('notify', { title: 'chammo-hidden-test-notify', body: '시험', target: null, phones: false }).catch((e) => window.__TAURI_INTERNALS__.invoke('debug_dump', { name: 'notifyerr', text: String(e) }));
  const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else
    window.__TAURI_INTERNALS__.invoke('debug_dump', { name: 'hidden', text: JSON.stringify({ raf: n, hidden: document.hidden, sx: window.screenX, sy: window.screenY }) }); };
  requestAnimationFrame(f); }"""


def probe(pid):
    o = subprocess.run(["osascript", "-l", "JavaScript", os.path.join(HERE, "probe.js"), str(pid)], capture_output=True, text=True, timeout=20).stdout
    return json.loads(o)


def meets(b, s):
    """창 틀 b 와 화면 s 가 겹치나(위 왼쪽 기준 논리 좌표)"""
    return b["X"] < s["X"] + s["W"] and s["X"] < b["X"] + b["Width"] and b["Y"] < s["Y"] + s["H"] and s["Y"] < b["Y"] + b["Height"]


def judge(samples, dump, self_pid, notify_log=None):
    """표본들(probe 결과)·웹뷰 덤프·notify.log 글 → 틀린 것 목록(비면 통과)"""
    bad = []
    if notify_log is not None and dump is not None:
        if 'notify-quiet\tchammo-hidden-test-notify' not in notify_log:
            bad.append('시험판이 맥 알림을 냈다(notify.log 에 notify-quiet 줄 없음) — 시험판 알림은 0건이어야')
    if any(s["front"] == self_pid for s in samples):
        bad.append("시험 앱이 맨 앞으로 나왔다")
    if any(s.get("active") for s in samples):
        bad.append("시험 앱이 활성 앱이 됐다(키보드를 가져감)")
    if any(s.get("policy") not in (None, 2, "2") for s in samples):
        bad.append(f"Dock·⌘Tab 에 보임(활성화 정책 {sorted({s.get('policy') for s in samples} - {None})}, 2=Prohibited 여야)")
    wins = [(s, w) for s in samples for w in s["windows"] if w.get("on", True)]  # 숨은 창(on 0)은 자리가 어디든 안 보인다
    if not wins:
        bad.append("보이는 창을 못 찾음(메인 창이 안 떴다)")
    for s, w in wins:
        hit = [sc["name"] for sc in s["screens"] if meets(w["b"], sc)]
        if hit:
            bad.append(f"창 '{w.get('name', '')}' 이 {s.get('t')}초에 화면 위({', '.join(hit)}) — {w['b']}")
            break
    if dump is None:
        bad.append("웹뷰 덤프 없음(debug_dump — 시험 JS 가 안 돌았다)")
    else:
        if dump.get("hidden"):
            bad.append("웹뷰가 document.hidden=true — 가림 감지가 안 꺼졌다")
        if dump.get("raf", 0) < 30:
            bad.append(f"rAF 가 2초에 {dump.get('raf')}번 — 화면 밖에서 그리기가 멈췄다")
    return bad


def wait_load(limit=50, most=600):
    t = time.time()
    while os.getloadavg()[0] > limit:
        if time.time() - t > most:
            raise SystemExit(f"실패: 부하가 {limit} 밑으로 안 내려옴({os.getloadavg()[0]:.0f})")
        time.sleep(30)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("binary")
    ap.add_argument("--port", type=int, default=1488)
    ap.add_argument("--secs", type=int, default=30)
    a = ap.parse_args()
    wait_load()
    w = tempfile.mkdtemp(prefix="chammo-hidden-")
    home = os.path.join(w, "home")
    subprocess.run([sys.executable, FAKEHOME, home], check=True, capture_output=True)
    env = dict(os.environ)
    env.update(json.load(open(os.path.join(home, "env.json"))))
    for k in ("CHAMMO_TEST_SHOW", "CHAMMO_DEV_WINDOW", "CHAMMO_PERF_VISIBLE", "CHAMMO_NO_OS_NOTIFY", "CHAMMO_TEST_NOTIFY"):
        env.pop(k, None)  # 앱 기본값만 본다
    page = os.path.join(w, "page"); os.makedirs(page)
    open(os.path.join(page, "index.html"), "w").write("<!doctype html><meta charset=utf-8><title>hidden</title><body>시험</body>")
    open(os.path.join(w, "drive.js"), "w").write(DRIVE)
    env.update(HONOR_ORCH_DEBUG_JS=os.path.join(w, "drive.js"), HONOR_ORCH_DEBUG_OUT=os.path.join(w, "dump"))
    handler = lambda *x, **k: http.server.SimpleHTTPRequestHandler(*x, directory=page, **k)
    http.server.SimpleHTTPRequestHandler.log_message = lambda *x: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    exe = os.path.join(w, NAME)
    shutil.copy(a.binary, exe)
    before = probe(os.getpid())["front"]
    p = subprocess.Popen([exe], env=env, cwd=w, stdout=open(os.path.join(w, "app.out"), "w"), stderr=subprocess.STDOUT, start_new_session=True)
    samples, dump, t0 = [], None, time.time()
    try:
        while time.time() - t0 < a.secs:
            s = probe(p.pid)
            s["t"] = round(time.time() - t0, 1)
            samples.append(s)
            f = os.path.join(w, "dump", "hidden.txt")
            if dump is None and os.path.exists(f):
                dump = json.loads(open(f).read())
            if dump is not None and len([x for x in samples if any(w.get("on") for w in x["windows"])]) >= 3:
                break
            if p.poll() is not None:
                break
            time.sleep(0.5)
    finally:
        nl = os.path.join(env.get('CHAMMO_HOME', ''), 'notify.log')
        for _ in range(20):  # 알림 줄이 적힐 틈 — 메인 스레드가 느리면 덤프보다 늦다
            if dump is None or (os.path.exists(nl) and 'chammo-hidden-test-notify' in open(nl).read()):
                break
            time.sleep(0.5)
        try:
            os.killpg(p.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        srv.shutdown()
        for pid in json.load(open(os.path.join(home, "sleepers.json"))):
            try: os.kill(pid, signal.SIGTERM)
            except ProcessLookupError: pass
        shutil.rmtree(os.path.expanduser(f"~/Library/Caches/{NAME}"), ignore_errors=True)
    json.dump(samples, open(os.path.join(w, "samples.json"), "w"), ensure_ascii=False)
    print(json.dumps(dict(before=before, samples=len(samples), last=samples[-1] if samples else None, dump=dump), ensure_ascii=False))
    bad = judge(samples, dump, p.pid, open(nl).read() if os.path.exists(nl) else '')
    if p.returncode not in (None, 0, -15) and not samples:
        bad.append(f"앱이 바로 꺼짐({p.returncode}) — {w}/app.out")
    if bad:
        print("실패: " + " / ".join(bad) + f"  (기록 {w})")
        sys.exit(1)
    shutil.rmtree(w, ignore_errors=True)
    print("통과")


if __name__ == "__main__":
    main()
