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
4. **Small commits** — one reason per commit, ideally under 300 changed lines.
5. **Decisions that are expensive to undo** (framework, database, hosting) go in docs/decisions/ as a short ADR
   with a measurable "revisit when" condition.
6. Put screenshots, logs and dumps in `.shots/` (git-ignored), not in the project root.

## Stack

(Fill in once chosen.)

## Work cycle

branch → tests first → build → verify it actually works → commit → update docs/starter.md
