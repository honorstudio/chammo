# Contributing to Chammo

Thanks for taking a look. Chammo is small and opinionated; these few rules keep it that way.

## Setup

You need macOS 14+, Rust (stable), Node.js 22+, pnpm, Xcode Command Line Tools, and Claude Code 2.1.28x logged in.

```sh
cd app
pnpm install
pnpm tauri dev
```

To keep your real sessions and settings apart while developing, point the app at a scratch data folder:

```sh
CHAMMO_HOME=/tmp/chammo-dev pnpm tauri dev
```

When you test against real background sessions, clean them up afterwards with `claude rm <id>`.

## Tests

Run all three before opening a PR:

```sh
cd app
pnpm test                               # vitest — domain logic
pnpm typecheck                          # tsc --noEmit
cargo test --workspace --manifest-path src-tauri/Cargo.toml   # app + vendored Harnitor engine
```

Where code goes:

- `app/src/domain/` — pure TypeScript, no DOM, no Tauri. Parsing, decisions, state machines. **Every change here comes with a test** next to it (`*.test.ts`). Write the failing test first for bug fixes.
- `app/src/ui/` — React components. Keep logic out; call into `domain/`.
- `app/src-tauri/src/` — Rust. Runs commands, files, pty and macOS APIs. It passes raw output to the front end rather than interpreting it.

## Commits

- **At most ~300 changed lines per commit.** One commit = one reason you'd want to revert it. Split mechanical changes (renames, formatting) from logic changes. Generated files (lockfiles, sprites) are the exception — say so in the message.
- Commit messages in English or Korean are both fine.

## UI rules

- **No emoji and no icon libraries** (no lucide, heroicons, etc.). Prefer text labels. If a visual icon is really needed, draw it as a small custom SVG in `app/src/ui/Icons.tsx`.
- Standard spacing and platform conventions; don't invent new controls when a normal button will do.
- Both light and dark mode must stay readable (terminal colors have a minimum contrast of 4.5).

## Text and i18n

Every user-facing string is written in both languages on one line:

```ts
import { tr, assistant } from '../i18n';

tr('저장', 'Save');
tr(`${assistant()}에게 보내기`, `Send to ${assistant()}`);
```

- No key dictionaries — the Korean and English sit side by side where they're used.
- Never hard-code the assistant's name; use `assistant()`.
- Tests run in Korean by default and must keep passing.
- On the Rust side use the small `tr(ko, en)` helper that reads `language` from `config.json`.

## Claude Code internals

Chammo depends on undocumented parts of Claude Code (`claude --bg`, `claude agents --json`, `claude attach`, the daemon lock file). If you find something that changed in a newer Claude Code version, an issue with the version number and the output you saw is very helpful.

## License

By contributing you agree that your contribution is licensed under the [AGPL-3.0](LICENSE).
