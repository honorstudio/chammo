---
name: hq-folders
description: devRoot 밖 프로젝트 폴더를 더할 때, 세션 띄우기가 "Workspace not trusted"·"An unknown error occurred" 로 실패할 때, devRoot 에서 "Operation not permitted" 가 날 때 연다. Project folders outside devRoot, "Workspace not trusted", "Operation not permitted", --bg unknown error.
---

<!-- Chammo 가 HQ 를 켤 때마다 새로 쓴다 — 고치지 않는다. / Rewritten by Chammo on every start — do not edit. -->

# 한국어

- **`devRoot` 밖에 있는 프로젝트 폴더**(사용자가 다른 데 두거나, 옮기면 안 되는 폴더 — 예: 데스크탑 보호 때문에 무인 작업이
  멈추는 곳): 옮기지 않는다. 그 자리에 둔 채 추가한다: `scripts/app project add <폴더>` (`list` · `remove <이름>` 도 있다).
  그러면 사이드바에 보이고, 그 세션도 네 팀이 되고, 평소처럼 거기서 세션을 띄운다. 사용자는 사이드바 "폴더 추가"나 설정에서도 할 수 있다.

- 세션을 띄울 때 **"Workspace not trusted"**(`gh repo clone` 으로 받았거나 손으로 만든 폴더) → `scripts/app trust <폴더>` 하고
  다시 띄운다. 종료 코드 3 = 사용자가 믿은 프로젝트 폴더 밖 — 그때만 사용자에게 한 번 부탁한다: 입력칸에 `! cd <폴더> && claude` →
  "Yes, I trust this folder" 고르고 → `/exit`. (`scripts/new-project` 로 만든 폴더는 이미 믿음)

- **`devRoot` 에서 "Operation not permitted"**(프로젝트 목록·파일 읽기) — 또는 **`claude --bg` 가 "An unknown error occurred
  (Unexpected)" 로 실패**하면 먼저 `ls <devRoot>` 로 시험한다: 맥이 Chammo 의 그 폴더 접근을 막은 것이다(Chammo 를 새로 깔거나
  이름을 바꾸면 생긴다). 프로젝트가 없는 게 아니다 — 새로 만들자고 하지 않는다. 사용자에게 한 줄로: 시스템 설정 → 개인정보 보호 및
  보안 → **전체 디스크 접근 권한** → Chammo 켜기 → Chammo 를 껐다 다시 켜기(`open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"`
  로 그 화면이 열린다). 켜기 전엔 세션을 띄우지 않는다. `ls` 가 되면 `--bg` 오류를 그대로 알린다.

# English

- **A project folder outside `devRoot`** (the user keeps it elsewhere, or it can't move — e.g. unattended jobs that
  macOS's Desktop protection would block): don't move it. Add it where it is: `scripts/app project add <folder>`
  (`list` / `remove <name>` too). It then shows in the sidebar, its sessions count as your team, and you start
  sessions there as usual. The user can do the same from the sidebar ("Add folder") or Settings.

- **"Workspace not trusted"** when starting a session (a folder just cloned with `gh repo clone`, or made by hand) →
  run `scripts/app trust <folder>` and start the session again. Exit 3 means the folder is outside the projects folder
  the user trusted — then ask them once: run `! cd <folder> && claude` in your prompt, pick "Yes, I trust this folder",
  then `/exit`. (Folders made by `scripts/new-project` are trusted already.)

- **"Operation not permitted" on `devRoot`** (listing projects, reading a project) — or **`claude --bg` fails with
  "An unknown error occurred (Unexpected)"**, then test `ls <devRoot>` first: macOS is blocking Chammo from that folder
  (it happens after Chammo is reinstalled or renamed). It is not a missing project — don't offer to create one. Tell the
  user in one line: System Settings → Privacy & Security → **Full Disk Access** → turn on Chammo, then quit and reopen
  Chammo (`open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"` opens that page). Don't start
  sessions until they have. If `ls` works, report the `--bg` error as it is.
