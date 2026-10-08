---
name: hq-app
description: 사용자가 앱 설정·화면을 바꿔 달라·켜져 있어?(scripts/app), 스킬·MCP·설정을 묻거나(하니터), 맥이 느리다, 앱을 어떻게 쓰냐고 할 때 연다. Operating the app with scripts/app, Harnitor, a slow Mac, guiding the user around the app.
---

<!-- Chammo 가 HQ 를 켤 때마다 새로 쓴다 — 고치지 않는다. / Rewritten by Chammo on every start — do not edit. -->

# 한국어

## 앱 대신 조작하기

사용자가 앱에서 뭔가 바꿔 달라고 하면("음성 모드 켜 줘", "설정 열어 줘", "acme-shop 대시보드로 가 줘", "사무실 꺼 줘")
버튼 위치를 알려 주지 말고 `scripts/app` 으로 바로 하고, 한 일을 한 줄로 말한다.
"○○ 거 보여 줘·띄워 줘"는 **문서·결과물**을 보자는 말이다 — 그 파일을 `scripts/show` 로 띄운다. 세션 터미널(CLI)은 사용자가 터미널·CLI 라고 할 때만(`focus --terminal`).

```
scripts/app status                                    # X 켜져 있어? — 설정·기능·음성 모드·브라우저 자동화
scripts/app voice on|off
scripts/app feature office|tama|gacha|review|voice on|off   # 설정 > 기능과 같다
scripts/app open settings|tour|office|review|all|replay|load|reader|tasks|inbox|home|harnitor|tools
scripts/app close settings|office|reader|tasks|inbox|harnitor|tools|review
scripts/app harness [<프로젝트>]                       # 사용자 하네스를 글로(스킬·MCP·훅·플러그인·진단)
scripts/app focus <세션 id|이름|프로젝트>              # 그 프로젝트 대시보드(채팅 뷰면 스페이스에)
scripts/app focus --terminal <세션|프로젝트>         # 그 터미널(CLI) — 사용자가 터미널을 말할 때만
scripts/app pet show|hide                             # 다마고치 창
scripts/app project list|add <폴더>|remove <이름>      # devRoot 밖 프로젝트 폴더
scripts/app browser status|connect <프로젝트|폴더>   # 있던(clone) 프로젝트에 전용 브라우저 붙이기 — 저장소 파일은 그대로
scripts/app load                                      # 이 맥 부하, 세션별
```

"X 켜져 있어?"는 기억 말고 `scripts/app status` 로 답한다. 기능이 꺼져 있다고 경고가 나오면 먼저 켠다
(`scripts/app feature <이름> on`). "사무실 꺼 줘"는 보통 사무실 화면에서 나가기(`close office`),
"사무실 기능 없애 줘"는 `feature office off`.

## 사용자 하네스(하니터)

"내 스킬 뭐 있어?", "이 MCP 왜 안 떠?", "설정이 너무 무거워?" → `scripts/app harness`(프로젝트 이름을 붙이면 그 프로젝트까지)를 보고
답한다: 개수·꺼 둔 것·진단(문제/비용/상태). 보여 줄 땐 `scripts/app open harnitor`. **끄기·지우기·옮기기는 앞으로 켜는 모든 세션을
바꾼다** — 무엇을 왜 바꿀지 한 줄로 말하고 사용자가 좋다고 한 뒤에만: 사용자가 하니터에서 끄고 켜거나(백업 먼저·되돌리기 있음),
네가 그 답을 받고 한다. 바꾼 건 새로 켜는 세션부터 먹는다.

## 맥이 느릴 때

"맥이 왜 이렇게 느려?", "뭐가 CPU 먹어?" → `scripts/app load` 를 보고 답한다: 어느 세션이 무겁고 그 안에서 뭐가 도는지
(Rust 빌드·헤드리스 브라우저·개발 서버·시뮬레이터), 끝난 세션이 남긴 프로세스가 있는지. 해결은 한 줄로 제안한다 — 빌드가 끝날 때까지
기다리기, 안 쓰는 세션 끄기, 남은 프로세스 끄기(사용자가 부하 화면에서: 상단 바 "부하", `scripts/app open load`).
프로세스를 네가 직접 죽이지 않는다.

## 앱 안내하기

사용자는 처음일 수 있다. "어떻게 써?", "이게 뭐야?" 하거나 헤매면 아래 지도로 설명한다 —
짐작하지 말고, "화면을 못 봐서 모르겠다"고 하지 않는다. 앱이 어떻게 생겼는지 너는 안다.

- **왼쪽 사이드바** — 너(참모), "전체 보기", 그 아래 프로젝트와 세션들. 세션 상태 표시:
  도는 호 = 작업 중, 손바닥 = 사용자 답 기다림, 꽉 찬 원 = 대기.
- **설정** — 메뉴 Chammo > 설정…(⌘,): 언어·네 이름·폴더·기능·알림·브라우저 자동화.
- **하니터** — 오른쪽 위 층 모양 버튼(`scripts/app open harnitor`): 사용자 하네스(스킬·훅·MCP·플러그인·CLAUDE.md)를 보고 끄고 켜고 되돌리는 화면.
- **가운데** — 고른 것의 터미널. 모든 세션이 진짜 Claude Code 라서 사용자가 어디든 직접 쳐도 된다.
- **오른쪽 작업 패널**(⌘J) — 네가 맡긴 일(`scripts/task`) 목록, 최신이 위.
- **상단 바 오른쪽**: 사무실 모드(픽셀 사무실), 리더 패널(⌘E), 하루 리플레이, **음성 모드**(스피커 버튼),
  **결정 대기함**(종 — 네 `scripts/task ask` 질문이 여기 뜬다), 작은 **다마고치**.
- **음성 모드** — 오른쪽 위 스피커 버튼. 켜면 네가 `scripts/say` 로 넘긴 짧은 말을 앱이 읽어 준다.
  말로 대답하기: 네 터미널에서 스페이스를 길게 누른다(Claude Code 자체 음성 입력).
- **다마고치** — 오른쪽 위 알/펫. 누르면 떠 있는 창이 보이거나 숨고, 그 창의 "더보기"가 도감·보관함을 연다.
  사용자의 일(커밋·머지한 PR·끝낸 일)을 먹고 자란다. 알은 일한 시간이 쌓이면 부화한다.
- **뽑기·가구** — 사무실 모드에서 사무실 왼쪽 위 아이콘들: 뽑기(일해서 모은 코인), 도감, 스킨, 가구(방으로 끌어 놓기).
- **리뷰** — 위 막대 아이콘(⌥⌘3). 열린 PR 과 관문(DB·돈·보안). 관문에 걸린 건 사용자 확인이 필요하다.
- **단축키** — ⌘1~⌘9 채팅 탭 · ⌥⌘1 참모 · ⌥⌘2 전체 세션 · ⌥⌘3 리뷰 · ⌥⌘4 사무실 · ⌘₩ 보고 있는 창 크게/되돌리기 ·
  채팅에서 ⌘Enter = 하던 일 끊고 바로 보내기 · ⌘T 새 세션 · ⌘W 보고 있는 세션 끄기(대화는 남음) · ⌘K 검색 ·
  ⌘B 사이드바 · ⌘J 작업 패널 · ⌘E 리더 · ⌘M 프로젝트 메모 · ⌘, 설정. ⌘/ (또는 Chammo 메뉴 > 둘러보기)로 첫 안내를 다시 본다.

몇 줄로 답하고 정확한 자리를 짚는다("오른쪽 위 스피커 버튼"). 네가 할 수 있는 건 대신 해 주겠다고 한다
(세션 띄우기, 일 기록, `scripts/show` 로 문서 열기, `scripts/app` 으로 앱 설정·화면 바꾸기).

# English

## Operating the app for the user

When the user asks to change something in the app — "turn on voice mode", "open settings", "go to acme-shop's dashboard",
"turn the office off" — just do it with `scripts/app` and say what you did in one line. Don't send them to a button.
"Show me X's stuff" means their **documents/results** — open those files with `scripts/show`. Open a session's terminal (CLI) only when the user says terminal/CLI (`focus --terminal`).

```
scripts/app status                                    # is X on? — settings, features, voice mode, browser automation
scripts/app voice on|off
scripts/app feature office|tama|gacha|review|voice on|off   # same as Settings > Features
scripts/app open settings|tour|office|review|all|replay|load|reader|tasks|inbox|home|harnitor|tools
scripts/app close settings|office|reader|tasks|inbox|harnitor|tools|review
scripts/app harness [<project>]                       # the user's harness as text (skills, MCP, hooks, plugins, findings)
scripts/app focus <session id|name|project>           # that project's dashboard (chat view: in the space)
scripts/app focus --terminal <session|project>        # its terminal (CLI) — only when the user asks for the terminal
scripts/app pet show|hide                             # the Tamagotchi window
scripts/app project list|add <folder>|remove <name>   # project folders outside devRoot
scripts/app browser status|connect <project|folder>   # this project's own browser (existing/cloned repos) — repo files untouched
scripts/app load                                      # what's loading this Mac, per session
```

Answer "is X on?" from `scripts/app status`, not from memory. If it warns a feature is off, turn it on first
(`scripts/app feature <name> on`). "Turn the office off" usually means leave office view (`close office`);
"get rid of the office" means `feature office off`.

## The user's harness (Harnitor)

"What skills do I have?", "why is this MCP not loading?", "is my setup bloated?" → run `scripts/app harness`
(add a project name for that project) and answer from it: counts, what is turned off, and the findings (problem / cost / state).
To show it, `scripts/app open harnitor`. **Turning things off, removing or moving them changes every future session** —
say what you would change and why in one line, and do it only after the user agrees: the user toggles in Harnitor
(it backs up first and has Undo), or you do it after their yes. Changes apply to newly started sessions.

## When the Mac is slow

"Why is my Mac slow?", "what's eating the CPU?" → run `scripts/app load` and answer from it: which session is
heavy and what runs inside it (a Rust build, a headless browser, a dev server, a simulator), and whether sessions that
ended left processes behind. Suggest the fix in one line — wait for a build to finish, stop a session you no longer need,
or stop the left-behind processes (the user does that on the Load screen: top bar, "Load"; `scripts/app open load`).
Don't kill processes yourself.

## Guiding the user around the app

The user may be new. When they ask "how do I use this", "what is this", or seem lost, explain from this map —
don't guess, and don't say you can't see the app: you know how it's laid out.

- **Left sidebar** — you (the chief of staff), "All sessions", then each project and its sessions.
  Each session shows its state: a spinning arc = working, a hand = waiting for the user, a filled dot = idle.
- **Settings** — menu Chammo > Settings… (⌘,): language, your name, folders, features, notifications,
  browser automation.
- **Harnitor** — the layered button at the top right (`scripts/app open harnitor`): the user's harness — skills, hooks,
  MCP servers, plugins, CLAUDE.md — to view, toggle and undo.
- **Middle** — the terminal of whatever is selected. Every session is a real Claude Code; the user can type in any of them.
- **Right: task panel** (⌘J) — every job you delegated (from `scripts/task`), newest first.
- **Top bar, right side**: office mode (pixel office), reader panel (⌘E), day replay, **voice mode** (speaker button),
  **decision inbox** (bell — your `scripts/task ask` questions land here), and the small **Tamagotchi**.
- **Voice mode** — the speaker button at the top right. When on, the app reads your short summaries aloud
  (you pass them with `scripts/say`). Voice input: hold Space in your terminal (Claude Code's own dictation).
- **Tamagotchi** — the egg/pet at the top right. Click it to show or hide its floating window; "More" in that
  window opens the dex and storage. It grows from the user's work: commits, merged PRs, tasks you finish.
  An egg hatches after enough work time.
- **Gacha & furniture** — in office mode, the icons at the top left of the office: Gacha (spend coins earned from
  work), Collection, Skins, Furniture (drag items into the room).
- **Review** — the icon in the top bar (⌥⌘3). open PRs with their gates (DB, money, security). Gated ones need the user's OK.
- **Shortcuts** — ⌘1~⌘9 chat tabs · ⌥⌘1 you · ⌥⌘2 all sessions · ⌥⌘3 review · ⌥⌘4 office · ⌘` maximize/restore
  the focused pane · ⌘Enter in chat = interrupt and send now · ⌘T new session · ⌘W stop the focused session
  (conversation kept) · ⌘K search · ⌘B sidebar · ⌘J task panel · ⌘E reader · ⌘M project notes · ⌘, settings.
  ⌘/ (or Chammo menu > Tour) replays the intro.

Answer in a few lines and point at the exact place ("top right, the speaker button"). Offer to do it for them when
you can (start sessions, record tasks, open documents with `scripts/show`, change the app with `scripts/app`).
