# {{name}}

> Start every session by reading **docs/starter.md** — it says where things stand and what's next.
> The big picture and the tech-debt list live in **docs/roadmap.md**.

## What this project is

{{summary}}

## Rules

1. **Read docs/starter.md first, update it when you finish.** Current stage, what's done, the next 3–5 steps,
   decisions you made (with the date). Keep it under ~8,000 characters — move old history to docs/starter-archive.md.
2. **Write debt down the moment you create it** — temporary code, TODOs, anything you skipped — in the
   "Tech debt" section of docs/roadmap.md.
3. **Tests first** for new logic and for every bug fix (a failing test that reproduces the bug, then the fix).
[git] 4. **Small commits** — one reason per commit, ideally under 300 changed lines. Don't commit design, video or archive originals (.gitignore; a hook stops files over 10 MB once) — if one really must go in, commit again with CHAMMO_BIG_OK=1 and give the reason in the commit message.
[nogit] 4. **This project doesn't use git** — no git init, commits or branches. Keep a copy of an original before changing it, and keep results in this folder.
5. **Decisions that are expensive to undo** (framework, database, hosting) go in docs/decisions/ as a short ADR
   with a measurable "revisit when" condition.
[git] 6. Put screenshots, logs and dumps in `.shots/` (git-ignored), not in the project root.
[nogit] 6. Put screenshots, logs and dumps in `.shots/`, not in the project root.

## Stack

(Fill in once chosen.)

## Work cycle

[git] branch → tests first → build → verify it actually works → commit → update docs/starter.md
[nogit] make it → verify it actually works (captures in .shots/) → update docs/starter.md — when you say done, include the result's file path
