# Chammo

**Your AI chief of staff for Claude Code. You make the calls; it runs the team.**

[한국어](README.ko.md)

![Chammo demo](docs/screenshots/demo.gif)

Chammo (Korean *참모*, "chief of staff", said *CHAM-oh*) is a desktop app for macOS (Windows in preview) for one person running many projects at once. You talk to a single live Claude Code session — your chief of staff. It starts a background Claude Code session per project, hands out the work, reads the results, merges what is safe to merge, and comes back to you only for the calls that can't be undone. Every session is a real interactive Claude Code session you can open and type into at any moment, and each one shows up as a small pixel character in an office that works, reads and runs depending on what it is doing.

## Why

With five or ten projects open, the bottleneck is not the agents. It's you: switching terminals, re-reading context, approving things that didn't need you. Chammo flips that. The chief of staff handles delegation, follow-up and routine merges. You only see a short list of things that are actually yours to decide — a payment, a production database change, a pull request that touches money or security. Everything else keeps moving.

## Features

- **Chief of staff session** — one live Claude Code session in your HQ folder. Talk to it (or type); it delegates, follows up and reports back in one line.
- **One session per project** — real Claude Code background sessions (`claude --bg`), not one-shot `claude -p` runs. Slash commands like `/clear` and `/compact` work, and you can attach and take over any session yourself.
- **Decision inbox** — a bell dropdown with only what the chief of staff escalates to you. Replying types straight into the session that asked.
- **Payment and production gates** — delegating anything that mentions payments, refunds or billing is held until you answer. Sessions are also told to stop right before they touch production (a migration on the production DB, deleting production data, a production deploy or OTA, a send to real users) and ask first; projects that haven't launched yet can opt out.
- **Review and merge gates** — open PRs across your projects are checked for what is hard to undo: DB migrations, money and security (size is not a gate). Gated PRs wait for you with a 3-line summary and diff; the rest are merged by the chief of staff once CI is green. "Merged today" has a one-click revert PR.
- **Delegation that learns** — every instruction carries how hard to verify (careful for bugs, security and data; quick for sketches), a checklist-and-proof rule, and the project's lessons. Sessions end replies with `Lesson:` lines that become lessons for next time (copied into the project's git-ignored `CLAUDE.local.md` too, so sessions you open yourself see them). The task panel shows *Careful* / *Quick* and *Sent back N* (the third time says rethink the plan), and the notes window (⌘M) has a Lessons tab to prune them.
- **Session revive** — when the Claude Code daemon restarts, Chammo notices which sessions went down and brings them back with their conversations. Tasks left without an owner are listed too.
- **Permission prompts** — tool permission prompts in background sessions are answered with *Allow* by reading the prompt, never by guessing. Prompts that ask for a password, a 2FA code or a payment are left to you (the words are looked for in what the prompt asks, not in the command being approved). Messages between sessions that Claude Code holds for approval ("Held message from another session") are delivered the same way.
- **Stuck on a question** — if a project session stops on a multiple-choice question for 30 seconds, Chammo hands it to the chief of staff, who answers easy-to-undo ones (`scripts/choice`) and asks you about the rest. Sessions are also told to decide small things themselves instead of opening such prompts.
- **Voice** — replies are spoken with a macOS voice or Supertonic (a natural on-device voice, downloaded only if you pick it); you talk back with Claude Code's own voice input (hold space). Turning voice mode off stops whatever is being read.
- **Reader** — a tabbed side panel for HTML design reviews, PDF, Markdown, images and video. Tear tabs off into windows. Sessions can open files in it (`scripts/show`).
- **Day replay** — a day at a glance: commits per repo on a timeline, decisions made, and what carries over to tomorrow.
- **Context meter and notes** — per-session context usage, and a notes pad per project that you can send into the session.
- **Pixel office** — each session is a tamagotchi-like character at a desk. It types when editing, reads papers when reading, watches a progress bar when running commands, and the chief of staff walks paperwork over when it delegates.
- **Pet and gacha** — a pet that grows from your commits, PRs and CI runs (74 species), and a capsule machine fed by coins from merges and commits: office skins, furniture, hats, window views.
- **Projects with a harness** — new work gets its own project folder (the chief of staff names and creates it) with CLAUDE.md, a living `docs/starter.md` and `docs/roadmap.md` that each session reads first and updates when it finishes. Existing files are never overwritten; if you already use your own `project-starter` skill, Chammo uses that instead. Projects that live somewhere else stay where they are — add the folder from the sidebar ("Add folder"), Settings, or just ask the chief of staff.
- **Routines** — recurring work ("post to the blog every morning", "check orders every 2 hours") becomes a routine with its own instructions file — or runs once at a date and time you pick. macOS (Task Scheduler on Windows) wakes it on schedule even when the app is closed; each run is a real Claude Code session that follows the instructions and reports back. The sidebar shows the next run, the live run and the history. Claude sessions that your own cron or launchd jobs start in a project folder (in a tmux nobody is attached to, for example) are listed there too as *external schedules* instead of cluttering the project.
- **It operates the app for you** — ask the chief of staff to turn voice mode on, open settings, hide the office or jump to a session, and it does it.
- **A browser per project (optional)** — one "Install" button in Settings. It fetches only what is missing (Node.js, Chrome Beta, the tool parts — no admin password; downloads are used only after the official checksum or Google signature checks out). Each project gets its own Chrome profile that stays logged in, with a lock so two sessions never fight over one browser. Session browsers run in Chrome Beta, so they never mix with your everyday Chrome in the Dock, and you can watch them live inside the app.
- **Tools** — the wrench in the top bar lists MCP servers, plugins and skills. Turn them on per project or everywhere, add or remove servers, sign in, add marketplaces and install plugins.
- **Roles** — give each chief of staff a role ("development", "design") apart from its name. They see each other's roles and hand work to the right one.
- **Pages** — notes and documents open as Notion-like pages: drag blocks, insert with `/`, and edits made outside the app are merged instead of overwritten.
- **On your phone (optional, Tailscale)** — pair a phone with a QR code (Settings > Mobile) and talk to your chief of staff, answer decisions and get notifications from a home-screen web app. The server listens only on your tailnet.
- **Several Claude accounts (optional)** — keep more than one login in Settings > Accounts; Chammo can switch to the next one when the current one nears its limit.
- **Korean and English** — the whole UI, switchable in settings.

The playful parts (office, pet, gacha) can each be turned off.

| | |
|---|---|
| ![The chief of staff hands out one request to three projects](docs/screenshots/orchestrator.png) | ![Office](docs/screenshots/office.png) |
| ![Decision inbox](docs/screenshots/inbox.png) | ![Routines](docs/screenshots/routines.png) |
| ![Reader](docs/screenshots/reader.png) | ![Gacha](docs/screenshots/gacha.png) |
| ![Office next to the chief of staff](docs/screenshots/office-dock.png) | ![Settings](docs/screenshots/settings.png) |

## Requirements

- A Mac with Apple silicon (M1 or later), macOS 14 or later — or a Windows 10/11 x64 PC (preview, see below)
- An internet connection and a Claude account (Pro, Max, …)

Everything else — Xcode Command Line Tools, Claude Code (2.1.280+), signing in, GitHub CLI (optional) — is checked on first launch and installed or updated with one button. You don't need to set anything up beforehand.

## Install

**DMG** — download `Chammo_x.y.z_aarch64.dmg` from [Releases](https://github.com/honorstudio/chammo/releases), open it, drag `Chammo` into `Applications`, and launch it. Release DMGs are notarized by Apple, so they open with a double-click.

**One line in Terminal** — downloads the latest DMG, puts the app in `/Applications` and opens it.

```sh
curl -fsSL https://raw.githubusercontent.com/honorstudio/chammo/main/scripts/install.sh | bash
```

**Windows (preview)** — the Windows build is currently 0.2.3; 0.2.4 for Windows is coming soon. Download `Chammo_x.y.z_x64-setup.exe` from [Releases](https://github.com/honorstudio/chammo/releases) and run it. It installs for your user only (no administrator prompt) and fetches WebView2 if it is missing. The installer is not code-signed yet, so SmartScreen may say *Windows protected your PC* — click **More info > Run anyway**. First launch checks git (installed with winget) and Claude Code the same way the Mac version does. The chief of staff's helper scripts need **Python 3** (`py -3` or `python`) — install it from python.org or with `winget install Python.Python.3.12` if you don't have it. Shortcuts swap ⌘ for Ctrl: Ctrl+Shift with letters (⌘B → Ctrl+Shift+B), plain Ctrl with digits and symbols (⌘1 → Ctrl+1, ⌘, → Ctrl+,). Routines are scheduled with Windows Task Scheduler.

**From source** — needs Rust (stable), Node.js 22+, pnpm and Xcode Command Line Tools.

```sh
git clone https://github.com/honorstudio/chammo.git
cd chammo/app
pnpm install
pnpm tauri build
```

The app lands in `app/src-tauri/target.noindex/release/bundle/macos/Chammo.app`. Your own build isn't notarized, so the first launch says the developer can't be verified — click **Open Anyway** at the bottom of **System Settings > Privacy & Security**, or run `xattr -dr com.apple.quarantine /Applications/Chammo.app` once. macOS ties microphone and notification permissions to the app's signature; if it asks again after every rebuild, sign with your own Apple Development identity.

## First run

A five-step setup wizard opens. One thing per screen; you move on once it's done.

1. **Welcome & language** — Korean or English.
2. **Check this Mac** — Xcode Command Line Tools, Claude Code (updated if it's too old), Claude sign-in, GitHub sign-in (optional). Anything missing is one button away, handled in a terminal inside the app.
3. **Basics** — the assistant's name, the **projects folder** (where your repos live — each folder inside is a project) and the **HQ folder** (where the chief of staff session runs — created with its instructions and helper scripts). Pick folders with **Choose** in the standard macOS dialog. Last, let Claude Code **trust** both folders once (in the terminal, press ↓ to *Yes, I trust this folder*, then Enter).
4. **Features** — turn the office, Tamagotchi, gacha, review and voice on or off, install browser automation (optional), and choose whether sessions may control your screen (off by default).
5. **Ready** — a summary, then Chammo starts the chief of staff session.

Chammo does not log in to anything; it uses the `claude` login already on your Mac (if it expires, the decision inbox tells you). Reopen settings any time with **Chammo > Settings…** (⌘,). The layered button at the top right opens **Harnitor** — view, toggle and undo skills, hooks, MCP servers and plugins.

## Shortcuts

| Keys | What |
|---|---|
| ⌘1 – ⌘9 | Chat view (default): switch chat tabs (assistants) |
| ⌥⌘1 · ⌥⌘2 · ⌥⌘3 · ⌥⌘4 | Chief of staff · all sessions · review · office (⌘1–4 with the chat view off) |
| ⌘` | Maximize / restore the focused pane |
| ⌘Enter | Chat: interrupt and send now |
| ⌘F | Find in document |
| ⌘T · ⌘W | New session · stop the focused session (the conversation is kept) |
| ⌘K · ⌘B · ⌘J | Project search · sidebar · task panel |
| ⌘E · ⌘⇧E | Reader panel · reader full size |
| ⌘M | Notes for the focused project |
| ⌘, | Settings |

**Talk key** (Settings > Talk key, off by default): hold the key and speak to dictate into the session input you are looking at. Pick Globe (fn) or right ⌥; pressing it together with another key does not count. If you pick Globe, set macOS "Press 🌐 key to" to "Do Nothing". Accessibility permission is asked only when you turn on "Also while using other apps". It needs Claude Code voice input (`/voice`) turned on, and if the dictated text is still unsent a few seconds after you stop talking, the chat view sends it.

Each chat tab remembers the screen you were on, and switching tabs or jumping to a session from a notification leaves its input ready to type in.

## How it works

```
 you ──voice / keys──▶  Chief of staff (live Claude Code session in HQ folder)
                              │  scripts/task send · SendMessage
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
     acme-shop           pixel-blog           todo-api        ← claude --bg, one per project
          │                   │                   │
          └──── PRs ──▶ review gates (review.json) ──▶ merge, or ask you
```

- **Sessions** are Claude Code's built-in background sessions. Chammo reads their state from `claude agents --json` and shows each one by running `claude attach <id>` in a pseudo-terminal rendered with xterm.js.
- **Delegation** is logged by the chief of staff with `scripts/task` to `tasks.jsonl`; the task panel reads that file. `scripts/task ask` puts a question in your decision inbox.
- **Gates** are computed from PR files, titles and bodies (no AI calls) and written to `review.json`, which the chief of staff reads before merging.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Configuration

Everything lives in the data folder: `$CHAMMO_HOME`, or `~/.chammo` by default. `config.json` is edited by the settings screen, but you can change it by hand:

| Field | Meaning | Default |
|---|---|---|
| `language` | `"ko"` or `"en"` | system language |
| `assistantName` | name of your chief of staff | `Chammo` / `참모` |
| `devRoot` | projects folder | `~/Developer` or `~/Projects` (whichever exists); the setup wizard lets you pick or create one. The Desktop is never read until you choose it |
| `hqDir` | chief of staff's folder | `<data>/hq` |
| `githubUser` | used for review and CI | from `gh api user` |
| `ttsCommand` | command that speaks a line of text (Settings > Voice writes it) | macOS `say` |
| `memoDir` | where session notes are stored | `<data>/memo` |
| `features` | `office`, `tama`, `gacha`, `review`, `voice`, `agentView` (watch session browsers in the app), `autoRevive` (bring stopped sessions back on their own — for unattended Macs), `computerUse` (let sessions control the screen in every project) | on, except `autoRevive` and `computerUse` |

## Voice

Turn on voice mode in the top bar. When the chief of staff finishes a reply or asks you something, Chammo speaks a short version of it. Pick the voice in Settings > Voice:

- **macOS voice** — works right away; choose any installed voice for your language.
- **Supertonic** — a more natural voice that runs entirely on your Mac (no internet, about 1–2 s per sentence). Nothing is downloaded until you press **Download** (about 550 MB: a Python package and the Supertone voice model, OpenRAIL-M license). Needs `python3` (Xcode Command Line Tools).
- **Custom command** — any local or cloud TTS that takes the text as its last argument (saved as `ttsCommand`).

The assistant can also hand over exactly what to say with `scripts/say`, so tables and code don't get read aloud.

To talk back, hold space in the chief of staff's terminal — that's Claude Code's own voice input. Chammo turns off macOS press-and-hold for itself so key repeat reaches Claude Code.

## Privacy

Chammo runs entirely on your Mac. It has no server, no account and no telemetry. It never sends your conversations or code anywhere — all model traffic is Claude Code's, and all GitHub traffic is `gh`'s, with your own logins. Chammo itself reaches the internet only for the things below — apart from the version check, only when you use that feature:

- **Version check** — at launch and every few hours it reads the latest Claude Code version from the npm registry and the latest Chammo release from GitHub. No login; nothing about you is sent.
- **Browser automation install** (when you press Install) — downloads Node.js from nodejs.org, Chrome Beta from dl.google.com and the browser tool parts from the npm registry. Plain downloads; nothing about you is sent.
- **Account usage** (only if you saved accounts in Settings > Accounts) — asks api.anthropic.com for each account's 5-hour and weekly usage with that account's own sign-in token, the same request Claude Code's `/usage` makes. Only the percentages and reset times are kept.
- **Phone notifications** (only if you paired a phone and turned notifications on) — the notification's title and one line go to your phone's push service (Apple, Google or Mozilla), end-to-end encrypted so the push service can't read them.
- **Harnitor fonts** — opening the Harnitor screen loads its fonts from Google Fonts.
- **Installers you start** — the setup wizard's install buttons (Claude Code from claude.ai, the GitHub CLI, …) and the Supertonic voice's **Download** (a Python package from PyPI and the Supertone model) fetch from their official sources.

Its files stay in the data folder.

## Status and limitations

- **Early.** Chammo started as one person's daily tool and was opened up as is.
- **It relies on undocumented Claude Code internals** — background sessions, `claude agents --json`, `claude attach`, the daemon lock file. It is tested with Claude Code 2.1.28x. A Claude Code update can break it; Chammo shows a warning when your version is outside the tested range.
- **Background sessions run with `--dangerously-skip-permissions`.** The sessions act without asking. Chammo's gates (payments, production changes, gated merges) sit in front of that, but only use it on projects and machines where you're comfortable with that.
- **Windows is a preview.** It covers chat, terminals, delegation, decisions, choices, routines and notifications. Not there yet: the talk key, Supertonic (replies are read with a Windows voice), Word/Office file previews, and a signed installer. The per-project browser hasn't been tested on Windows. In the terminal view Hangul is drawn a little wider than on the Mac.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests and the few house rules.

## License

[AGPL-3.0](LICENSE) © 2026 Honor Studio

Third-party: the terminal's Hangul font `app/public/fonts/ChammoHangul.woff2` is a modified (Hangul-only) version of NAVER [D2Coding](https://github.com/naver/d2codingfont), renamed as the SIL Open Font License 1.1 requires — see [`app/public/fonts/OFL.txt`](app/public/fonts/OFL.txt). The optional Supertonic voice is downloaded to your Mac only when you pick it: the `supertonic` package (MIT) and the Supertone model under the [OpenRAIL-M license](https://huggingface.co/Supertone/supertonic-3) with its use restrictions. Libraries (Tauri, React, xterm.js, BlockNote, pdf.js, Playwright MCP, …) keep their own licenses (MIT / Apache-2.0 / MPL-2.0); see each package.

Chammo is an independent project. It is not affiliated with, endorsed by, or sponsored by Anthropic. Claude and Claude Code are trademarks of Anthropic.
