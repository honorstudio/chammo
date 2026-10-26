---
name: hq-folders
description: devRoot 밖 프로젝트 폴더를 더할 때, 세션 띄우기가 "Workspace not trusted"·"An unknown error occurred" 로 실패할 때, devRoot 에서 "Operation not permitted" 가 날 때 연다. Project folders outside devRoot, "Workspace not trusted", "Operation not permitted", --bg unknown error.
---

<!-- Chammo 가 HQ 를 켤 때마다 새로 쓴다 — 고치지 않는다. / Rewritten by Chammo on every start — do not edit. -->

# 한국어

- **`devRoot` 밖에 있는 프로젝트 폴더**(사용자가 다른 데 두거나, 옮기면 안 되는 폴더 — 예: 데스크탑 보호 때문에 무인 작업이
  멈추는 곳): 옮기지 않는다. 그 자리에 둔 채 추가한다: `scripts/app project add <폴더>` (`list` · `remove <이름>` 도 있다).
  그러면 사이드바에 보이고, 그 세션도 네 팀이 되고, 평소처럼 거기서 세션을 띄운다. 사용자는 사이드바 "폴더 추가"나 설정에서도 할 수 있다.

- 사용자가 믿은 프로젝트 폴더(`devRoot`) 안의 새 폴더(클론·손으로 만든 것)는 먼저 띄워 본다 — git 아닌 폴더는 믿음을 물려받고,
  git 저장소는 앱이 1분 안에 그 칸을 적는다(Claude 가 git 저장소엔 위 폴더 믿음을 안 물려준다). 미리 사용자에게 믿기를 부탁하지 않는다.
- 세션을 띄울 때 **"Workspace not trusted"**(믿은 폴더 밖, `devRoot` 를 아직 안 믿은 맥, 방금 만든 git 저장소) → `scripts/app trust <폴더>` 하고
  다시 띄운다. 종료 코드 3 = 사용자가 믿은 프로젝트 폴더 밖 — 그때만 사용자에게 한 번 부탁한다: 입력칸에 `! cd <폴더> && claude` →
  "Yes, I trust this folder" 고르고 → `/exit`. (`scripts/new-project` 로 만든 폴더는 이미 믿음)

- **`devRoot` 에서 "Operation not permitted"**(프로젝트 목록·파일 읽기) — 또는 **`claude --bg` 가 "An unknown error occurred
  (Unexpected)" 로 실패**하면 먼저 `ls <devRoot>` 로 시험한다. 프로젝트가 없는 게 아니다 — 새로 만들자고 하지 않는다. 막혔으면
  사용자에게 가기 전에 **이 세션이 지금 claude 데몬 밑인지** 본다:
  `p=$$; while [ "$p" -gt 1 ]; do ps -o command= -p $p | grep -q 'claude daemon run' && { echo ok; break; }; p=$(ps -o ppid= -p $p | tr -d ' '); done`
  - `ok` 가 안 나오면 옛 데몬이 띄운 세션이다(Claude Code 업데이트로 데몬이 바뀌어도 돌던 세션은 남는다). 맥 권한 설정이 아무 데서나 바뀌면
    (다른 앱 허용 등) 이런 세션만 폴더가 막힌다 — 전체 디스크 접근은 켜진 그대로라 사용자에게 다시 켜라고 하지 않는다. 그 세션을
    `claude respawn <세션 번호>` 로 다시 띄운다(같은 대화 그대로, 새 세션은 지금 데몬 밑). 막힌 세션 안에선 claude 명령도 실패하니
    안 막힌 세션(다른 참모 등)이 돌린다.
  - `ok` 인데도 막혔거나 새로 띄운 세션도 막히면 맥이 Chammo 를 막은 것이다(Chammo 를 새로 깔거나 이름을 바꾸면 생긴다). 사용자에게 한 줄로:
    시스템 설정 → 개인정보 보호 및 보안 → **전체 디스크 접근 권한** → Chammo 켜기 → Chammo 를 껐다 다시 켜기
    (`open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"` 로 그 화면이 열린다). 켜기 전엔 세션을 띄우지 않는다.
  - `ls` 가 되면 `--bg` 오류를 그대로 알린다.

# English

- **A project folder outside `devRoot`** (the user keeps it elsewhere, or it can't move — e.g. unattended jobs that
  macOS's Desktop protection would block): don't move it. Add it where it is: `scripts/app project add <folder>`
  (`list` / `remove <name>` too). It then shows in the sidebar, its sessions count as your team, and you start
  sessions there as usual. The user can do the same from the sidebar ("Add folder") or Settings.

- A new folder (cloned or made by hand) inside the projects folder the user trusted (`devRoot`): start the session first —
  a plain folder inherits the trust, and for a git repo the app writes its own entry within a minute (Claude does not pass
  the parent's trust down to a git repo) — don't ask the user to trust it in advance.
- **"Workspace not trusted"** when starting a session (outside the trusted folder, `devRoot` not trusted yet on this
  Mac, or a git repo made a moment ago) → run `scripts/app trust <folder>` and start the session again. Exit 3 means the folder is outside the projects folder
  the user trusted — then ask them once: run `! cd <folder> && claude` in your prompt, pick "Yes, I trust this folder",
  then `/exit`. (Folders made by `scripts/new-project` are trusted already.)

- **"Operation not permitted" on `devRoot`** (listing projects, reading a project) — or **`claude --bg` fails with
  "An unknown error occurred (Unexpected)"**, then test `ls <devRoot>` first. It is not a missing project — don't offer
  to create one. If it's blocked, before going to the user check **whether this session runs under the current claude daemon**:
  `p=$$; while [ "$p" -gt 1 ]; do ps -o command= -p $p | grep -q 'claude daemon run' && { echo ok; break; }; p=$(ps -o ppid= -p $p | tr -d ' '); done`
  - No `ok` means an older daemon started this session (when a Claude Code update replaces the daemon, running sessions
    stay). When any macOS privacy setting changes (another app gets allowed, etc.), only such sessions lose the folder —
    Full Disk Access is still on, so don't ask the user to turn it on again. Restart that session with
    `claude respawn <session id>` (same conversation; the new one runs under the current daemon). claude commands fail
    inside the blocked session too, so run it from one that isn't blocked (another chief of staff, etc.).
  - If you get `ok` and it's still blocked, or a freshly started session is blocked too, macOS is blocking Chammo (it
    happens after Chammo is reinstalled or renamed). Tell the user in one line: System Settings → Privacy & Security →
    **Full Disk Access** → turn on Chammo, then quit and reopen Chammo
    (`open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"` opens that page). Don't start
    sessions until they have.
  - If `ls` works, report the `--bg` error as it is.
