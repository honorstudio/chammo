#!/usr/bin/env python3
"""폰 허용 메일 코드 끝까지 — 진짜 맥 코드(시험 앱) ↔ 로컬 중계(wrangler dev, send_email 은 .eml 파일) ↔ 진짜 입구(참모 브라우저). 운영·진짜 계정에 안 닿는다.
  run.py <작업 폴더> <중계 소스> <시험 앱 실행 파일> <dist>
시험 앱 틀은 scripts/perf-bench/app.py(가짜 HOME·임시 키체인). 끝나면 다 끈다."""
import json, os, signal, subprocess, sys, time, uuid
HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, "..", ".."))
ROOT = os.path.abspath(os.path.join(APP, ".."))
PB = os.path.join(ROOT, "scripts", "perf-bench")
W, RELAY_SRC, BIN, DIST = [os.path.abspath(a) for a in sys.argv[1:5]]
R, G, E = 8847, 8848, 47272
os.makedirs(W, exist_ok=True)
env = dict(os.environ, PATH="/opt/homebrew/bin:" + os.environ["PATH"])
procs = []
def bg(cmd, cwd, log, **kw):
    p = subprocess.Popen(cmd, cwd=cwd, env=dict(env, **kw), stdout=open(os.path.join(W, log), "w"), stderr=subprocess.STDOUT, start_new_session=True)
    procs.append(p)
    return p
app = lambda *a, **e: subprocess.run([sys.executable, os.path.join(PB, "app.py"), a[0], W, *a[1:]], capture_output=True, text=True, env=dict(env, PERF_GOOGLE_PORT=str(G), **e))
code = 1
try:
    state = os.path.join(W, "relay-state")
    subprocess.run(["./node_modules/.bin/wrangler", "d1", "migrations", "apply", "chammo-relay", "--local", "--persist-to", state], cwd=RELAY_SRC, env=env, capture_output=True, input="y\n", text=True)
    g = f"http://127.0.0.1:{G}"
    bg(["./node_modules/.bin/wrangler", "dev", "--port", str(R), "--persist-to", state, "--var", f"PUBLIC_ORIGIN:http://localhost:{R}", "--var", "DEV_MOCK_GOOGLE:1", "--var", "E2E_REQUIRED:1", "--var", "TEAM_ROLES:1",
        "--var", f"WEB_ORIGINS:http://127.0.0.1:{E}", "--var", f"GOOGLE_AUTH_URL:{g}/auth", "--var", f"GOOGLE_TOKEN_URL:{g}/token", "--var", "GOOGLE_CLIENT_ID:test-client.apps.googleusercontent.com", "--var", "GOOGLE_CLIENT_SECRET:test-secret"], RELAY_SRC, "wrangler.log")
    bg(["node", "scripts/mock-google.mjs", f"http://localhost:{R}"], RELAY_SRC, "mockg.log", MOCK_GOOGLE_PORT=str(G))
    for _ in range(90):
        if subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", f"http://localhost:{R}/v0/me"], capture_output=True, text=True).stdout == "401":
            break
        time.sleep(1)
    else:
        raise SystemExit("로컬 중계가 안 떴다")
    bg(["node", os.path.join(HERE, "vite.mjs")], APP, "vite.log", ROOT=APP, PORT=str(E), RELAY=f"http://localhost:{R}", CACHE=os.path.join(W, "vc"))
    print(app("up", BIN, DIST, CHAMMO_PHONE_WEB=f"http://127.0.0.1:{E}").stdout.strip()[-200:])
    sub = "phone-mail-" + uuid.uuid4().hex[:6]
    print(app("login", f"http://localhost:{R}", "시험", sub).stdout.strip()[-300:])
    data = os.path.join(W, "home", ".chammo-perf")
    # 허브에 붙을 때까지
    for _ in range(40):
        t = open(os.path.join(data, "notify.log"), errors="ignore").read() if os.path.exists(os.path.join(data, "notify.log")) else ""
        if "허브에 붙음" in t:
            break
        time.sleep(1)
    else:
        print("허브에 안 붙음\n" + t[-800:])
    time.sleep(3)
    r = subprocess.run(["node", os.path.join(HERE, "drive.cjs"), f"http://127.0.0.1:{E}", W], env=dict(env, GOOGLE=g, SUB=sub, MAC_NAME="perf-mac-2", DATA=data), capture_output=True, text=True, timeout=420)
    print(r.stdout[-6000:], r.stderr[-1500:])
    code = r.returncode
    log = os.path.join(data, "notify.log")
    print("\n--- 맥 기록"); print("\n".join(l[:170] for l in open(log, errors="ignore").read().splitlines() if "phone-relay" in l or "메일" in l)[-1800:] if os.path.exists(log) else "(notify.log 없음)")
finally:
    app("down")
    for p in procs:
        try: os.killpg(p.pid, signal.SIGTERM)
        except ProcessLookupError: pass
sys.exit(code)
