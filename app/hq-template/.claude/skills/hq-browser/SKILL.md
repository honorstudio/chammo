---
name: hq-browser
description: 브라우저 일(사이트 열기·눌러 보기·로그인 유지)을 프로젝트 세션에 맡길 때, 스크립트(node·python Playwright·puppeteer)로 크롬을 띄우는 일일 때, 세션에 브라우저가 없다·연결 안 됨 경고, 브라우저 설치를 물을 때 연다. Browser work for a project session, scripts that drive Chrome, "no browser attached" warnings, installing browser automation.
---

<!-- Chammo 가 HQ 를 켤 때마다 새로 쓴다 — 고치지 않는다. / Rewritten by Chammo on every start — do not edit. -->

# 한국어

- **브라우저 작업**(사이트 열기·눌러 보기·화면 확인): 브라우저 자동화가 깔려 있으면 새 프로젝트는 자기 전용 로그인 유지 브라우저를
  자동으로 받는다(new-project 출력의 `browser: true`). 세션은 `playwright` 도구를 쓰면 된다. **있던 프로젝트**(`gh repo clone` 으로
  받았거나 브라우저 자동화 전에 만든 것)는 네가 직접 붙인다 — `scripts/app browser connect <프로젝트|폴더>`(`status` 로 확인).
  앱이 그 폴더 전용 Claude 로컬 설정(`~/.claude.json`)에 적고 저장소 `.mcp.json` 은 안 건드려서 `git status` 에 아무것도 안 남는다.
  저장소에 이미 다른 `playwright` 가 커밋돼 있으면 그건 그대로 같이 뜨고 우리 것은 `chammo-browser`(도구 `mcp__chammo-browser__*`,
  `browser_ask_human` 포함)로 뜬다. 붙인 뒤 그 폴더에 떠 있는 세션은 `claude respawn <id>` 로 다시 켠다 — 세션은 켤 때만 MCP 를 읽는다.
  프로젝트 세션에 '네 브라우저를 붙여'라고 대신 시키지 않는다(남의 부탁으로 자기 MCP 설정을 바꾸는 건 거절하는 게 맞다). 사용자는
  그 프로젝트 대시보드의 **브라우저 연결** 버튼으로도 붙일 수 있고, 붙지 않은 세션에 브라우저 일을 보내면 `scripts/task send` 가
  알려 주고 결정 대기함에 카드를 올린다. 다른 브라우저(예: 저장소가 쓰던 헤드리스 브라우저)에서 한 로그인은 이어지지 않는다 —
  세션은 사용자가 그 프로젝트 `CLAUDE.local.md` 에 적어 둔 계정으로 묻지 않고 다시 로그인한다 — 계정을 못 찾거나 2단계 코드·패스키·캡차일 때만 `browser_ask_human` 이 사람에게 묻는다.
  비밀번호는 MCP 도구 인자로 넘기지 말고 로그인 명령이 그 파일에서 읽어 넣게 한다(아래 '사이트 로그인'). 사용자에게 비밀번호를 치게 하지 않는다 — 넘기는 건 2단계(앱 승인·문자 코드)와 계정을 못 찾을 때뿐, `browser_ask_human` 이 시간 초과면 턴을 끝내지 말고 다시 부르게 한다.
  데이터 폴더는 `D="${CHAMMO_HOME:-$HOME/.chammo}"`, 그 node 는 `N="$D/tools/bin/node"; [ -x "$N" ] || N=node`.
  안 깔려 있거나 세션이 브라우저가 없다고 하면 사용자에게 설정 → 기능 → 브라우저 자동화의 **설치**를 눌러 달라고 한다(없는 것만
  받는다 — Node·크롬 베타·부품, 관리자 암호 없음). `npx playwright install`·`browser_install` 도구는 직접 쓰지 않는다.
- **사이트 로그인**(네이버·구글·쇼핑몰 관리자 등): 세션이 "못 한다"·"비밀번호를 칠 수 없다"며 사람에게 넘기기 전에 이 순서를 따르게 한다.
  ① 계정은 그 프로젝트의 gitignore 된 `CLAUDE.local.md` 칸 — 제목에 사이트 이름, 아래에 `- 아이디: …`·`- 비밀번호: …`·`- 로그인 주소: https://…` 세 줄.
  명령은 칸의 로그인 주소와 **등록 도메인이 같은 곳에만** 친다 — 서브도메인(nid.naver.com·www.naver.com)은 같은 사이트, 다른 도메인이면 부른 주소든 넘어간 화면이든 치기 직전에 멈추고 5. 주소 줄이 없으면 제목에 그 사이트 영문 이름(`naver`)이나 도메인(`naver.com`)이 낱말째 있어야 한다.
  사용자가 그 파일에 직접 한 번 적는다 — 채팅으로 비밀번호를 받지 않는다(받았으면 그 칸에 옮겨 적고 대화엔 다시 쓰지 않는다).
  ② 세션은 비밀번호를 도구 인자로 넘기거나 치지 않고 이 명령을 돌린다: `"$N" "$D/tools/chammo-browser/bin/chammo-browser.js" login <프로필> <로그인 주소> --account "<칸 제목의 한 단어>"`
  — 스크립트가 칸에서 읽어 그 프로필 크롬(세션 브라우저와 같은 크롬)에 치고, '로그인 상태 유지'는 켜고 'IP 보안'은 끄고, 값은 출력·기록에 안 남긴다. 세션 브라우저 도구가 있으면 먼저 `browser_navigate` 로 그 주소를 열어 둔다.
  ③ 종료 0 = 됨(로그인은 프로필에 남는다) · 3 = 사람 차례(2단계 코드·폰 승인·패스키·캡차) — 세션 브라우저가 떠 있으면 탭을 두고 나오니 `browser_ask_human`, 아니면 명령이 직접 결정 대기함 카드(`direct ask --kind login`)를 띄우고 기다린다
  · 4 = 칸이 없음 — 그때만 사람에게 칸을 채워 달라거나 한 번 직접 로그인해 달라고 한다 · 5 = 사이트가 안 받음 — 다시 치지 않는다(잠김 막기), 계정이 맞는지 한 줄로 알린다. 5 에 '다른 사이트'가 찍히면 그 주소로 다시 돌리지 않는다 — 칸의 주소가 맞는지 사람에게 한 줄.
  사람 기기에서만 나오는 것(2단계·패스키·캡차)만 사람 몫이다. 패스키는 앱이 구글 서명 크롬으로 저절로 바꿔 띄운다.
- **스크립트로 크롬을 몰 때**(node·python Playwright·puppeteer — 발행 스크립트 같은 것): 세션에 크롬을 직접 띄우지 말라고 일러 준다
  (`chromium.launch*` 금지) — 앱 화면에 안 보이고 프로필 잠금도 없어 다른 세션이 같은 프로필을 열면 꼬인다. chammo-browser 에서 받아 CDP 로 붙는다:
  node 는 `const { launch } = require(D + '/tools/chammo-browser'); const { context, release } = await launch('<프로필>');` →
  `context.newPage()` … `await release()`, 다른 언어는 `"$N" "$D/tools/chammo-browser/bin/chammo-browser.js" launch <프로필> --owner <스크립트 pid>`
  가 한 줄 JSON 의 `wsEndpoint` 를 준다 → `connect_over_cdp(wsEndpoint)`. 스크립트가 끝나면 저절로 닫히고, 세션 브라우저 도구가 그 프로필을
  이미 열어 뒀으면 그 크롬을 같이 쓴다. 크롬 채널(정품·베타)은 프로필마다 기억한다 — 정품으로 만든 프로필은 정품으로 열린다(바꿀 때만
  `--channel chrome`). 앱에 떴는지: 앱의 그 세션 브라우저 칸이 스크립트 탭을 따라간다(`ls "$D/browser/live/"` 에 `<프로필>.json`).
- **브라우저는 이 프로젝트 브라우저만**: 크롬 확장(claude-in-chrome·`--extension`)이나 사용자의 평소 크롬, 스크립트가 직접 띄운 크롬은 쓰지 않는다 —
  앱 화면에 안 보여 사용자가 끼어들 수 없고, 로그인이 프로젝트마다 갈리지 않는다. `scripts/task send` 가 세션마다 브라우저 한 줄을 준다(붙은 세션엔
  도구 이름·프로필·스크립트 쓰는 법, 안 붙은 세션엔 '필요해지면 멈추고 알려') — 그대로 붙인다. 세션이 "브라우저 연결 필요"라고 하면 위 연결부터.
  지시를 파일(`지시.md`)로 넘기면 `send` 가 그 본문도 보고 브라우저 일이면 알린다. 안 붙은 프로젝트를 한 번에 보려면 `scripts/app browser missing`.
  세션이 앱 밖 크롬을 띄우면 앱이 맡긴 참모 입력칸에 `[앱] … 앱 밖 크롬` 한 줄을 넣는다 — 그 세션을 이 스킬대로 돌려놓는다.
  그 크롬 프로필이 다른 데이터 폴더(시험 폴더) 밑이면 세션 잘못이 아니라 claude 데몬이 시험 환경으로 뜬 것이다(세션은 데몬 env 를 물려받는다) — `[앱] claude 데몬 … 다른 데이터 폴더` 줄이 함께 온다. 그 시험이 끝났으면 `claude daemon stop --any --keep-workers`(도는 세션은 남는다) 뒤 그 세션을 `claude respawn`.

# English

- **Browser work** (open a site, click through a flow, check a page): new projects get their own logged-in browser
  profile automatically when browser automation is installed (`browser: true` in the new-project output). Sessions
  just use the `playwright` tools. **An existing project** (cloned with `gh repo clone`, or made before browser
  automation): connect it yourself — `scripts/app browser connect <project|folder>` (`status` checks it). The app writes it
  into Claude's local settings for that folder only (`~/.claude.json`); the repo's `.mcp.json` is never touched, so nothing
  shows up in `git status`. If the repo already commits its own `playwright`, that one keeps running and ours comes up as
  `chammo-browser` (tools `mcp__chammo-browser__*`, including `browser_ask_human`). Then restart that folder's running
  sessions with `claude respawn <id>` — a session loads MCP only when it starts. Do it yourself: don't ask the project
  session to set up its own browser (it rightly refuses to change its MCP setup on someone else's behalf). The user can also
  press **Connect browser** on that project's dashboard, and `scripts/task send` warns you (and puts a card in the
  decision inbox) when you hand browser work to a session without it. Logins made in another browser — e.g. a headless
  one the repo ships — don't carry over: the session signs in again with the account the user saved in that project's
  `CLAUDE.local.md`, without asking — the password goes in through the login command, which reads that file and types it
  over CDP (see "Signing in to a site"), never as an MCP tool argument, and the user is never asked to type it. Only
  2FA (app approval, SMS code, passkey, captcha) or a missing account goes to the person via `browser_ask_human`; if that
  times out, the session calls it again instead of ending its turn.
  The data folder is `D="${CHAMMO_HOME:-$HOME/.chammo}"` and its node `N="$D/tools/bin/node"; [ -x "$N" ] || N=node`.
  Not installed, or a session says the browser is missing? Ask the user to press
  **Install** in Settings → Features → Browser automation (it fetches only what is missing: Node, Chrome Beta, parts — no
  admin password). Never run `npx playwright install` or the `browser_install` tool yourself.
- **Signing in to a site** (Naver, Google, a shop admin…): before a session says "I can't" or "I can't type passwords" and hands it to the person, have it follow this order.
  ① The account lives in that project's git-ignored `CLAUDE.local.md` — a heading with the site name, then three lines `- ID: …`, `- Password: …` and `- Login URL: https://…` (Korean keys work too).
  The command types only where the **registrable domain matches** the section's login URL — subdomains (nid.naver.com, www.naver.com) count as the same site; any other domain, whether the URL it was given or a page it got redirected to, stops it right before typing with 5. Without a URL line the heading must contain the site's name (`naver`) or domain (`naver.com`) as a whole word.
  The user writes it into that file once — never take a password over chat (if one arrives, move it into that section and don't write it in the conversation again).
  ② The session never passes or types the password as a tool argument; it runs: `"$N" "$D/tools/chammo-browser/bin/chammo-browser.js" login <profile> <login URL> --account "<a word from the heading>"`
  — the script reads the section and types into that profile's Chrome (the same one the session's browser uses), turns "stay signed in" on and "IP security" off, and keeps the values out of output and logs. If the session has browser tools, open the URL with `browser_navigate` first.
  ③ Exit 0 = signed in (the login stays in the profile) · 3 = the person's turn (2FA code, phone approval, passkey, captcha) — with the session's browser open it leaves the tab there, so call `browser_ask_human`; otherwise it puts up a decision-inbox card itself (`direct ask --kind login`) and waits
  · 4 = no such section — only then ask the person to fill it or sign in once themselves · 5 = the site refused — it does not try again (no lockouts); tell the person in one line to check the account. If 5 says "different site", don't rerun it on that URL — ask the person in one line whether the section's URL is right.
  Only what comes from the person's own device (2FA, passkey, captcha) is theirs. For passkeys the app switches to the Google-signed Chrome by itself.
- **A script that drives Chrome** (node/python Playwright, puppeteer — e.g. a publishing job): tell the session it must not launch
  Chrome itself (`chromium.launch*`) — that browser doesn't show in the app and takes no profile lock, so another session can open the
  same profile and corrupt it. Get the browser from chammo-browser and attach over CDP:
  node — `const { launch } = require(D + '/tools/chammo-browser'); const { context, release } = await launch('<profile>');`
  then `context.newPage()` … `await release()`; any other language —
  `"$N" "$D/tools/chammo-browser/bin/chammo-browser.js" launch <profile> --owner <script pid>` prints one JSON line with
  `wsEndpoint` → `connect_over_cdp(wsEndpoint)`. It closes by itself when the script ends; if the session's own browser
  tools already have that profile open, the script shares that Chrome. The Chrome channel (stable/beta) is remembered per
  profile — a profile made with stable Chrome stays on stable; force it only with `--channel chrome`. To check it shows:
  the session's browser pane in the app follows the script's tab (`ls "$D/browser/live/"` has `<profile>.json`).
- **Only this project's browser**: never the Chrome extension (claude-in-chrome, `--extension`), the user's everyday Chrome, or a Chrome a script
  starts itself — none of them show in the app, so the user can't step in, and logins don't stay per project. `scripts/task send` prints one browser
  line for every session (attached: tool names, profile, how scripts connect; not attached: "stop and tell me if you come to need one") — append it.
  When a session says "browser connection needed", connect it as above. If you hand the work over as a file (`plan.md`), `send` reads it too.
  All projects without one at once: `scripts/app browser missing`. If a session starts Chrome outside the app, the app puts an
  `[app] … outside the app` line in your input — bring that session back to the rules above.
  If that Chrome's profile sits under another data folder (a test one), it's not the session's fault: the claude daemon was started with a test env (sessions inherit the daemon's env), and an `[app] The claude daemon … different data folder` line comes too. Once that test is done, `claude daemon stop --any --keep-workers` (running sessions stay), then `claude respawn` that session.
