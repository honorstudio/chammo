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

## Commands

```
chammo-browser status                 lock status (default)
chammo-browser unlock <profile>       force-release a lock
chammo-browser clean                  remove locks whose process is dead
chammo-browser profiles               list profiles
chammo-browser setup <profile> [dir]  register playwright in dir/.mcp.json (merge)
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
```

The `verify-*` scripts launch a real browser and use a temporary `CHAMMO_BROWSER_HOME`.

## License

AGPL-3.0-only, same as the Chammo app.

---

## 한국어 요약

**프로젝트마다 로그인이 유지되는 격리 크로미움 프로필을 주고, 같은 프로필을 두 세션이 동시에 못 쓰게 락으로 막는 도구**다.
Playwright 는 크로미움의 `SingletonLock` 을 무시해서 같은 프로필을 두 번 열어도 에러 없이 프로필이 조용히 망가질 수 있다 — 그래서 락이 유일한 방어선이다.

- 설치: 이 폴더에서 `npm install` (Node 20 이상)
- 셋업: `node bin/chammo-browser.js setup <프로필> <프로젝트 폴더>` → 그 폴더 `.mcp.json` 에 playwright 등록(다른 서버는 유지)
- 락은 첫 브라우저 도구 호출 때 잡고, `browser_close` 성공·세션 종료·10분 유휴 때 놓는다
- 저장 위치: `$CHAMMO_HOME/browser` 또는 `~/.chammo/browser` (`CHAMMO_BROWSER_HOME` 으로 바꿀 수 있음)
- Chammo 앱은 **프로젝트 폴더 이름을 프로필 이름으로** 쓴다. 앱이 무엇을 부르는지는 `INTEGRATION.md`
