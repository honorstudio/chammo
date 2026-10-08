# Integrating chammo-browser into the Chammo app

What the app should do to give every project session its own browser profile. Nothing here is wired yet.

## 1. Requirements

- **Node.js 20+** on the machine (`node --version`). `@playwright/mcp` 0.0.80 pulls a Playwright build that declares `engines.node >= 20`.
  Claude Code itself does not guarantee a `node` binary, so the setup wizard should check and explain if it is missing.
- **npm** (comes with Node) for the one-time dependency install.
- **Google Chrome** installed — `@playwright/mcp` uses the `chrome` channel by default. Without it the first browser tool call fails with an install hint; nothing else breaks.

## 2. Install (once, and again when the bundled tool changes)

Keep the tool code and the user's profiles in separate folders, so reinstalling never touches logins:

```
<data>/tools/chammo-browser/   tool code + node_modules   (replaceable)
<data>/browser/                profiles/ and locks/        (user data — never delete on update)
```

`<data>` = `$CHAMMO_HOME`, else `~/.chammo` (legacy `~/.honor-orchestrator` if `~/.chammo` does not exist) — the same rule as `scripts/show`.

```bash
# copy the bundled tools/chammo-browser (without node_modules) to <data>/tools/chammo-browser, then:
cd <data>/tools/chammo-browser
npm ci --omit=dev --no-audit --no-fund
```

- `npm ci` uses the committed `package-lock.json`, so every machine gets the same pinned `@playwright/mcp`. There are no devDependencies today; `--omit=dev` keeps it that way.
- Skip the reinstall when `package-lock.json` is unchanged (compare a hash) — it only needs the network the first time.
- After install, a quick health check: `node <data>/tools/chammo-browser/bin/chammo-browser.js status` exits 0.

## 3. Per project: setup

Profile name = **project folder name** (basename).

```bash
node <data>/tools/chammo-browser/bin/chammo-browser.js setup <folder-name> <absolute project dir>
```

- Exit `0` = done, `1` = error (reason on stderr: bad profile name, missing folder, `.mcp.json` not valid JSON — it is never overwritten in that case).
- It writes/merges `<project>/.mcp.json` → `mcpServers.playwright` = `{ type: "stdio", command: <realpath of node>, args: [<wrapper abs path>, <profile>] }`. Other servers are kept.
  If it replaced a different `playwright` entry, stdout contains `원래 있던 playwright 항목을 바꿨습니다:` followed by the old JSON — the app may want to surface that.
- **Idempotent.** Re-run it after a Node upgrade or after moving the tool: the entry holds absolute paths, so a removed Node version breaks it until setup runs again. Running it on every app start (or when the wizard finishes) is cheap.
- Run it with the same `CHAMMO_HOME` the app uses. If `CHAMMO_HOME` or `CHAMMO_BROWSER_HOME` is set, setup writes the resolved root into the entry's `env`, so the wrapper uses it even if Claude does not inherit the variable.
- Profile names may not be empty, start with `.`, or contain `/`, `\` or NUL. A project folder starting with `.` needs a mapped name (e.g. strip the leading dots).

## 4. Things the app should know

- **Timing:** Claude Code reads `.mcp.json` when a session starts. Sessions already running need a restart to pick it up.
- **Trust prompt:** project `.mcp.json` servers need a one-time approval. Background sessions cannot answer it, so the app should pre-approve, e.g. `"enabledMcpjsonServers": ["playwright"]` in `<project>/.claude/settings.local.json`.
- **Absolute paths in `.mcp.json`:** the file becomes machine-specific. If the project repo commits `.mcp.json`, warn the user (or offer to add it to that repo's `.gitignore`). An alternative is a local-scope server (`claude mcp add --scope local ...`), which lives outside the repo and outranks `.mcp.json`.
  Chammo does exactly this for projects it did not create (cloned repos): `browser_attach.rs` writes our entry into `~/.claude.json` `projects.<git root>.mcpServers` — as `playwright`, or as `chammo-browser` when the repo already has a `playwright` — and leaves the repo's `.mcp.json` alone.
- **Showing lock state:** read `<data>/browser/locks/*.lock` directly — JSON `{ profile, pid, startedAt }`. A lock whose pid is dead is stale (`chammo-browser clean` removes those; `unlock <profile>` forces one).
- **Idle release:** a session that stops using the browser gives the profile back after 10 minutes (`--idle-minutes=N` in `args`, `0` = never).
- **Logging in:** the first time a project needs a site, the user logs in inside that profile's browser window; later sessions of the same project start logged in.
- **Scripts:** project scripts get their browser with `chammo-browser launch <profile>` (README → Scripts). The holder writes the
  same `<data>/browser/live/<profile>.json` as the wrapper (pid = holder, `sessionPid` = `CLAUDE_PID`), so the app needs nothing new.
  Script users are listed in `<data>/browser/locks/<profile>.users/<pid>`; a `<profile>.closing` file means the owner is closing.

