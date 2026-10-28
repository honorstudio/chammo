---
name: hq-craft
description: 사진·벡터·PDF·문서·표·영상·소리 같은 편집 일을 Craft 앱(scripts/craft)으로 할 때 연다 — 명함·전단·간판·로고·인쇄 파일(도련·재단선)·.ai·SVG→ai·"일러스트(레이터)로 만들어"·"포토샵으로"도 여기(사용자 결과물은 늘 Craft 앱으로).  맥 앱을 조작 채널로 띄워 참모가 명령으로 다루기, 창 없는 엔진으로 일괄 처리, 앱별로 할 수 있는 것. Editing work with the Craft apps — business cards, flyers, signs, logos, print files (bleed, trim marks), .ai, SVG→ai, "make it in Illustrator/Photoshop" too — driving the macOS app over its control channel, the windowless engine for batches, what each app can do.
---

<!-- Chammo 가 HQ 를 켤 때마다 새로 쓴다 — 고치지 않는다. / Rewritten by Chammo on every start — do not edit. -->

# 한국어

## Craft 앱 — 사용자는 말만, 참모가 다룬다

Craft 앱 13개(ArtCraft 오픈소스 — 맥 앱은 Chammo 용으로 빌드한 '참모 ○○', 웹판은 원본 그대로, **맥·윈도우** — 윈도우는 참모 라이트만 준비 중)는 맥 앱이 **조작 채널**(127.0.0.1)을 연다. 참모는 좌표를 누르지 않고
**명령 id** 를 보내고 답을 JSON 으로 받는다 — 메뉴로 할 수 있는 건 거의 다 명령으로 된다.
**만들고 고치는 일은 언제나 맥 앱으로**(`open <앱> --native` + `run`/`do`) — 사용자가 스페이스 칸에서 만드는 걸 따라 보고 언제든 넘겨받는다. 프로젝트 세션이 띄워도 그 세션을 맡긴 참모 탭에 칸이 뜬다.

**윈도우에서는**: 설치는 DMG·공증 대신 portable zip(체크섬·안의 앱 id·판 확인)을 %LOCALAPPDATA%\Programs\Chammo\<앱> 에 풀고, 앱은 화면 밖에서 뜬다(칸엔 찍은 그림, 1초 안팎으로 갱신). `cli`(창 없는 엔진)는 아직 없어 명령 찾기는 `do <앱> engine.commands`(PdfCraft 는 `ui.commands`)로. 한글 글꼴은 '맑은 고딕'. Python 3 가 있어야 돈다.

1. **띄우기**: `scripts/craft open <앱> --native [--work <폴더>]` — 맥 앱을 따로 설정 폴더·무작위 포트로 띄운다. 가짜 화면이 있으면 그 화면에(사용자 화면을 안 가림 — PhotoCraft 말고는 뜬 뒤 옮겨서 몇 초 보일 수 있다). `--here` 면 사용자 화면에(사용자가 직접 만지고 싶을 때). 출력의 **작업 폴더**에 파일을 넣고 꺼낸다(PhotoCraft·VectorCraft 는 그 폴더 밖 파일을 거절. `do`/`run` 의 경로는 작업 폴더 기준 상대 경로로 써도 된다 — scripts/craft 가 작업 폴더 절대 경로로 바꿔 넘긴다). 안 깔려 있으면 처음 한 번 참모 앱 공개 릴리스(Chammo 저장소의 crafts-<날짜>)에서 DMG 를 받아 체크섬·번들 id·애플 공증을 맞춰 보고 /Applications 에 깐다(22~132MB, 하나라도 안 맞으면 안 깔고 멈춤 · 릴리스를 못 받으면 서랍에 '받을 수 없음'). **기본 다섯(표·PDF·슬라이드·문서·벡터)은 앱이 첫 설정 뒤 미리 깐다**(`scripts/craft prefetch`, 설정 > 기능 '기본 참모 앱 미리 받기' · 5GB 아래면 건너뜀 · 사람이 지운 기본 앱은 다시 안 받음(다시 열거나 스위치를 껐다 켜면 받음) · `prefetch --status`) — 나머지 8개는 쓸 때
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
| GridCraft | 표(엑셀) | 없음 | `range.setValues`·`formulas.autoSum`·`data.sort`·`data.removeDuplicates`·`insert.chart`·`home.bold`/`fillColor`/`numberFormat`/`borders`·`sheet.read` |
| VectorCraft | 벡터 | 없음 | 도구·보기·`app.export` — 인쇄용 .ai 는 `document.save` 에 `{"bleed":{"useDocument":true}}` 를 줘야 도련까지 담긴다(안 주면 재단 크기로만) |
| DesignCraft | 지면 | 없음 | `file.exportPdf`(PNG 내보내기 없음)·`view.*` |
| DeckCraft | 발표 | 없음 | `slide.new` |
| FilmCraft | 영상 | 없음 | 타임라인·`ui.playback` |
| EffectCraft | 모션 | 없음 | `comp.new`·`ui.playback` |
| LightCraft | 사진 보관·RAW | 없음 | 가져오기·현상 |
| CADCraft | 캐드 | 없음 | AutoCAD 명령 이름 그대로 `run`(`line`·`circle`·`text`·`saveas`) |
| SoundCraft | 오디오 | 없음 | 트랙·믹스 |
| FigCraft | 화면 설계 | 없음 | `file.export`·`page.select` |

**어떤 파일은 어느 앱** — 사람이 앱에서 누를 때와 같은 표(앱 `domain/craftOpen`). 굵은 것은 스페이스가 그림 한 장밖에 못 보여 줘서 누르면 그 앱이 바로 열린다(`scripts/show` 도 그 앱으로 열라고 한 줄 알린다), 나머지는 미리보기가 기본이고 머리의 '참모 ○○로 열기'로 연다:
참모 벡터 **.ai .eps .svgz .emf .wmf .afdesign** .svg · 참모 포토 **.psd .psb .kra .xcf** .png .jpg .webp .tif · 참모 캐드 **.dwg .dxf** · 참모 표 **.xlsb** .xlsx .xlsm .ods .csv · 참모 문서 .docx · 참모 슬라이드 .pptx · 참모 PDF .pdf · 참모 화면 **.fig** · 참모 디자인 **.designcraft** · 참모 필름 **.fcproj** .mp4 .mov · 참모 이펙트 **.ecproj** · 참모 사운드 **.scproj** .wav .mp3.
안 깔린 앱(기본 다섯 말고 — 포토·필름·캐드 등)이 필요하면 묻지 말고 "참모 포토 설치하고 할게(306MB)"처럼 크기(`list --json` 의 dmgSize)와 한 줄 말한 뒤 `open <앱> --native <파일>` — 설치·확인은 그 명령이 한다(사람이 누른 길은 앱이 설치 확인 창을 한 번 띄운다).
- **엑셀 = 참모 표**: 표를 손보는 일(합계·계산식·정렬·중복 지우기·서식·차트·새 엑셀)은 칸이 적어도 `open gridcraft --native <파일>` + `run` — `sheet set` 여러 번·파이썬으로 대신하지 않는다(보기·몇 칸만 `scripts/show`·`scripts/sheet`). 정렬 `data.sort {"range":"A1:E15","header":true,"keys":[{"column":"A","order":"asc"}]}`, 합계 `cell.set {"cell":"E16","input":"=SUM(E2:E15)"}`, 차트 `insert.chart {"range":"G1:H4","type":"column","title":"…","at":"J2"}`. 색은 `home.fillColor`·`home.fontColor` 의 `"#RRGGBB"`(`home.formatCells` 의 style 색은 형식이 달라 실패). 새 엑셀은 파일 없이 `open gridcraft --native` → `range.setValues` → `do gridcraft app.save '{"path":"<절대 경로>.xlsx"}'`. 끝나면 `close`(사람 파일은 그 자리에 저장) 뒤 `scripts/show <파일>`
- **시작 화면의 '열기' 단추는 누르지 않는다** — 맥 파일 창이 앱을 막아 조작 채널이 멎는다(원본 동작). 파일은 `open <앱> --native <파일>` 로(앱마다 여는 명령이 달라 거기서 맞춰 부른다 — 문서·화면·필름엔 `app.open` 이 없다. 그 앱 형식이 아닌 파일·가져온 영상·소리는 닫을 때 원본 대신 새 파일로 저장). 참모 화면(FigCraft)은 `ui.click` 이 없고 `ui.mouse`
- **한글이 □ 로 나오면**: DesignCraft·FigCraft 는 기본 글꼴에 한글이 없다 — 글꼴을 `Apple SD Gothic Neo` 로(Design: `edit.selectAll` 뒤 `type.char {"fontFamily":…}`, Fig: `node.set {"fontFamily":…}`). GridCraft 는 PDF 내보내기만 □(xlsx·화면은 정상)
- 명령이 실패하면 앱 문구 그대로 오류가 나온다(`unknown command …`) — 고쳐서 다시. 같은 명령이 세 번 실패하면 `ui.inspect` 로 상태(열린 대화상자 등)부터 본다
- 대화창이 떠서 막히면 `scripts/craft dialog <앱>`(종류·글을 보여 준다) → `scripts/craft dialog <앱> close`(앱마다 다른 닫기 메서드를 알아서). 같은 앱은 **세션마다 따로** 뜬다(한 앱에 3개까지, 2·3번째는 `<앱>-2`·`<앱>-3` — `status` 에 주인 세션까지). `open` 이 내 것을 고르고 명령은 저절로 내 것으로 간다. 3개가 다 차 있으면 `open` 이 "대기 중 (N번째)"를 찍고 기다렸다 자리가 나면 이어서 띄운다(최대 30분, `--wait <초>`) — 끊지 말고 기다린다. 남의 인스턴스엔 안 쓴다("다른 세션이 쓰는 중" — 꼭 필요할 때만 `<앱>-2 --force`)
- **보기는 저절로 따라간다** — 필름은 시간이 있는 명령(자르기·놓기·자막) 앞에 재생 위치가 그 시간으로, 표는 `cell`·`range` 가 화면 밖이면 그 칸까지 스크롤, 포토는 그릴 자리(`select.rect`·`shape.create`·`type.create`)가 안 보이면 캔버스가 그쪽으로. 보기 옮기기를 따로 보내지 않는다(같은 자리 연속이면 안 움직임, 끄기 `CHAMMO_CRAFT_VIEW=0`)
- **사람이 개입하면**(칸의 개입 단추) 쓰기 명령(`run`·`do`)은 바로 실패한다(종료 코드 4, "사람이 개입함 — 스크립트 멈춤") — 스크립트는 거기서 멈춘다. 보기(`shot`·`ui.inspect`)는 된다. 돌려받으면 `[앱] … 돌려받음 — 사람이 바꾼 것 · 지금 문서 …(레이어 수·화면 png)` 한 줄이 온다 — **남은 스크립트를 스스로 다시 돌리지 말고** 그 상태를 보고 사람에게 다음을 묻는다. 이어서 하라면 남은 단계를 사람이 바꾼 걸 반영해 다시 짠다
- 창을 숨기지 않는다(숨기면 그림이 멈추고 찍기가 옛 그림). 앱 창을 사용자 화면으로 옮기지 않는다 — 사용자가 직접 만지길 원하면 `close` 후 `--here` 로 다시
- **닫기 = 묻지 않고 저장 후 닫기**: `close`(창의 닫기 단추도) 는 바뀐 게 있으면 저장한다 — 사람 파일로 열었으면 그 자리에 같은 형식 + 옆에 레이어 살린 PSD, 새 문서면 네 보관함 `Craft` 폴더에 PSD. 사용자가 "아까 그 사진 다시"면 `scripts/craft recent` 에서 찾아 `open photocraft --native <파일>`
- **공간**: 필요한 것만 깔아 쓴다. `scripts/craft list` 에 앱마다 크기·마지막으로 쓴 날이 나온다 — 30일 넘게 안 쓴 게 있으면(기본 다섯 — 목록의 `[basic / 기본]` — 은 빼고) 다른 일 보고 끝에 "○○ 30일 안 썼는데 지울까?(n MB)" 한 줄만. **사용자가 좋다고 한 것만** `scripts/craft remove <앱>`(받은 것·우리가 깐 맥 앱·설정·작업 폴더 → 휴지통, 사용자가 직접 깐 앱은 안 지움). 혼자 지우지 않는다
- 맥 앱이 없거나 사용자가 웹에서 보길 원하면 `scripts/craft open <앱>`(웹판, 스페이스) — 웹판은 자동 저장이 없고 한글 글꼴이 없다

# English

## Craft apps — the user talks, you drive

The 13 Craft apps (ArtCraft open source — the macOS apps are the Chammo builds '참모 ○○', the web builds unchanged; **macOS and Windows** — on Windows all but Chammo Light) open a **control channel** (127.0.0.1) in the macOS app.
You don't click coordinates: send a **command id** and get JSON back — nearly every menu item is a command.
**Making or editing something always goes through the macOS app** (`open <app> --native` + `run`/`do`) — the user follows along in the space
and can take over any time. A project session opening it gets its pane in the tab of the assistant that delegated the session.

**On Windows**: install is a portable zip (checksum plus the app id/version inside, no notarization) unpacked to %LOCALAPPDATA%\Programs\Chammo\<app>, and the app runs off screen (the pane shows a picture refreshed about once a second). There is no `cli` yet — find commands with `do <app> engine.commands` (PdfCraft: `ui.commands`). Korean font: 'Malgun Gothic'. Needs Python 3.

1. **Open**: `scripts/craft open <app> --native [--work <dir>]` — its own settings folder and a random port. With the agents screen
   it opens there, out of the user's way (apps other than PhotoCraft are moved there after they appear, so they may flash for a few seconds); `--here` puts it on the user's
   screen (when they want to touch it). `open <app> --native <file>` copies a person's file in and, on close, saves it back there
   (same format + a layered .psd beside it). Otherwise put files into and take them from the printed **work folder** (PhotoCraft and VectorCraft refuse
   files outside it; paths in `do`/`run` may be relative to the work folder — scripts/craft turns them into absolute paths). Not installed → the first time it downloads the DMG from the Chammo apps release (the Chammo repo, crafts-<date>), checks the checksum, bundle id
   and Apple notarization and installs it to /Applications (22–132 MB; any mismatch: nothing installed; release unreachable: 'unavailable' in the drawer). **The basic five (Grid, PDF, Deck, Word, Vector) are installed ahead by the app after setup** (`scripts/craft prefetch`, Settings > Features 'Install the basic Chammo apps ahead'; skipped under 5 GB free; one the person removed isn't fetched again until they open it or turn the switch off and on; `prefetch --status`) — the other 8 when needed
2. **Find commands**: `scripts/craft do <app> engine.commands` (most apps — ids and params). It differs per app: PdfCraft uses
   `do pdfcraft ui.commands` (menu commands), SoundCraft params come from `scripts/craft cli soundcraft describe <id>`, GridCraft from
   `cli gridcraft commands --json`. Never click the start screen's Open button — the macOS file dialog blocks the app and the control channel stalls (original behaviour); open files with `open <app> --native <file>` (it picks each app's open command — Word, Fig and Film have no `app.open`; a file not in the app's own format, or imported video/audio, is saved as a new file on close instead of over the original). FigCraft has no `ui.click` — use `ui.mouse`. Korean shows as boxes in DesignCraft/FigCraft (default fonts) — set the font to `Apple SD Gothic Neo`
3. **Do**: `scripts/craft run <app> <command id> '<json params>'`; raw channel calls `scripts/craft do <app> <method> '<json>'`
   (`app.open`, `app.save`, `ui.inspect`, `ui.menu.invoke`)
4. **Check**: `scripts/craft shot <app> --out <png>` and look at it; show results to the user with `scripts/show`
5. **Close**: `scripts/craft close <app>` — always when done. 10 of the 13 have no auth on the control port (any program on this Mac can
   connect), so never leave one running. `scripts/craft status` lists what's open

The windowless engine (`scripts/craft cli …`) is **only for work nobody needs to watch** — batches (retouch 100 photos: `cli photocraft batch …`),
format conversion (`convert`), reading info (`info`). Don't build a result (a PSD, a laid-out document) with cli `serve`/`run` — nothing is visible
until it ends (scripts/craft says so on stderr).

Disk space: install only what's used. `scripts/craft list` shows each app's size and last use — if one hasn't been used for 30+ days (except the basic five — `[basic / 기본]` in the list), add one line
at the end of another report ("X unused for 30 days — remove it? (n MB)"). Only after the user agrees: `scripts/craft remove <app>` (downloads,
the macOS app if Chammo installed it, settings and work folder → Trash; apps the user installed stay). Never remove on your own.

**Which file goes to which app** — the same table the app uses when the person clicks a file (`domain/craftOpen`). Bold ones the space can only show as one picture, so clicking opens the app right away (`scripts/show` says so in one line); the rest preview by default with 'Open in Chammo X' in the header:
Chammo Vector **.ai .eps .svgz .emf .wmf .afdesign** .svg · Chammo Photo **.psd .psb .kra .xcf** .png .jpg .webp .tif · Chammo CAD **.dwg .dxf** · Chammo Grid **.xlsb** .xlsx .xlsm .ods .csv · Chammo Word .docx · Chammo Deck .pptx · Chammo PDF .pdf · Chammo Fig **.fig** · Chammo Design **.designcraft** · Chammo Film **.fcproj** .mp4 .mov · Chammo Effect **.ecproj** · Chammo Sound **.scproj** .wav .mp3.
If it needs an app that isn't installed (not one of the basic five — Photo, Film, CAD …), don't ask — say "installing Chammo Photo for this (306 MB)" in one line with its size (`list --json` dmgSize), then `open <app> --native <file>`; that command installs and checks it (when the person clicks, the app asks once before installing).

**Excel = Chammo Grid**: reworking a table (totals, formulas, sorting, removing duplicates, formatting, charts, a new workbook) is `open gridcraft --native <file>` + `run`
even for a few cells — not many `sheet set` calls or Python (only looking and a few cells use `scripts/show`/`scripts/sheet`). Sort `data.sort {"range":"A1:E15","header":true,"keys":[{"column":"A","order":"asc"}]}`,
total `cell.set {"cell":"E16","input":"=SUM(E2:E15)"}`, chart `insert.chart {"range":"G1:H4","type":"column","title":"…","at":"J2"}`. Colors via `home.fillColor`/`home.fontColor` `"#RRGGBB"`
(`home.formatCells` style colors use another shape and fail). New workbook: `open gridcraft --native` with no file → `range.setValues` → `do gridcraft app.save '{"path":"<absolute path>.xlsx"}'`.
Then `close` (a person's file is saved back in place) and `scripts/show <file>`.

Same table as above (app · what it does · auth · common commands). A failing command returns the app's own error — fix and retry; after
three failures look at `ui.inspect` (an open dialog?) first. A dialog in the way → `scripts/craft dialog <app>` (kind, text) then `dialog <app> close` (whatever the app calls it). Each session gets **its own copy** of an app (up to 3 per app; the 2nd and 3rd are `<app>-2`/`<app>-3`, `status` shows the owner). `open` picks yours and commands go to yours by themselves. With all 3 taken, `open` prints "waiting (#N)" and opens by itself when one frees up (up to 30 min, `--wait <sec>`) — let it wait. Never write to someone else's copy ("in use by …"; `<app>-2 --force` only when you must). **The view follows by itself** — FilmCraft moves the playhead to a command's time (cut, place, caption), GridCraft scrolls to an off-screen `cell`/`range`, PhotoCraft pans the canvas to where `select.rect`/`shape.create`/`type.create` draws; don't send view moves yourself (`CHAMMO_CRAFT_VIEW=0` turns it off). **When the person takes over** (the pane's Take over button), write commands (`run`, `do`) fail at once (exit code 4, "a person took over — script stopped") — your script stops there; reading (`shot`, `ui.inspect`) still works. On hand-back you get one line `[앱] … 돌려받음 — what the person changed · the document now (layer count, a screen png)` — **don't rerun the rest of the script on your own**: read that state and ask the person what next; if they say continue, re-plan the remaining steps around what they changed. Don't hide the window (it stops drawing). `close` (and the window's close
button) saves without asking when something changed — back to the person's file, or a .psd in your locker's `Craft` folder for a new
document; `scripts/craft recent` lists them to pick up again. No macOS app,
or the user wants it in the browser view → `scripts/craft open <app>` (web build in the space; no autosave, no CJK fonts).
