---
name: hq-cleaner
description: 사용자가 정리해 줘·용량 없어·디스크 꽉 찼어·파일 어디 뒀지 할 때, 매주 정리 예약이 돌 때, 다른 참모가 정리 목록을 넘겼을 때 연다. Cleaning up — "tidy up", "out of disk space", weekly cleanup job, moving a project's files home.
---

<!-- Chammo 가 HQ 를 켤 때마다 새로 쓴다 — 고치지 않는다. / Rewritten by Chammo on every start — do not edit. -->

# 한국어

## 무엇을 어디에 두나 · 정리

**무엇을 어디에 두나**

| 종류 | 둘 곳 |
|---|---|
| 캡처·덤프·로그 | 한 프로젝트 것은 `<프로젝트>/.shots/<일 이름>/`. HQ `.shots/` 에는 참모 자기 일만 |
| 결과물 | 프로젝트 안(`docs/` 등). 보관함에는 바로가기만. 여러 프로젝트에 걸치면 보관함 `~/Documents/Chammo/<참모>/` |
| 교훈 | 프로젝트 교훈은 `scripts/task lesson <프로젝트>`(그 프로젝트 `CLAUDE.local.md` 에도 남는다), 공통은 `--all` |
| 메모리 | 그 프로젝트 사정이면 그 프로젝트 `CLAUDE.local.md`·`docs/starter.md`. 사람·선호·여러 프로젝트에 걸친 것만 참모 메모리 |
| 계정·키 | 프로젝트 `CLAUDE.local.md`(gitignore). 정리 담당은 건드리지 않는다 |
| 임시 파일 | 세션의 `$CLAUDE_JOB_DIR/tmp`. 남길 것은 위 칸으로 옮긴다 |

**누가 하나** — 정리는 '정리' 도우미 세션이 한다. 참모가 `scripts/task send 정리 "<할 일>"` 로 먼저 기록한 뒤 HQ 에서
`claude --bg --dangerously-skip-permissions -n 정리 "/hq-cleaner <할 일>"` 로 띄우고, 끝나면 `claude stop` 한다.
매주 예약으로도 돈다 — 정리 도우미가 처음 돌 때 `scripts/clean schedule --as <부른 참모>` 를 부른다(`cleaner` 예약이 없을 때만 매주 월 08:00 로 걸고, 있으면 그대로).

**손은 `scripts/clean`**

- `scripts/clean scan [--json] [--scope job,worktree,browser,data,shots,move] [--as <참모>]` — 읽기만 한다.
- `scripts/clean run [--as <참모>]` — 모드가 report(처음·기본)면 목록만 낸다. apply 면 '알아서'를 지우고 '옮기기'를 옮긴 뒤 나머지 목록과 여유 공간 전후를 낸다.
- `scripts/clean mode report|apply` — 모드를 바꾼다.
- `scripts/clean move <경로> <프로젝트>` — 그 프로젝트 `.shots` 로 옮기고 옛 자리에 바로가기를 둔다.
- `scripts/clean trash <경로>…` — 사용자가 고른 '묻기' 항목만 휴지통으로 보낸다.
- `scripts/clean restore <run id|경로>` — 옮기기·휴지통을 되돌린다.
- `scripts/clean alias <이름> <프로젝트>` — "이 이름은 이 프로젝트"로 남긴다. 다음부터 확실로 본다.
- 장부는 `<데이터 폴더>/cleaner/ledger.jsonl`, 설정은 `<데이터 폴더>/cleaner.json`(`mode`·`aliases`·`generic`(프로젝트로 안 맞출 흔한 이름, 와일드카드 가능)·`keep`(안 건드릴 경로)·`unownedAuto`).

**갈래 여섯**

| 갈래 | 뜻 | 예 |
|---|---|---|
| auto 알아서 | 다시 만들어지는 것. 휴지통이 아니라 바로 지운다(휴지통은 공간을 안 비운다) | 끝난 세션이 7일 조용한 `~/.claude/jobs/<id>/tmp`, 변경 0·세션 없음·3일 조용한 워크트리의 `node_modules`·`target`·`.next`·`dist`, 쓰는 중 아닌 브라우저 프로필의 캐시 폴더, 옛 브라우저 사본, 프로젝트 `.shots` 의 7일 넘은 그림·로그, 앱 tmp 7일+·미리보기 그림 30일+, 대상이 사라진 보관함 바로가기 |
| move 옮기기 | HQ `.shots` 에 있는데 한 프로젝트 것이 확실한 것 | |
| ask 묻기 | 사람 손이 간 것 | 7일 넘은 그 밖 파일(dmg·zip·md·pdf), 프로젝트 없는 브라우저 프로필 14일 안 씀(로그인이 들어 있다), 30일 넘은 백업 |
| ask-move | 누구 것인지 애매 | 후보가 둘 이상, 보관함 항목, 한 프로젝트 사정만 담은 메모리 |
| ask-owner | 다른 참모가 맡은 프로젝트 것 | 그 참모에게 먼저 묻는다 |
| keep | 비밀처럼 보이는 파일(키·ssh·`.env`·pem 등) | 지우지도 옮기지도 않는다. 그 프로젝트 `CLAUDE.local.md` 나 키체인으로 옮기라고 사용자에게 한 줄 |

**절대 안 건드린다** — git 이 추적하는 파일, 커밋 안 한 변경이 있는 워크트리, 돌고 있는 세션의 폴더, 설정·계정·키·쿠키/로그인 상태, Claude 대화 기록(Claude Code 가 30일로 알아서 지운다), tasks·앱 기록, 설치한 참모 앱·음성 모델, 스킬·플러그인(하니터 몫).

**어느 프로젝트 것인지 가르는 순서** — 이미 프로젝트 폴더 안 > 일 기록(그 경로를 증거로 적은 일이 모두 한 프로젝트 세션) > 이름·별명이 프로젝트 하나 > 안쪽 파일 이름(이건 애매로만 본다). 흔한 이름은 `generic` 으로 뺀다.

**하는 순서**

1. `scripts/clean run --as <부른 참모>` 를 돈다.
2. 처음엔 report 모드다. 결과를 부른 참모에게 요약해 보낸다 — 알아서 합계, 옮기기, 묻기는 프로젝트·주인별 묶음, `df` 로 여유 공간.
3. 묻기는 카드 한 장에 묶는다: `scripts/direct ask "<한 줄>" --kind delete --detail "<프로젝트별 크기 목록>"`. 사람이 고른 것만 `trash` 한다. 누구 것인지 애매하면 `--kind other` 로 "이거 ○○ 거 맞아?" 목록을 올리고, 답을 받으면 `alias` 로 남기고 `move` 한다.
4. ask-owner 는 그 참모에게 SendMessage 로 목록(프로젝트·크기·경로)을 보낸다. 그 참모가 답하거나 사용자에게 모아서 묻는다. 정리 도우미가 사용자에게 바로 묻지 않는다.
5. 사용자가 "알아서 해도 돼"라고 하면 `scripts/clean mode apply` 로 바꾼다. 다음부터 알아서·옮기기는 바로 한다.
6. 실제로 비운 양은 `df` 전후로 보고한다. `du` 숫자대로 안 빈다 — pnpm `node_modules` 는 저장소와 공유돼 절반쯤만 빈다(실측 0.97GB → 0.54GB).

**하지 않는다** — 목록 밖 파일을 손으로 `rm` 하지 않는다(늘 `scripts/clean` 으로, 장부가 남게). 휴지통을 비우지 않는다(사람이 "비워"라고 할 때만). 다른 참모 것을 묻지 않고 지우지 않는다. 비밀 파일을 열어 내용을 채팅에 옮기지 않는다. 교훈·메모리 합치기는 이 스킬 몫이 아니다(교훈은 `scripts/task lesson-review`).

# English

## Where things go · cleanup

**Where things go**

| Kind | Put it |
|---|---|
| Captures, dumps, logs | One project's go in `<project>/.shots/<job name>/`. HQ `.shots/` holds only the assistant's own work |
| Results | Inside the project (`docs/` etc.). The locker gets shortcuts only. If it spans projects, the locker `~/Documents/Chammo/<assistant>/` |
| Lessons | A project's lessons: `scripts/task lesson <project>` (also kept in that project's `CLAUDE.local.md`); shared ones with `--all` |
| Memory | If it's about that project, its `CLAUDE.local.md` / `docs/starter.md`. Only people, preferences and things spanning projects go to the assistant's memory |
| Accounts, keys | The project's `CLAUDE.local.md` (git-ignored). The cleaner never touches them |
| Temp files | The session's `$CLAUDE_JOB_DIR/tmp`; move anything worth keeping into a row above |

**Who does it** — cleanup is done by a "cleaner" (`정리`) helper session. Record it first with `scripts/task send 정리 "<the job>"`, then from the HQ run
`claude --bg --dangerously-skip-permissions -n 정리 "/hq-cleaner <the job>"`, and `claude stop` it when done.
It also runs as a weekly job — on its first run the cleaner helper calls `scripts/clean schedule --as <calling assistant>` (it sets up `cleaner` for Mondays 08:00 only if there is none yet).

**The hands are `scripts/clean`**

- `scripts/clean scan [--json] [--scope job,worktree,browser,data,shots,move] [--as <assistant>]` — read-only.
- `scripts/clean run [--as <assistant>]` — in report mode (the default, and the first mode) it only lists. In apply mode it deletes the "auto" items and moves the "move" items, then lists the rest and free space before and after.
- `scripts/clean mode report|apply` — switch the mode.
- `scripts/clean move <path> <project>` — moves it to that project's `.shots` and leaves a shortcut in the old place.
- `scripts/clean trash <path>…` — sends only the "ask" items the user picked to the trash.
- `scripts/clean restore <run id|path>` — undoes moves and trash.
- `scripts/clean alias <name> <project>` — records "this name is this project", so it counts as certain from then on.
- The ledger is `<data folder>/cleaner/ledger.jsonl`; settings are `<data folder>/cleaner.json` (`mode`, `aliases`, `generic` (common names not matched to a project, wildcards allowed), `keep` (paths never touched), `unownedAuto`).

**Six groups**

| Group | Meaning | Examples |
|---|---|---|
| auto | Things that get rebuilt. Deleted outright, not trashed (the trash doesn't free space) | `~/.claude/jobs/<id>/tmp` of a finished session quiet for 7 days; `node_modules`, `target`, `.next`, `dist` of a worktree with 0 changes, no session and quiet for 3 days; cache folders of a browser profile not in use; old browser copies; project `.shots` pictures and logs older than 7 days; app tmp 7+ days and preview pictures 30+ days; locker shortcuts whose target is gone |
| move | In HQ `.shots` but clearly one project's | |
| ask | A person's hands touched it | Other files over 7 days old (dmg, zip, md, pdf); browser profiles with no project unused for 14 days (they hold logins); backups over 30 days |
| ask-move | Unclear whose it is | Two or more candidates, locker items, memory that only holds one project's circumstances |
| ask-owner | Belongs to a project another assistant handles | Ask that assistant first |
| keep | Looks like a secret (keys, ssh, `.env`, pem …) | Neither deleted nor moved; tell the user in one line to move it to that project's `CLAUDE.local.md` or the keychain |

**Never touched** — files git tracks, worktrees with uncommitted changes, folders of running sessions, settings, accounts, keys, cookies and login state, Claude conversation history (Claude Code clears it itself after 30 days), tasks and app records, installed Chammo apps and voice models, skills and plugins (Harnitor's job).

**Deciding which project something belongs to, in order** — already inside a project folder > the task log (every task that names that path as evidence is one project's session) > a name or alias matching exactly one project > file names inside (only ever as "unclear"). Pull common names out with `generic`.

**Steps**

1. Run `scripts/clean run --as <the assistant who called you>`.
2. At first it's report mode. Summarize the result to the calling assistant — the auto total, the moves, and the asks grouped by project and owner, plus free space from `df`.
3. Bundle the asks into one card: `scripts/direct ask "<one line>" --kind delete --detail "<size list by project>"`. `trash` only what the person picked. If whose it is is unclear, put up a `--kind other` list "is this ○○'s?", and when answered record it with `alias` and `move`.
4. For ask-owner, SendMessage that assistant the list (project, size, path). They answer, or gather it and ask the user once. The cleaner helper doesn't ask the user directly.
5. If the user says "go ahead on your own", run `scripts/clean mode apply` — from then on auto and move happen right away.
6. Report the space actually freed as `df` before and after. It won't match `du` — pnpm `node_modules` is shared with the store, so only about half comes back (measured 0.97GB → 0.54GB).

**Don't** — `rm` files outside the list by hand (always go through `scripts/clean` so the ledger stays); empty the trash (only when the person says "empty it"); delete another assistant's things without asking; open a secret file and copy its contents into chat; merge lessons or memory (not this skill's job — lessons are `scripts/task lesson-review`).
