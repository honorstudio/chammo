---
name: hq-craft
description: 사진·벡터·PDF·문서·표·영상·소리 같은 편집 일을 Craft 앱(scripts/craft)으로 할 때 연다 — 맥 앱을 조작 채널로 띄워 참모가 명령으로 다루기, 창 없는 엔진으로 일괄 처리, 앱별로 할 수 있는 것. Editing work with the Craft apps — driving the macOS app over its control channel, the windowless engine for batches, what each app can do.
---

<!-- Chammo 가 HQ 를 켤 때마다 새로 쓴다 — 고치지 않는다. / Rewritten by Chammo on every start — do not edit. -->

# 한국어

## Craft 앱 — 사용자는 말만, 참모가 다룬다

Craft 앱 13개(ArtCraft 오픈소스 — 맥 앱은 Chammo 용으로 빌드한 '참모 ○○', 웹판은 원본 그대로, **지금은 맥만**)는 맥 앱이 **조작 채널**(127.0.0.1)을 연다. 참모는 좌표를 누르지 않고
**명령 id** 를 보내고 답을 JSON 으로 받는다 — 메뉴로 할 수 있는 건 거의 다 명령으로 된다.
**만들고 고치는 일은 언제나 맥 앱으로**(`open <앱> --native` + `run`/`do`) — 사용자가 스페이스 칸에서 만드는 걸 따라 보고 언제든 넘겨받는다. 프로젝트 세션이 띄워도 그 세션을 맡긴 참모 탭에 칸이 뜬다.

1. **띄우기**: `scripts/craft open <앱> --native [--work <폴더>]` — 맥 앱을 따로 설정 폴더·무작위 포트로 띄운다. 가짜 화면이 있으면 그 화면에(사용자 화면을 안 가림 — PhotoCraft 말고는 뜬 뒤 옮겨서 몇 초 보일 수 있다). `--here` 면 사용자 화면에(사용자가 직접 만지고 싶을 때). 출력의 **작업 폴더**에 파일을 넣고 꺼낸다(PhotoCraft·VectorCraft 는 그 폴더 밖 파일을 거절. `do`/`run` 의 경로는 작업 폴더 기준 상대 경로로 써도 된다 — scripts/craft 가 작업 폴더 절대 경로로 바꿔 넘긴다). 안 깔려 있으면 처음 한 번 참모 앱 공개 릴리스(Chammo 저장소의 crafts-<날짜>)에서 DMG 를 받아 체크섬·번들 id·애플 공증을 맞춰 보고 /Applications 에 깐다(22~132MB, 하나라도 안 맞으면 안 깔고 멈춤 · 릴리스를 못 받으면 서랍에 '받을 수 없음') — 13개를 미리 다 깔지 않는다
2. **명령 찾기**: `scripts/craft do <앱> engine.commands`(대부분 — id·params). 앱마다 다르다: PdfCraft 는 `do pdfcraft ui.commands`(메뉴 명령), SoundCraft 의 params 는 `scripts/craft cli soundcraft describe <id>`, GridCraft 는 `cli gridcraft commands --json`
3. **하기**: `scripts/craft run <앱> <명령 id> '<json params>'` · 채널 명령은 `scripts/craft do <앱> <method> '<json>'`(`app.open`·`app.save`·`ui.inspect`·`ui.menu.invoke`)
4. **확인**: `scripts/craft shot <앱> --out <png>` 로 창을 찍어 직접 보고, 결과 파일은 `scripts/show` 로 사용자에게
5. **끄기**: `scripts/craft close <앱>` — 끝나면 꼭. 13개 중 10개는 조작 포트에 인증이 없어(이 맥의 아무 프로그램이나 붙음) 켜 둔 채 두지 않는다. `scripts/craft status` 로 떠 있는 것

예 — "이 사진 밝고 화사하게":
```
scripts/craft open photocraft --native ~/Downloads/a.jpg   # 작업 폴더로 복사해 연다 — 닫을 때 a.jpg 자리에 저장 + 옆에 a.psd
scripts/craft run photocraft layer.newAdjustmentLayer.brightnessContrast '{"brightness":30,"contrast":35}'
scripts/craft run photocraft layer.newAdjustmentLayer.hueSaturation '{"saturation":40}'
scripts/craft do photocraft app.save '{"path":"a-edit.png"}'      # .psd 면 레이어째
scripts/craft shot photocraft --out /tmp/check.png && scripts/craft close photocraft
scripts/show <작업 폴더>/a-edit.png
```
창 없는 엔진(`scripts/craft cli …`)은 **사람이 볼 필요 없는 일만** — 사진 100장 같은 일괄 보정(`cli photocraft batch …`)·형식 바꾸기(`convert`)·정보 읽기(`info`). 결과물을 만드는 일(PSD 짜기·문서 꾸미기)을 cli `serve`/`run` 으로 하지 않는다 — 끝날 때까지 아무것도 안 보인다(그러면 scripts/craft 가 stderr 로 알린다).

| 앱 | 하는 일 | 인증 | 자주 쓰는 명령 |
|---|---|---|---|
| PhotoCraft | 사진(레이어·PSD) | 토큰 | `image.adjustments.*`·`layer.newAdjustmentLayer.*`·`app.open/save` |
| WordCraft | 문서 | 키 | `text.insert`·`file.exportPng` |
| PdfCraft | PDF | 토큰 | `run` 이 `ui.command`(메뉴 명령), `ui.state` |
| GridCraft | 표 | 없음 | `cell.get`·`sheet.read`·`ui.edit.text` (엑셀 칸만이면 `scripts/sheet` 가 먼저) |
| VectorCraft | 벡터 | 없음 | 도구·보기·`app.export` |
| DesignCraft | 지면 | 없음 | `file.exportPdf`(PNG 내보내기 없음)·`view.*` |
| DeckCraft | 발표 | 없음 | `slide.new` |
| FilmCraft | 영상 | 없음 | 타임라인·`ui.playback` |
| EffectCraft | 모션 | 없음 | `comp.new`·`ui.playback` |
| LightCraft | 사진 보관·RAW | 없음 | 가져오기·현상 |
| CADCraft | 캐드 | 없음 | AutoCAD 명령 이름 그대로 `run`(`line`·`circle`·`text`·`saveas`) |
| SoundCraft | 오디오 | 없음 | 트랙·믹스 |
| FigCraft | 화면 설계 | 없음 | `file.export`·`page.select` |

- **시작 화면의 '열기' 단추는 누르지 않는다** — 맥 파일 창이 앱을 막아 조작 채널이 멎는다(원본 동작). 파일은 `open <앱> --native <파일>` 이나 `do <앱> app.open '{"path":…}'` 로. 참모 화면(FigCraft)은 `ui.click` 이 없고 `ui.mouse`
- **한글이 □ 로 나오면**: DesignCraft·FigCraft 는 기본 글꼴에 한글이 없다 — 글꼴을 `Apple SD Gothic Neo` 로(Design: `edit.selectAll` 뒤 `type.char {"fontFamily":…}`, Fig: `node.set {"fontFamily":…}`). GridCraft 는 PDF 내보내기만 □(xlsx·화면은 정상)
- 명령이 실패하면 앱 문구 그대로 오류가 나온다(`unknown command …`) — 고쳐서 다시. 같은 명령이 세 번 실패하면 `ui.inspect` 로 상태(열린 대화상자 등)부터 본다
- 대화창이 떠서 막히면 `scripts/craft dialog <앱>`(종류·글을 보여 준다) → `scripts/craft dialog <앱> close`(앱마다 다른 닫기 메서드를 알아서). 같은 앱은 **세션마다 따로** 뜬다(한 앱에 3개까지, 2·3번째는 `<앱>-2`·`<앱>-3` — `status` 에 주인 세션까지). `open` 이 내 것을 고르고 명령은 저절로 내 것으로 간다. 3개가 다 차 있으면 `open` 이 "대기 중 (N번째)"를 찍고 기다렸다 자리가 나면 이어서 띄운다(최대 30분, `--wait <초>`) — 끊지 말고 기다린다. 남의 인스턴스엔 안 쓴다("다른 세션이 쓰는 중" — 꼭 필요할 때만 `<앱>-2 --force`)
- **사람이 개입하면**(칸의 개입 단추) 쓰기 명령(`run`·`do`)은 바로 실패한다(종료 코드 4, "사람이 개입함 — 스크립트 멈춤") — 스크립트는 거기서 멈춘다. 보기(`shot`·`ui.inspect`)는 된다. 돌려받으면 `[앱] … 돌려받음 — 사람이 바꾼 것 · 지금 문서 …(레이어 수·화면 png)` 한 줄이 온다 — **남은 스크립트를 스스로 다시 돌리지 말고** 그 상태를 보고 사람에게 다음을 묻는다. 이어서 하라면 남은 단계를 사람이 바꾼 걸 반영해 다시 짠다
- 창을 숨기지 않는다(숨기면 그림이 멈추고 찍기가 옛 그림). 앱 창을 사용자 화면으로 옮기지 않는다 — 사용자가 직접 만지길 원하면 `close` 후 `--here` 로 다시
- **닫기 = 묻지 않고 저장 후 닫기**: `close`(창의 닫기 단추도) 는 바뀐 게 있으면 저장한다 — 사람 파일로 열었으면 그 자리에 같은 형식 + 옆에 레이어 살린 PSD, 새 문서면 네 보관함 `Craft` 폴더에 PSD. 사용자가 "아까 그 사진 다시"면 `scripts/craft recent` 에서 찾아 `open photocraft --native <파일>`
- **공간**: 필요한 것만 깔아 쓴다. `scripts/craft list` 에 앱마다 크기·마지막으로 쓴 날이 나온다 — 30일 넘게 안 쓴 게 있으면 다른 일 보고 끝에 "○○ 30일 안 썼는데 지울까?(n MB)" 한 줄만. **사용자가 좋다고 한 것만** `scripts/craft remove <앱>`(받은 것·우리가 깐 맥 앱·설정·작업 폴더 → 휴지통, 사용자가 직접 깐 앱은 안 지움). 혼자 지우지 않는다
- 맥 앱이 없거나 사용자가 웹에서 보길 원하면 `scripts/craft open <앱>`(웹판, 스페이스) — 웹판은 자동 저장이 없고 한글 글꼴이 없다

# English

## Craft apps — the user talks, you drive

The 13 Craft apps (ArtCraft open source — the macOS apps are the Chammo builds '참모 ○○', the web builds unchanged; **macOS only for now**) open a **control channel** (127.0.0.1) in the macOS app.
You don't click coordinates: send a **command id** and get JSON back — nearly every menu item is a command.
**Making or editing something always goes through the macOS app** (`open <app> --native` + `run`/`do`) — the user follows along in the space
and can take over any time. A project session opening it gets its pane in the tab of the assistant that delegated the session.

1. **Open**: `scripts/craft open <app> --native [--work <dir>]` — its own settings folder and a random port. With the agents screen
   it opens there, out of the user's way (apps other than PhotoCraft are moved there after they appear, so they may flash for a few seconds); `--here` puts it on the user's
   screen (when they want to touch it). `open <app> --native <file>` copies a person's file in and, on close, saves it back there
   (same format + a layered .psd beside it). Otherwise put files into and take them from the printed **work folder** (PhotoCraft and VectorCraft refuse
   files outside it; paths in `do`/`run` may be relative to the work folder — scripts/craft turns them into absolute paths). Not installed → the first time it downloads the DMG from the Chammo apps release (the Chammo repo, crafts-<date>), checks the checksum, bundle id
   and Apple notarization and installs it to /Applications (22–132 MB; any mismatch: nothing installed; release unreachable: 'unavailable' in the drawer). Don't install all 13 up front
2. **Find commands**: `scripts/craft do <app> engine.commands` (most apps — ids and params). It differs per app: PdfCraft uses
   `do pdfcraft ui.commands` (menu commands), SoundCraft params come from `scripts/craft cli soundcraft describe <id>`, GridCraft from
   `cli gridcraft commands --json`. Never click the start screen's Open button — the macOS file dialog blocks the app and the control channel stalls (original behaviour); open files with `open <app> --native <file>` or `do <app> app.open '{"path":…}'`. FigCraft has no `ui.click` — use `ui.mouse`. Korean shows as boxes in DesignCraft/FigCraft (default fonts) — set the font to `Apple SD Gothic Neo`
3. **Do**: `scripts/craft run <app> <command id> '<json params>'`; raw channel calls `scripts/craft do <app> <method> '<json>'`
   (`app.open`, `app.save`, `ui.inspect`, `ui.menu.invoke`)
4. **Check**: `scripts/craft shot <app> --out <png>` and look at it; show results to the user with `scripts/show`
5. **Close**: `scripts/craft close <app>` — always when done. 10 of the 13 have no auth on the control port (any program on this Mac can
   connect), so never leave one running. `scripts/craft status` lists what's open

The windowless engine (`scripts/craft cli …`) is **only for work nobody needs to watch** — batches (retouch 100 photos: `cli photocraft batch …`),
format conversion (`convert`), reading info (`info`). Don't build a result (a PSD, a laid-out document) with cli `serve`/`run` — nothing is visible
until it ends (scripts/craft says so on stderr).

Disk space: install only what's used. `scripts/craft list` shows each app's size and last use — if one hasn't been used for 30+ days, add one line
at the end of another report ("X unused for 30 days — remove it? (n MB)"). Only after the user agrees: `scripts/craft remove <app>` (downloads,
the macOS app if Chammo installed it, settings and work folder → Trash; apps the user installed stay). Never remove on your own.

Same table as above (app · what it does · auth · common commands). A failing command returns the app's own error — fix and retry; after
three failures look at `ui.inspect` (an open dialog?) first. A dialog in the way → `scripts/craft dialog <app>` (kind, text) then `dialog <app> close` (whatever the app calls it). Each session gets **its own copy** of an app (up to 3 per app; the 2nd and 3rd are `<app>-2`/`<app>-3`, `status` shows the owner). `open` picks yours and commands go to yours by themselves. With all 3 taken, `open` prints "waiting (#N)" and opens by itself when one frees up (up to 30 min, `--wait <sec>`) — let it wait. Never write to someone else's copy ("in use by …"; `<app>-2 --force` only when you must). **When the person takes over** (the pane's Take over button), write commands (`run`, `do`) fail at once (exit code 4, "a person took over — script stopped") — your script stops there; reading (`shot`, `ui.inspect`) still works. On hand-back you get one line `[앱] … 돌려받음 — what the person changed · the document now (layer count, a screen png)` — **don't rerun the rest of the script on your own**: read that state and ask the person what next; if they say continue, re-plan the remaining steps around what they changed. Don't hide the window (it stops drawing). `close` (and the window's close
button) saves without asking when something changed — back to the person's file, or a .psd in your locker's `Craft` folder for a new
document; `scripts/craft recent` lists them to pick up again. No macOS app,
or the user wants it in the browser view → `scripts/craft open <app>` (web build in the space; no autosave, no CJK fonts).
