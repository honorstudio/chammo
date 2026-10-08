# chammo-browser

**Per-project, logged-in, lock-protected Chromium profiles for Claude Code sessions.**

This is not a browser engine. It is a thin layer around [`@playwright/mcp`](https://github.com/microsoft/playwright-mcp)
that gives every project its own persistent browser profile (so logins survive) and makes sure two sessions
never open the same profile at the same time (so the profile is not silently corrupted).
Many agents can browse in parallel — each project in its own profile — without colliding.

## Why

| Approach | Stays logged in | Isolated | Collisions |
|---|---|---|---|
| `--extension` (share your main Chrome) | yes | no | **sessions fight over one browser** |
| `--isolated` (fresh browser each time) | no (log in every time) | yes | none |
| **chammo-browser (persistent profile + lock)** | **yes** | **yes** | **blocked by a lock** |

> Playwright ignores Chromium's `SingletonLock` and will happily open the same profile twice.
> There is no error — the profile (cookies, IndexedDB) can just get corrupted.
> An application-level lock is the only line of defense, and that is what this tool is.

## Install

Requires **Node.js 20+**.

```bash
cd tools/chammo-browser
npm install          # installs the pinned @playwright/mcp
npm link             # optional: puts chammo-browser / chammo-browser-mcp on PATH
```

`@playwright/mcp` drives your installed Google Chrome by default.

## Usage

Run setup once per project folder. After that, use the normal `mcp__playwright__*` tools.

```bash
chammo-browser setup acme-shop ~/work/acme-shop
# or, without npm link:
node tools/chammo-browser/bin/chammo-browser.js setup acme-shop ~/work/acme-shop
```

This writes (or merges into) `~/work/acme-shop/.mcp.json`:

```json
{
  "mcpServers": {
    "playwright": {
      "type": "stdio",
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/chammo-browser/bin/chammo-browser-mcp.js", "acme-shop"]
    }
  }
}
```

- The command is the **absolute** path of the current `node` plus the wrapper, so it works even when nothing is on `PATH`.
- Other servers in `.mcp.json` are kept. An existing `playwright` entry that points elsewhere is replaced, and the old value is printed.
- A broken `.mcp.json` is never overwritten — setup exits with an error instead.
- The next Claude Code session opened in that folder uses the profile `acme-shop` (after the one-time project MCP trust prompt).

Different projects → different profiles → no collisions. Two sessions in the same folder share a profile, and the lock decides who gets the browser.

## Scripts (node / python Playwright, puppeteer)

A script that launches Chrome itself (`chromium.launchPersistentContext`, `puppeteer.launch`) gets a browser the app
cannot show and that takes no lock — another session opening the same profile can corrupt it. Ask chammo-browser instead
and attach over CDP:

```js
// node — one line instead of launchPersistentContext
const { launch } = require('<data>/tools/chammo-browser');
const { context, release } = await launch('acme-shop');   // { chromium, channel, headless, view, wait } optional
const page = await context.newPage();
// ...
await release();   // closes the tabs this script opened and disconnects
```

```python
# any language — one JSON line on stdout: {"ok":true,"wsEndpoint":"ws://127.0.0.1:…","shared":false,…}
r = json.loads(subprocess.run(["node", f"{data}/tools/chammo-browser/bin/chammo-browser.js", "launch", "acme-shop",
                               "--owner", str(os.getpid())], capture_output=True, text=True).stdout)
browser = playwright.chromium.connect_over_cdp(r["wsEndpoint"])
context = browser.contexts[0]
```

- `launch` starts a small **holder** process that takes the profile lock, launches Chrome with the same flags, window
  place and channel as the session browser, and writes the app's live file (so the session's browser pane shows it).
  The session is found from `CLAUDE_PID` (set by Claude Code for tool commands), or the nearest `claude` ancestor.
- The holder closes Chrome and releases the lock within a second after the owner (`--owner`, default: the caller)
  and every script sharing it have exited — also after `kill -9`. `release <profile> [--owner pid]` says "done" early.
- **Sharing:** if that profile's Chrome is already open (another script, or the session's own browser tools), the script
  gets the same Chrome (`"shared": true`); the session's idle auto-close waits while scripts use it. If it cannot attach
  (the owner has no debugging port) it waits up to `--wait` seconds (default 120), then exits with code 2.
- `browser.close()` / `context.close()` on a CDP connection only disconnect; Chrome stays for the others.
- `--no-view` keeps the lock but does not show the browser in the app; `--headless` for no window at all.

**Channel per profile.** A profile remembers which Chrome made it (`<profile>/ChammoChannel`). Opening a stable-Chrome
profile with Beta upgrades it, and stable can no longer open it. With no record yet, the channel whose major version
matches the profile's `Last Version` wins; a channel older than the profile is never used. `--channel` or
`CHAMMO_BROWSER_CHANNEL` overrides (and is remembered).

## Commands

```
chammo-browser status                 lock status (default)
chammo-browser unlock <profile>       force-release a lock
chammo-browser clean                  remove locks whose process is dead
chammo-browser profiles               list profiles
chammo-browser setup <profile> [dir]  register playwright in dir/.mcp.json (merge)
chammo-browser launch <profile> [--owner pid] [--channel chrome|chrome-beta] [--headless] [--no-view] [--wait sec]
                                      Chrome for a script — prints {ok, wsEndpoint, shared, holder}
chammo-browser release <profile> [--owner pid]   the script is done (last one closes Chrome)
```

## Where things live

```
<data folder>/browser/
  profiles/<profile>/   browser user-data-dir (logins live here)
  locks/<profile>.lock  {"profile","pid","startedAt"} of the wrapper holding it
```

`<data folder>` follows the Chammo app rule: `$CHAMMO_HOME`, else `~/.chammo`
(an older install's `~/.honor-orchestrator` is used if `~/.chammo` does not exist).
`CHAMMO_BROWSER_HOME` overrides the whole `browser/` root. If setup runs with either variable set,
the resolved root is written into the entry's `env` so the wrapper uses the same place.

## How it works

The `playwright` server in `.mcp.json` is the wrapper `chammo-browser-mcp`. Claude sees a plain
"playwright" MCP with the same tool names. Behind it:

1. Starts the pinned `@playwright/mcp --user-data-dir <profile>` and relays stdio JSON-RPC line by line.
2. `initialize` / `tools/list` pass through **without the lock**, so the MCP always connects, even when another session holds the profile.
3. The lock is taken on the **first `tools/call`**. If it cannot be taken, the process stays alive and only that call returns a tool error (`isError`): "profile X is in use by pid N". The next call retries.
4. Released when `browser_close` succeeds (and no other call is in flight), and when the process exits (session closed).
5. **Idle auto-close**: after N minutes with no `tools/call`, the wrapper sends `browser_close` itself and releases the lock. Default 10; set `--idle-minutes=N` in the entry's args or `CHAMMO_BROWSER_IDLE_MINUTES=N` (the arg wins, `0` disables). The profile stays on disk, so persistent cookies and localStorage survive; **session cookies (no expiry) do not**.

6. **Human takeover** (with the Chammo app): the app shows the session browser view-only. When a person presses
   *Take over*, the app writes `<root>/live/<profile>.takeover`; the wrapper then **holds the session's next browser tool
   call** until the person hands back (10 minutes at a time). On hand-back the app writes what the person did
   (`.handback`: visited URLs without query, element names clicked, which fields got text — never the text) and the first
   result carries a `[사람 개입]` note; until the session runs `browser_snapshot` (or navigates), clicks and typing based on
   the old page are **not executed**. `browser_ask_human` returns the same note. Logic in `src/takeover.js`.
7. **Password fields are masked**: Playwright's snapshot prints `type=password` values. Before each result goes to the
   session, the wrapper reads the page's password / one-time-code fields (kept in memory only) and replaces those values
   with `●●●●` in every result and in the `.playwright-mcp/` snapshot files it points to. Logic in `src/secrets.js`.

`@playwright/mcp` is pinned (not `npx @playwright/mcp@latest`) because a broken upstream alpha once
made the MCP fail to start at all. Logic lives in `src/relay.js` and `src/lock.js`.

Claude Code MCP scope priority: **Managed > Local > Project (`.mcp.json`) > User**. Same-named servers are not merged —
the higher scope wins. So a global `playwright` stays as the fallback for folders without `.mcp.json`.

## How Chammo uses it

Chammo ships this folder, installs its dependencies into the app data folder, and runs `setup` for each
project it manages, using the **project folder name as the profile name**. Every project session then
gets its own logged-in browser, and sessions in the same project take turns through the lock.
Log in once per project profile; later sessions start logged in. The exact calls are in [`INTEGRATION.md`](INTEGRATION.md).

## Tests

```bash
npm test                            # unit tests (node:test) — never launches a browser
node scripts/verify-lazy-lock.js    # two real wrappers on one profile, real JSON-RPC (log in .shots/)
node scripts/verify-idle-close.js   # idle auto-close + cookies/localStorage survive a restart
node scripts/verify-profile.js      # raw Playwright spike: persistence, isolation, duplicate open
node scripts/verify-launch.js       # launch: live file, two scripts at once, channel memory, kill -9, sharing with the MCP
                                    # (VD=x,y,w,h VD_PID=<pid> puts windows on a virtual display, else headless)
```

The `verify-*` scripts launch a real browser and use a temporary `CHAMMO_BROWSER_HOME`.

## License

AGPL-3.0-only, same as the Chammo app.

---

## 한국어 요약

**프로젝트마다 로그인이 유지되는 격리 크로미움 프로필을 주고, 같은 프로필을 두 세션이 동시에 못 쓰게 락으로 막는 도구**다.
Playwright 는 크로미움의 `SingletonLock` 을 무시해서 같은 프로필을 두 번 열어도 에러 없이 프로필이 조용히 망가질 수 있다 — 그래서 락이 유일한 방어선이다.

- 설치: 이 폴더에서 `npm install` (Node 20 이상)
- 사람 개입(앱): 평소 앱에선 보기만 — '개입'을 누르면 세션의 다음 브라우저 도구가 돌려줄 때까지 기다리고, 돌려주면 사람이 한 일 꼬리표(주소·누른 곳·글자 넣은 칸 이름, 값은 안 씀)와 함께 snapshot 부터 하게 한다
- 비밀번호 칸 값은 세션에 가는 모든 결과·스냅숏 파일에서 ●●●● 로 가린다(값은 래퍼 메모리에만)
- 셋업: `node bin/chammo-browser.js setup <프로필> <프로젝트 폴더>` → 그 폴더 `.mcp.json` 에 playwright 등록(다른 서버는 유지)
- 락은 첫 브라우저 도구 호출 때 잡고, `browser_close` 성공·세션 종료·10분 유휴 때 놓는다
- 저장 위치: `$CHAMMO_HOME/browser` 또는 `~/.chammo/browser` (`CHAMMO_BROWSER_HOME` 으로 바꿀 수 있음)
- Chammo 앱은 **프로젝트 폴더 이름을 프로필 이름으로** 쓴다. 앱이 무엇을 부르는지는 `INTEGRATION.md`
- **스크립트**(node·python Playwright·puppeteer)는 크롬을 직접 띄우지 말고 `launch <프로필>` 로 받아 CDP 로 붙는다 — node 는
  `require('<데이터>/tools/chammo-browser').launch('<프로필>')` 한 줄. 락·앱 화면 연결·채널 기억을 같이 하고, 스크립트가 끝나거나 죽으면
  1초 안에 닫고 락을 돌려준다. 그 프로필 크롬이 이미 떠 있으면 같이 쓴다
- 프로필마다 크롬 채널(정품·베타)을 `ChammoChannel` 에 기억한다 — 정품으로 만든 프로필을 베타로 열면 판이 올라가 정품으로 다시 못 연다
