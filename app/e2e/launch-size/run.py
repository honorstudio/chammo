#!/usr/bin/env python3
"""켤 때 창 크기 실측(fix/launch-narrow, 11-18 사용자 "좁게 있다가 펼쳐짐") — 시험 앱을 가짜 HOME·화면 밖으로 켜고
첫 15초의 창 안 크기(innerWidth/innerHeight)·resize·rAF 틈·앱 첫 그리기를 시각과 함께 남긴다.

  python3 app/e2e/launch-size/run.py <시험 앱 실행 파일> <dist 폴더> [--resize 1920,1050,800] [--saved 1920,1050] [--port 1491] [--runs 3]

  --resize W,H,ms  켠 뒤 ms 에 창을 W×H 로 키운다(사람이 꽉 채우기를 누른 것 — 디버그 스위치 CHAMMO_TEST_RESIZE)
  --saved W,H      켜기 전에 지난번 창 크기를 저장해 둔다(<데이터 폴더>/window.json) — 고친 판은 처음부터 그 크기로 떠야 한다
시험 앱 = debug_assertions 켠 빌드, devUrl http://localhost:1437 (perf-bench 와 같은 빌드) — 포트는 복사본에서 바꾼다.
결과: 판마다 한 줄 JSON + 끝 줄 요약. 첫그리기 = 프로세스 띄운 때 → #root 에 처음 그린 rAF, 좁게 = 창을 키운 때 → 웹뷰가 새 폭으로 그린 첫 rAF
"""
import argparse, http.server, json, os, shutil, signal, subprocess, sys, tempfile, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FAKEHOME = os.path.join(ROOT, "scripts", "perf-bench", "fakehome.py")
PROBE = os.path.join(ROOT, "app", "e2e", "hidden-window", "probe.js")
NAME = "chammo-launch-size"


def wait_load(limit=150, most=900):
    t = time.time()
    while os.getloadavg()[0] > limit:
        if time.time() - t > most:
            raise SystemExit(f"실패: 부하가 {limit} 밑으로 안 내려옴")
        time.sleep(60)


def frame(pid):
    try:
        o = subprocess.run(["osascript", "-l", "JavaScript", PROBE, str(pid)], capture_output=True, text=True, timeout=20).stdout
        ws = [w for w in json.loads(o)["windows"] if w.get("on")]
        return ws[0]["b"] if ws else None
    except Exception:
        return None


def summarize(L, spawned, rs, target_w):
    """계측 기록 → 숫자. rs = resize.txt(없으면 None)"""
    out = dict(first_app_ms=(L["firstApp"] - spawned) if L.get("firstApp") else None,
               page_start_ms=L["start"] - spawned,
               first_size=L["sizes"][0][1:3] if L["sizes"] else None,
               sizes=[[t - spawned, w, h] for t, w, h, _ in L["sizes"]],
               worst_gap=max([g[1] for g in L["gaps"]] or [0]),
               gaps=[[s - spawned, d] for s, d in L["gaps"] if d >= 100])
    if rs:
        R = rs["done"]
        seen = next((t for t, w, *_ in L["sizes"] if t >= rs["ran"] and w >= target_w - 2), None)
        ev = next((t for t, w, *_ in L.get("resizes", []) if t >= rs["ran"] and w >= target_w - 2), None)
        out.update(resize_at_ms=R - spawned, resize_queue_ms=rs["ran"] - rs["asked"], narrow_ms=(seen - R) if seen else None,
                   anim_ms=R - rs["ran"], resizes=[[t - spawned, w, h] for t, w, h in L.get("resizes", [])],
                   event_ms=(ev - R) if ev else None)
    elif target_w:
        # 저장 크기로 떴나 — 처음 잰 폭이 이미 목표면 좁은 때 0
        first_w = L["sizes"][0][1] if L["sizes"] else 0
        grown = next((t for t, w, *_ in L["sizes"] if w >= target_w - 2), None)
        out.update(narrow_ms=0 if first_w >= target_w - 2 else ((grown - L["sizes"][0][0]) if grown else None))
    return out


def winid(pid):
    js = ("ObjC.import('CoreGraphics');var l=ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(0,0)));var r=0;"
          f"l.forEach(function(w){{if(w.kCGWindowOwnerPID=={pid}&&w.kCGWindowLayer==0&&w.kCGWindowBounds.Width>=1000)r=w.kCGWindowNumber}});r")
    return subprocess.run(["osascript", "-l", "JavaScript", "-e", js], capture_output=True, text=True).stdout.strip()


def one(a, dist, tag):
    wait_load()
    w = tempfile.mkdtemp(prefix="chammo-launch-")
    home = os.path.join(w, "home")
    subprocess.run([sys.executable, FAKEHOME, home], check=True, capture_output=True)
    if a.seed:  # 사용자 맥 비슷한 양(perf-bench 실험실 시드) — 세션 N개·ctx·대화 기록·기능 켬
        sys.path.insert(0, os.path.dirname(FAKEHOME))
        import lab
        lab.seed(w, a.seed, 2131)
    env = dict(os.environ)
    env.update(json.load(open(os.path.join(home, "env.json"))))
    for k in ("CHAMMO_TEST_SHOW", "CHAMMO_DEV_WINDOW", "CHAMMO_TEST_NOTIFY", "CHAMMO_TEST_RESIZE"):
        env.pop(k, None)
    if a.at:
        js = "ObjC.import('AppKit');var r=false;for(var i=0;i<$.NSScreen.screens.count;i++){if(ObjC.unwrap($.NSScreen.screens.objectAtIndex(i).localizedName)=='Chammo agents')r=true}r"
        if subprocess.run(["osascript", "-l", "JavaScript", "-e", js], capture_output=True, text=True).stdout.strip() != "true":
            raise SystemExit("실패: 'Chammo agents' 가짜 화면이 없다 — 사람 화면에 띄우지 않으려고 멈춤")
        env["CHAMMO_DEV_WINDOW"] = a.at
    target_w = 0
    if a.resize:
        env["CHAMMO_TEST_RESIZE"] = a.resize
        target_w = int(float(a.resize.split(",")[0]))
    if a.saved:
        sw, sh = (float(x) for x in a.saved.split(","))
        json.dump({"main": {"x": 20000, "y": 20000, "w": sw, "h": sh}}, open(os.path.join(env["CHAMMO_HOME"], "window.json"), "w"))
        target_w = int(sw)
    env["HONOR_ORCH_DEBUG_OUT"] = os.path.join(w, "dump")
    # 12초 뒤 상태 한 줄(계측이 안 돌았을 때 왜인지)
    open(os.path.join(w, "probe.js"), "w").write("window.__TAURI_INTERNALS__.invoke('debug_dump',{name:'probe',text:JSON.stringify({ls:!!window.__ls,frames:window.__ls&&window.__ls.frames,href:location.href,title:document.title,body:document.body&&document.body.innerHTML.slice(0,300),scripts:document.scripts.length,root:(document.getElementById('root')||{}).childElementCount,hidden:document.hidden,iw:innerWidth})})")
    env["HONOR_ORCH_DEBUG_JS"] = os.path.join(w, "probe.js")
    handler = lambda *x, **k: http.server.SimpleHTTPRequestHandler(*x, directory=dist, **k)
    http.server.SimpleHTTPRequestHandler.log_message = lambda self, *x: open(os.path.join(w, "http.log"), "a").write(self.requestline + "\n")
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    exe = os.path.join(w, NAME)
    shutil.copy(a.binary, exe)
    if a.port != 1437:
        b = open(exe, "rb").read()
        open(exe, "wb").write(b.replace(b"localhost:1437", f"localhost:{a.port}".encode()))
        subprocess.run(["codesign", "-s", "-", "--force", exe], capture_output=True)
    spawned = int(time.time() * 1000)
    p = subprocess.Popen([exe], env=env, cwd=w, stdout=open(os.path.join(w, "app.out"), "w"), stderr=subprocess.STDOUT, start_new_session=True)
    dump = os.path.join(w, "dump", "launch.txt")
    L, fr = None, None
    try:
        t0 = time.time()
        for sec in [float(x) for x in a.shot.split(",")] if a.shot else []:
            time.sleep(max(0, spawned / 1000 + sec - time.time()))
            wid = winid(p.pid)
            if wid and wid != "0":
                out = os.path.join(ROOT, ".shots", "launch-narrow", f"shot-{'saved' if a.saved else 'grow'}-{tag}-{sec}s.png")
                r = subprocess.run(["screencapture", "-x", "-o", "-l", wid, out], capture_output=True, text=True)
                print(f"캡처 {sec}s 창 {wid} → {out if os.path.exists(out) else '실패 ' + r.stderr.strip()}", file=sys.stderr)
            else:
                print(f"캡처 {sec}s 창 못 찾음", file=sys.stderr)
        while time.time() - t0 < 25 + a.watch / 1000 and p.poll() is None:
            if os.path.exists(dump):
                try:
                    L = json.load(open(dump)); break
                except ValueError:
                    pass
            time.sleep(0.5)
        fr = frame(p.pid)
    finally:
        try: os.killpg(p.pid, signal.SIGTERM)
        except ProcessLookupError: pass
        srv.shutdown(); srv.server_close()
        for pid in json.load(open(os.path.join(home, "sleepers.json"))):
            try: os.kill(pid, signal.SIGTERM)
            except ProcessLookupError: pass
        shutil.rmtree(os.path.expanduser(f"~/Library/Caches/{NAME}"), ignore_errors=True)
        shutil.rmtree(os.path.expanduser(f"~/Library/WebKit/{NAME}"), ignore_errors=True)
    if L is None:
        return dict(tag=tag, error=f"계측 덤프 없음 — {w}/app.out")
    rsf = os.path.join(w, "dump", "resize.txt")
    rs = json.load(open(rsf)) if os.path.exists(rsf) else None
    s = summarize(L, spawned, rs, target_w)
    s.update(tag=tag, frame=fr)
    if a.saved:
        s["saved_after"] = json.load(open(os.path.join(env["CHAMMO_HOME"], "window.json"))) if os.path.exists(os.path.join(env["CHAMMO_HOME"], "window.json")) else None
    shutil.rmtree(w, ignore_errors=True)
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("binary"); ap.add_argument("dist")
    ap.add_argument("--resize"); ap.add_argument("--saved")
    ap.add_argument("--seed", type=int, default=0, help="세션 수 — 주면 perf-bench lab 시드를 얹는다(가벼운 가짜 HOME 으론 안 나는 무거운 판)")
    ap.add_argument("--raf-ms", type=int, default=0, help="rAF 계측을 이때 멈춘다(조용한 화면 판) — 뒤는 resize 사건만")
    ap.add_argument("--watch", type=int, default=15000, help="계측 시간(ms) — 켜고 한참 뒤 키우는 판(최대화 버벅, fix/max-blank)은 길게")
    ap.add_argument("--port", type=int, default=1491)
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--at", help="창 자리 x,y(논리) — 캡처하려면 'Chammo agents' 가짜 화면 위로(화면 밖은 안 찍힌다). 그 화면이 없으면 멈춘다")
    ap.add_argument("--shot", help="판마다 켠 뒤 이 초들에 창째 캡처(예: 1.5,3,6) — <shot>-<판>-<초>.png 로 .shots 에")
    a = ap.parse_args()
    dist = tempfile.mkdtemp(prefix="chammo-launch-dist-")
    shutil.rmtree(dist); shutil.copytree(a.dist, dist)
    shutil.copy(os.path.join(HERE, "early.js"), os.path.join(dist, "launch-early.js"))
    idx = os.path.join(dist, "index.html")
    html = open(idx).read()  # 먼저 읽는다 — open(idx, "w") 가 먼저 비운다
    open(idx, "w").write(html.replace("<head>", f'<head>\n    <script>window.__lsMs={a.watch};window.__lsRafMs={a.raf_ms or a.watch}</script><script src="/launch-early.js"></script>', 1))
    rows = []
    try:
        for i in range(a.runs):
            r = one(a, dist, i)
            rows.append(r)
            print(json.dumps(r, ensure_ascii=False), flush=True)
    finally:
        shutil.rmtree(dist, ignore_errors=True)
    ok = [r for r in rows if "error" not in r]
    med = lambda k: sorted(x[k] for x in ok if x.get(k) is not None)[len([x for x in ok if x.get(k) is not None]) // 2] if any(x.get(k) is not None for x in ok) else None
    print(f"요약: {len(ok)}/{len(rows)}판 · 첫그리기 중앙 {med('first_app_ms')}ms · 좁게 중앙 {med('narrow_ms')}ms · 최악 rAF 틈 중앙 {med('worst_gap')}ms")


if __name__ == "__main__":
    main()
