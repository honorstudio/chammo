// 떠 있는 참모 배지(시안 .shots/orch-bubble v1 A, 10-28 사용자 "A 좋다") — 대화창은 참모 채팅 칸 그 자체를 띄운 것(새 attach 없음)
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BubbleFloatCtx, FloatHost, type BubbleFloat } from './OrchBubble';

const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const app = src('../../App.tsx');
const view = src('./SpaceView.tsx');
const bubble = src('./OrchBubble.tsx');
const css = src('./orchBubble.css');
const paused = src('../paused.css');
const messenger = src('../team/MessengerApp.tsx');
const rust = src('../../../src-tauri/src/orch_bubble.rs');
const mainRs = src('../../../src-tauri/src/main.rs');

const host = (f: BubbleFloat) => renderToStaticMarkup(createElement(BubbleFloatCtx.Provider, { value: f }, createElement(FloatHost, { children: (floating: boolean) => createElement('i', { 'data-floating': String(floating) }) })));

describe('대화창 = 참모 채팅 칸 그 자체(FloatHost)', () => {
  it('닫혀 있으면 감싸기만(display: contents) — 머리 비고 자리 없음', () => {
    const h = host(null);
    expect(h).toContain('class="obb-host"');
    expect(h).not.toContain('style=');
    expect(h).toContain('<div class="obb-head"></div>');
    expect(h).toContain('data-floating="false"');
    expect(css).toMatch(/\.obb-host, \.obb-body \{ display: contents; \}/);
  });
  it('열리면 같은 요소가 떠 있는 창 — 자리·이름·머리', () => {
    const h = host({ rect: { x: 10, y: 20, w: 360, h: 470 }, head: createElement('b', null, '머리'), label: '참모 대화창' });
    expect(h).toContain('class="obb-host obb-float"');
    expect(h).toContain('role="dialog"');
    expect(h).toContain('aria-label="참모 대화창"');
    expect(h).toMatch(/style="left:10px;top:20px;width:360px;height:470px"/);
    expect(h).toContain('<b>머리</b>');
    expect(h).toContain('data-floating="true"');
  });
  it('앱은 참모 채팅 격자를 FloatHost 로 감싸고, 떠 있는 동안엔 탭 보기(참모 하나씩)', () => {
    expect(app).toContain("<FloatHost>{(floating) => <SessionGrid column chat={floating ? 'tabs' : chatView}");
  });
});

describe('어디에 뜨나', () => {
  it('배지는 바탕 배지 창 하나뿐 — 앱 창 안(메인·메신저 따로 창)엔 안 그린다(10-28 사용자 "하나만")', () => {
    expect(view).not.toContain('bub.badge}');
    expect(messenger).not.toMatch(/LinkBadge|<WinBadge/);
    expect(rust).toContain('bubble && (main_seen || desk)');
  });
  it('얼굴(바탕 배지가 그릴 참모)은 설정 > 기능에서 켠 동안·참모 채팅이 있을 때·다른 기기를 안 볼 때만 적는다', () => {
    expect(view).toContain('const faceId = bubble && chat && !far ?');
    expect(app).toContain("bubble={features.bubble ? { onHide: () => saveFeature('bubble', false) } : null}");
  });
  it('앱 안 대화창은 참모 채팅 칸이 가려진 화면(팀 모드·홈)에서만 — 보이면 그 참모 채팅 탭으로', () => {
    expect(view).toContain('covered: teamOn || atHomePick');
    expect(bubble).toContain('openWith: (id: string) => { onPick(id); if (covered) setOpen(true); }');
    expect(bubble).toContain('useEffect(() => { if (!covered) setOpen(false); }, [covered]);'); // 같은 채팅이 칸과 창 둘에 있을 수 없다
  });
  it('채팅 칸이 숨는 화면(홈·접힘)에서 열면 숨기지 않고 안 보이게만 — 떠 있는 창만 보인다', () => {
    expect(view).toContain("<div className={`cv-chat-slot${chatHid && bub.open ? ' obb-ghost' : ''}`} hidden={chatHid && !bub.open}>");
    expect(css).toMatch(/\.cv-chat-slot\.obb-ghost > \.office-chats \{[^}]*visibility: hidden/);
    expect(css).toMatch(/\.obb-host\.obb-float \{[^}]*visibility: visible/);
  });
  it('배지 얼굴 = 지금 채팅 탭 참모, 묻는 참모가 앞으로(domain/orchBubble bubbleFace)', () => {
    expect(view).toContain('face: bubbleFace(bubOrchs, nav.chat ?? chatOrch?.id)');
  });
  it('대화창이 열린 동안 채팅 탭이 바뀌어도(머리 얼굴·탭 보기 격자) 보던 화면(홈·팀)은 그대로 — 하네스에서 홈이 닫혔다', () => {
    expect(view).toContain('if (quietTabs.current) { setNav((n) => (n.chat === id ? n : { ...n, chat: id })); return; }');
    expect(view).toContain('quietTabs.current = bub.open;');
  });
  it('참모 화면으로 = 띠 프사 누름과 같은 길', () => {
    expect(view).toContain('onPick={pickOrch}');
    expect(view).toContain('onGo: pickOrch');
  });
});

describe('놓기', () => {
  it('띠 프사에 놓은 것(ORCH_DROPPED)은 칸이 가려진 화면이면 그 참모 대화창으로', () => {
    expect(bubble).toContain('pickRef.current(id); if (coveredRef.current) setOpen(true);');
  });
  it('팀 화면에서 "내 참모에게" 준 파일은 팀 화면을 안 떠나고 대화창에 붙는다', () => {
    expect(view).toContain('if (bubble && teamOn && !far) { bub.openWith(id); attachWhenReady(id, paths); return; }');
  });
});

describe('모양', () => {
  it('층은 변수(숫자 z-index 금지), 도는 고리는 멈춤 목록에', () => {
    expect(css).not.toMatch(/z-index:\s*\d/);
    expect(paused).toContain('.obb-wave');
  });
  it('고리는 정수 테두리 — 반 픽셀 퍼짐 그림자는 웹킷 1배 화면에서 한쪽 2px·반대쪽 3px(사용자 348)', () => {
    const r = css.match(/^\.obb-ring \{[^}]*\}/m)![0];
    expect(r).toMatch(/border: 3px solid var\(--rc\)/);
    expect(r).not.toMatch(/\d\.\d+px/);
    expect(css).not.toMatch(/\.obb-badge \{[^}]*box-shadow/); // 그림자는 고리 바깥 — 배지에 두면 고리 안쪽 틈 아래만 어둡다
  });
  it('익숙한 동작은 아이콘(키우기·참모 화면으로·접기) — 이름은 aria-label', () => {
    expect(bubble).toContain("label={big ? tr('작게', 'Smaller') : tr('키우기', 'Bigger')}");
    expect(bubble).toContain("label={tr('참모 화면으로', 'Open in assistant view')}");
    expect(bubble).toContain("label={tr('접기', 'Collapse')}");
  });
});

describe('바탕 배지 \'앱에서 열기\' — 메인 창 부르기', () => {
  it('메인 창이 배지 얼굴을 적고(배지를 끄면 지움), 바탕 배지가 그 얼굴을 그린다', () => {
    expect(view).toContain('useEffect(() => publishFace(faceId), [faceId]);');
  });
  it('Rust orch_bubble_main — 메인 창을 앞으로 + __orchGo 로 그 참모 화면(id 는 모양을 거른다)', () => {
    expect(rust).toContain('if !orch_id_ok(&orch)');
    expect(rust).toContain('to_main(&app_handle, "__orchGo"');
    expect(mainRs).toContain('orch_bubble::orch_bubble_main,');
    expect(view).toContain('w.__orchGo = (r) => { if (r?.orch) goRef.current(r.orch); };');
  });
});

describe('바탕 배지(앱을 내려도 — 10-28 사용자)', () => {
  const desk = src('./DeskBubble.tsx');
  const vite = src('../../../vite.config.ts');
  const setup = src('../Setup.tsx');
  it('따로 창(bubble.html)으로 빌드되고, 설정 > 기능 \'앱을 내려도 참모 배지 띄우기\'가 있다', () => {
    expect(vite).toContain("bubble: 'bubble.html'");
    expect(setup).toContain("'bubble', 'bubbleDesk',");
    expect(mainRs).toContain('orch_bubble::watch(app.handle());');
  });
  it('앱 창이 보이든 말든 배지가 켜져 있으면 — \'앱을 내려도\'를 끄면 앱을 내릴 때만 같이 내려간다, 0.7초마다 본다', () => {
    expect(rust).toContain('let want = desk_shown(f.bubble, f.bubble_desk, seen);');
    expect(rust).toContain('bubble && (main_seen || desk)');
  });
  it('자리는 독·메뉴줄을 뺀 작업 영역 기준, 끌어 놓자마자 화면 안으로 당긴다(끝에 걸쳐 잘리지 않게, 참모-2 10-28)', () => {
    expect(rust).toContain('m.work_area()');
    expect(desk).toMatch(/write\(SPOT_KEY, JSON\.stringify\(screenSave\([^;]*\)\)\);[\s\S]{0,240}void toBadge\(true\)/);
  });
  it('그릴 얼굴이 없으면(터미널 뷰·다른 기기 보는 중) 빈 투명 창이 클릭을 먹지 않게 내린다', () => {
    expect(desk).toContain("invoke('bubble_face', { has })");
    expect(rust).toContain('fn bubble_face(');
  });
  it('묻는 참모가 생기면 배지 옆 배너 — 누르면 그 참모 대화창(10-28 사용자 "배너 눌러서 대화")', () => {
    expect(desk).toContain("const askKey = who?.pip === 'ask' ? who.id : '';");
    expect(desk).toContain('className="obd-peek"');
    expect(desk).toMatch(/className="obd-peek"[\s\S]{0,600}onClick=\{\(\) => \{[^}]*openPop\(true, big, askKey\)/);
    expect(css).not.toMatch(/\.obd-peek \{[^}]*pointer-events: none/);
  });
  it('배너·부채에서 대화창을 열 땐 무대 창 안 배지 상자 자리에서(무대 창 = 배지 + 펼칠 자리, 왼쪽 위가 배지가 아니다)', () => {
    expect(desk).toContain('const b = { x: s.win.x + frameRef.current.box.x, y: s.win.y + frameRef.current.box.y };');
    expect(desk).toContain('openingRef.current = true;');
  });
  it('올림·뺌·배너는 창 크기·자리를 안 바꾼다 — 창은 늘 무대 크기, 바뀌는 건 웹뷰 안 그림뿐(10-28 사용자 "호버하면 깜빡이면서 잠깐 위치가 바뀜", 실측 올림 6번 중 4번 -150px 튐·뺌 1번 사라짐)', () => {
    expect(desk).toContain('deskFrame(');
    expect(desk).not.toMatch(/w: DESK \+ FAN, h: DESK \+ FAN/); // 부채만큼 창을 키우던 것
    expect(desk).not.toContain('placePeek'); // 배너만큼 창을 키우던 것
    const fanFx = desk.slice(desk.indexOf('// 부채 —'), desk.indexOf('const press = useRef'));
    expect(fanFx).not.toMatch(/placeBox|toBadge|place\(/);
    expect(desk).not.toMatch(/useEffect\(\(\) => \{[^\n]*peek[^\n]*toBadge/);
  });
  it('무대 쪽이 바뀌어 창 자리와 웹뷰 안 배지 자리가 같이 바뀔 땐 배지를 감춘 채 옮기고 다 그린 뒤 보인다(한 프레임 어긋남이 안 보이게)', () => {
    expect(desk).toMatch(/if \(flip\) \{ setHide\(true\); await paint\(\); \}[\s\S]{0,200}await place\(f\.win, false, 0, viewOf\(f, modeRef\.current\)\);[\s\S]{0,120}setFrame\(f\);[\s\S]{0,120}if \(flip\) \{ await paint\(\); setHide\(false\); \}/);
    expect(desk).toContain('const flip = f.box.x !== frameRef.current.box.x || f.box.y !== frameRef.current.box.y;'); // 창 안 배지 자리가 바뀔 때만
    expect(css).toMatch(/\.obd-wrap\.hide \{[^}]*visibility: hidden/);
  });
  it('끄는 동안엔 창 크기·제자리 당김을 안 한다 — 놓은 뒤 한 번', () => {
    expect(desk).toMatch(/if \(!force && \(openRef\.current \|\| peekRef\.current \|\| fanRef\.current \|\| draggingRef\.current/);
    expect(desk).toMatch(/if \(!draggingRef\.current && !openRef\.current && !fanRef\.current/); // 3초마다 제자리 확인
  });
  it('맥: 대화창이 되면 패널을 키 창으로(웹뷰 글칸은 눌러도 패널을 키 창으로 안 만든다), 배지로 돌아가면 키를 내려놓는다', () => {
    expect(rust).toContain('makeKeyWindow');
    expect(rust).toContain('resignKeyWindow');
    expect(rust).toContain('setBecomesKeyOnlyIfNeeded: !key');
    expect(desk).toContain('requestAnimationFrame(() => focusIn.current?.());'); // 열자마자 칠 수 있게
  });
  it('맥: 비활성 패널(눌러도 앱이 안 깸)·⌘H 에 안 숨음·전체 화면 앱 위엔 안 뜸(FullScreenAuxiliary 없음)·키 창은 대화창일 때만', () => {
    expect(rust).toContain('setStyleMask: mask | (1 << 7)');
    expect(rust).toContain('setCanHide: false');
    expect(rust).toContain('setCollectionBehavior: (1usize) | (1 << 6)');
    expect(rust).toContain('Bool::new(KEYABLE.load(Ordering::SeqCst))');
    expect(rust).toContain('orderFrontRegardless');
    // 창 한 판이 대화창 자리까지 품어 배지보다 한참 위로 뻗는다 — 끌 때 맥이 위쪽을 메뉴줄 밑으로 당기면 배지를 화면 위쪽으로 못 끈다
    expect(rust).toContain('b.add_method(sel!(constrainFrameRect:toScreen:), free as extern "C" fn(_, _, _, _) -> _);');
  });
  it('맥 끌기는 창이 커서를 직접 따라간다 — 맥 창 끌기(performDrag)는 위쪽이 메뉴줄에서 멈춰 한 판 창이면 배지를 화면 위쪽으로 못 끈다(11-05 아이맥 실측)', () => {
    expect(rust).toMatch(/#\[cfg\(target_os = "macos"\)\]\s*follow\(w\);\s*#\[cfg\(not\(target_os = "macos"\)\)\]\s*let _ = w\.start_dragging\(\);/); // 윈도우는 창 끌기 그대로
    // 판 기준(11-11 사용자 "튀어나감") — 처음 창 원점으로 놓으면 끌기 시작에 칸이 부채 → 배지로 줄어든 차이만큼 배지가 튀었다
    expect(rust).toMatch(/if let \(Some\(plate0\), Some\(m0\)\) = \(plate_now\(&w\), mouse\(1\.0\)\)[\s\S]{0,200}while button_down\(\) \{[\s\S]{0,300}apply\(&w, Set::Move\(follow_plate\(plate0, m0, m\)\)\)/);
    expect(rust).toMatch(/Set::Move\(p\) => \{\s*let Some\(s\) = shape\(\) else \{ return \};\s*let \(a, _\) = mac_frames\(p, s, h0, false\);/); // 그 순간의 칸으로 창을 놓는다(메인 스레드)
    expect(rust).toMatch(/pub fn moved\(app: &tauri::AppHandle\) \{\s*if FOLLOWING\.load\(Ordering::SeqCst\) \{\s*return;/); // 끄는 중엔 자리 저장·제자리 확인을 안 깨운다
    expect(rust).toContain('let pass = !FOLLOWING.load(Ordering::SeqCst) &&'); // 끄는 중 커서가 받는 자리를 벗어나도 놓음이 바탕 앱으로 안 샌다
  });
  it('보내기는 폰과 같은 길(참모에게만·제어 문자 빼고) — 대화창은 터미널 없는 ChatView', () => {
    expect(desk).toContain("invoke('bubble_send', { id: chatId, text })");
    expect(desk).toContain('<ChatView key={who.id} sessionId={sid}');
    expect(rust).toContain('if !is_hq_session(&sessions, id, &hq)');
    expect(rust).toMatch(/pub async fn bubble_send\([\s\S]{0,400}hq_only\(&id\)\.await\?;/);
  });
  it('자리는 모니터별 화면 + 비율, 사람이 끈 것만 기억(앱이 놓은 자리도 옮김 사건이 온다)', () => {
    expect(desk).toContain('screenPlace(readSpot(read(SPOT_KEY)), s.screens, s.app, DESK)');
    expect(desk).toContain('if (!draggedRef.current) return;');
    expect(desk).toContain('const f = frameAt(b, s.screens, isBig);');
  });
});

describe('대화창 톡 열림·닫힘(10-28 사용자 "눌러서 채팅하는 작은 창 애니메이션으로 팝업")', () => {
  const desk = src('./DeskBubble.tsx');
  it('열 때: 접힌 대화창(from)을 먼저 그리고 펼친다(in) — 창은 이미 대화창 자리까지 품은 한 판이라 키 창만 된다', () => {
    expect(desk).toMatch(/if \(grow\) setAnim\('from'\);[\s\S]{0,300}if \(grow\) await paint\(\);[\s\S]{0,200}await place\(f\.win, true, 0, viewOf\(f, 'open'\)\);[\s\S]{0,200}setAnim\('in'\)/);
  });
  it('이미 열린 대화창의 키우기·참모 바꾸기는 다시 톡 하지 않는다', () => {
    expect(desk).toContain('const grow = !openRef.current;');
  });
  it('닫을 때: 배지 쪽으로 접고(out) 대화창만 내린 뒤 키를 내려놓는다 — 창은 같은 판 그대로, 배지는 한 번도 안 감춘다', () => {
    expect(desk).toMatch(/setAnim\('out'\)[\s\S]{0,300}POP_MS\.close[\s\S]{0,300}setAnim\('gone'\);\s*setOpen\(false\);[\s\S]{0,300}await place\(s\?\.win \?\? frameRef\.current\.win, false, 0, viewOf\(frameRef\.current, 'rest'\)\);[^\n]*\n\s*await toBadge\(true\)/);
  });
  it('열기·접기에 배지를 감추거나 다시 붙이지 않는다(11-05 사용자 "펼칠 때·닫힐 때 깜빡" — 감췄다 보이는 게 깜빡임) — 배지는 닫혀도 열려도 같은 button 하나', () => {
    expect(css).not.toMatch(/\.a-(from|gone) \.obd-wrap/);
    expect(css).not.toContain('obd-back');
    expect(desk).not.toContain('obd-back');
    expect(desk.match(/className=\{`obb-badge obd-badge/g)).toHaveLength(1);
    expect(desk).toContain("aria-label={open ? tr(`${who.label} 대화창 접기`");
    expect(desk).toContain('onClick={() => { if (!pressed()) void openPop(!open); }}');
    // 대화창이 배지를 덮을 땐(키우기) 대화창이 배지보다 위 층 — 배지를 감추는 대신 층으로 가린다
    const z = (re: RegExp) => Number(css.match(re)![1]);
    expect(z(/\.obd-desk > \.obd-pop \{ z-index: calc\(var\(--z-panel\) \+ (\d)\)/)).toBeGreaterThan(z(/^\.obb-badge \{[^}]*z-index: calc\(var\(--z-panel\) \+ (\d)\)/m));
  });
  it('창 한 판(deskFrame) — 닫힌 배지·열기·크기 손잡이가 같은 계산(frameAt), 판이 같으면 창을 안 바꾼다', () => {
    expect(desk).toContain('deskFrame({ x: b.x, y: b.y, w: DESK, h: DESK }, { x: b.x + BX, y: b.y + BY, w: 52, h: 52 }, screens, EXT, size, isBig)');
    expect(desk).toContain('const f = frameAt(p, s.screens, bigRef.current);'); // 닫힌 배지
    expect(desk).toContain('const f = frameAt(d.b, d.screens, false, next);'); // 크기 손잡이
    expect(desk).toContain('const moved = !sameRect(s.win, f.win);');
    expect(desk).not.toMatch(/place\([^)]*\? 0 : 14\)/); // 창 모서리 깎기 없음 — 대화창 둥근 모서리는 CSS
  });
  it('자라 나오는 점은 배지 가운데(popOrigin) — 부채·배너에서 열어도 같은 openPop 한 길', () => {
    expect(desk).toContain('const f = frameAt(b, s.screens, isBig);');
    expect(desk).toMatch(/onPick=\{\(id\) => \{[^}]*openPop\(true, big, id\)/);
    expect(desk).toContain('transformOrigin: `${frame.origin.x}px ${frame.origin.y}px`');
  });
  it('바탕 대화창 테두리는 안쪽 정수 border — 창이 대화창 가장자리에 딱 맞아 바깥 퍼짐 그림자는 잘린다(10-28 사용자 "테두리 획 안 보임")', () => {
    const rule = css.match(/\.obd-pop \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/border: 1px solid/);
    expect(rule).not.toMatch(/box-shadow: 0 0 0 1px/);
  });
  it('움직임 줄이기(OS·앱 설정)면 바로 열고 닫는다 — JS 는 motionOn, CSS 는 prefers-reduced-motion', () => {
    expect(desk).toContain("import { motionOn } from '../calm';");
    expect(desk).toContain('popSteps(false, motionOn())'); // 닫기는 접는 기다림 없이
    expect(desk).toContain('const still = !motionOn();');
    expect(desk).toContain("className={`obd-pop a-${anim}${still ? ' still' : ''}`}");
    expect(css).toMatch(/\.obd-pop\.still \{[^}]*transition: none/);
    const reduce = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduce).toMatch(/\.obd-pop[^{]*\{[^}]*transition: none/);
  });
  it('펼침은 살짝 튀는 곡선(1 넘는 cubic-bezier), 접힘은 작게·투명하게', () => {
    expect(css).toMatch(/\.obd-pop\.a-in \{[^}]*transition: transform [^;]*cubic-bezier\([^,]+, 1\.[0-9]+/);
    expect(css).toMatch(/\.obd-pop\.a-from, \.obd-pop\.a-out, \.obd-pop\.a-gone \{[^}]*opacity: 0;[^}]*scale\(/);
  });
});

describe('바탕 배지 물결·그림자가 창 끝에서 안 잘린다(10-28 사용자 캡처 — 물결 고리 위가 납작)', () => {
  const desk = src('./DeskBubble.tsx');
  const dom = src('../../domain/orchBubble.ts');
  const num = (re: RegExp, t: string) => Number(t.match(re)![1]);
  it('창 여백 + 배지 상자 여백이 고리(7)·물결·그림자의 가장 먼 퍼짐보다 크다 — 위·옆·아래', () => {
    const ring = num(/\.obb-ring \{[^}]*inset: -(\d+)px/, css);
    // 물결 = 고리 바깥 반지름(26 + 2)에서 scale 만큼 — 0→12px 퍼짐
    const wave = Math.round(28 * (Number(css.match(/@keyframes obb-wave[^\n]*scale\((1\.\d+)\)/)![1]) - 1));
    const dy = num(/^\.obb-ring \{ --obb-drop: 0 (\d+)px \d+px rgba/m, css), blur = num(/^\.obb-ring \{ --obb-drop: 0 \d+px (\d+)px rgba/m, css);
    const pad = num(/export const DESK_PAD = (\d+);/, dom);
    const [box, bx, by] = [num(/const DESK = (\d+);/, desk), num(/const BX = (\d+)/, desk), num(/BY = (\d+);/, desk)];
    const reach = { top: ring + Math.max(wave, blur - dy), side: ring + Math.max(wave, blur), bottom: ring + Math.max(wave, blur + dy) };
    expect(by + pad).toBeGreaterThan(reach.top);
    expect(bx + pad).toBeGreaterThan(reach.side);
    expect(box - bx - 52 + pad).toBeGreaterThan(reach.side);
    expect(box - by - 52 + pad).toBeGreaterThan(reach.bottom);
  });
  it('배지·부채·배너·대화창 창(한 판)은 상자에 여백·펼칠 자리를 더해 놓고(deskFrame), 읽을 땐 판 안 상자 자리로 — 놓는 자리·작업 영역 당김·누름은 배지 상자 기준 그대로', () => {
    expect(desk).toContain('const p = screenPlace(readSpot(read(SPOT_KEY)), s.screens, s.app, DESK);');
    expect(desk).toContain('const boxOff = frame.box;');
    expect(desk).not.toMatch(/place\(\{ x: (p|side)\./); // 상자 창을 맨 place 로 놓지 않는다
    expect(desk).toContain("<div className={`obd-wrap${hide ? ' hide' : ''}`} style={{ inset: DESK_PAD }}");
    expect(desk).toMatch(/await place\(f\.win, true, 0, viewOf\(f, 'open'\)\)/); // 대화창도 같은 판(배지 상자 여백은 그 안에)
  });
});

describe('열린 동안 배지는 제자리, 대화창은 끌어 옮긴다(10-28 사용자 "최소화할 때 위치가 불분명·채팅창 이동 불가")', () => {
  const desk = src('./DeskBubble.tsx');
  it('열린 대화창 옆에 배지가 남고, 누르면 접힌다', () => {
    expect(desk).toMatch(/aria-label=\{open \? tr\(`\$\{who\.label\} 대화창 접기`[\s\S]{0,800}onClick=\{\(\) => \{ if \(!pressed\(\)\) void openPop\(!open\); \}\}/);
    expect(desk).toContain('...(frame.badge ? [badgeAt] : [])'); // 대화창이 배지를 덮으면(키우기) 받는 자리에서 뺀다
  });
  it('대화창 머리 빈 곳을 끌면 맥 창 끌기(단추 위는 아님) — 놓으면 같이 옮겨진 배지 자리를 기억', () => {
    expect(desk).toMatch(/className="obb-head obd-head"[^>]*onPointerDown=\{\(e\) => \{ if \(e\.button === 0 && !\(e\.target as Element\)\.closest\('button'\)\) \{ startDrag\(\); \}/);
    expect(desk).toContain('const b = { x: w0.x + frameRef.current.box.x, y: w0.y + frameRef.current.box.y };');
  });
});

describe('누르기 = 대화창, 올리기 = 부채, 끌기 = 옮기기 — 비활성 패널도(10-28 사용자 "드래그할 때 사라짐·꾹 누르면 부채")', () => {
  const desk = src('./DeskBubble.tsx');
  const fan = src('./BubbleFan.tsx');
  it('올림은 Rust 가 전역 마우스로 본다(앱이 안 깨어 있으면 웹뷰에 마우스 올림이 안 온다) — 들면 부채, 나가면 잠깐 뒤 접힘', () => {
    expect(rust).toContain('fn track(app: tauri::AppHandle)');
    expect(rust).toContain('window.__bubbleHover && window.__bubbleHover({on})');
    expect(desk).toMatch(/w\.__bubbleHover = \(on: boolean\) => \{ if \(draggingRef\.current\) return; if \(on\) hoverRef\.current\.enter\(\); else hoverRef\.current\.leave\(\); \};/);
    expect(fan).toContain('window.setTimeout(() => { t.current = 0; shut(true); }, FAN_LEAVE_MS)'); // 부채 둘레 밖으로 나간 뒤에만 잰다
  });
  it('펴진 동안 머물기는 마우스 자리(부채 둘레)로 — 올림 칸은 배지 원만, 창 밖이면 null(10-28 밤 사용자 "빼도 오래 떠 있음")', () => {
    expect(desk).toContain('fan ? { hot: [fanAt], hover: [badgeAt] }');
    expect(desk).toContain('if (!draggingRef.current) hoverRef.current.move(x < 0 ? null : { x, y });');
    expect(desk).toMatch(/zoneRef\.current = \(p\) => fanKeep\(p, \{ x: DESK_PAD \+ off\.x \+ 26, y: DESK_PAD \+ off\.y \+ 26 \}, side, fanK\)/);
    expect(fan).toContain("if (!onRef.current || over.current || keepRef.current(at.current)) { stop(); return; }");
  });
  it('접힘 — 얼굴들이 배지로 빨려 들어가는 동안 그려 두고(out) 내린다, 움직임 줄이기·고르기(close)는 바로', async () => {
    expect(fan).toContain('const fold = anim && was && motionOn();');
    expect(fan).toContain('close: () => { over.current = false; shut(false); }');
    expect(desk).toContain('{!open && fanShown && <BubbleFan');
    expect(desk).toContain("out={hover.out}");
    expect(desk).toContain("${hover.out ? ' out' : ''}"); // 앞 참모 별명 칩도 같이
    expect(desk).toContain('{ hot: [fanAt], hover: [badgeAt] }'); // 접히는 동안 받는 자리는 fan(펴짐) 기준 — 이미 배지로
    const out = css.match(/\.obb-fan\.out \.obb-fo \{[^}]*\}/)![0];
    expect(out).toContain('transform: translate(0, 0) !important;');
    expect(out).toMatch(/transition: transform \.18s/);
    expect(out).toContain('calc(var(--fo-back, 0) * 6ms)');
    expect(css).toMatch(/\.obb-fan\.out \{ pointer-events: none; \}/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.obb-fan\.out \.obb-fo \{ transition: none; \}/);
    const { BubbleFan } = await import('./BubbleFan');
    const o = (id: string) => ({ id, label: id, color: '#2f74e0', pip: null, small: null });
    const h = renderToStaticMarkup(createElement(BubbleFan, { orchs: [o('a'), o('b'), o('c')], front: 'a', cx: 0, cy: 0, side: { x: -1, y: -1 }, out: true, onPick: () => {}, onEnter: () => {}, onLeave: () => {} }));
    expect(h).toContain('class="obb-fan out"');
    expect(h).toContain('--fo-back:1'); // 바깥(뒤) 얼굴부터 접힌다
  });
  it('누를 때 부채를 접지 않는다(꾹 누르면 부채·누르는 순간 창 크기 바뀜 없음) — 누르고 놓으면 대화창, 5px 넘게 움직이면 끌기', () => {
    expect(desk).not.toMatch(/onPointerDown=\{\(e\) => \{ if \(e\.button === 0\) \{ hover\.close\(\)/);
    expect(desk).toContain('isDrag(e.screenX - p.x, e.screenY - p.y)');
    expect(desk).toMatch(/onClick=\{\(\) => \{ if \(!pressed\(\)\) void openPop\(!open\); \}\}/);
  });
  it('끄는 동안엔 제자리 확인(3초)·부채 크기 바꾸기·올림이 끼어들지 않는다 — 놓은 뒤 배지 상자 자리를 기억하고 배지로', () => {
    expect(desk).toContain('draggingRef.current = true;');
    expect(desk).toMatch(/setInterval\(\(\) => \{ if \(!draggingRef\.current && !openRef\.current/);
    expect(desk).toContain('const fan = hover.on && !dragging;');
    expect(desk).toContain('const b = { x: w0.x + frameRef.current.box.x, y: w0.y + frameRef.current.box.y };'); // 부채·배너·대화창 자리로 넓은 창을 끌어도 배지 상자 자리
  });
  it('받는 자리만 클릭을 받고 투명 여백은 바탕으로 — 배지 원·배너·대화창(열린 동안 배지도), 부채가 펴진 동안은 창 전체', () => {
    expect(desk).toContain("void invoke('bubble_hot', hits).catch(() => {});");
    expect(rust).toContain('w.set_ignore_cursor_events(pass)');
  });
  it('윈도우도 맥처럼 — 창·WebView2 바탕 투명(흰·검은 네모 없게), 커서를 읽어 원 밖 클릭을 뒤로(10-30 사용자 "윈도우에선 네모가 잡힘")', () => {
    // 맥은 panelize 가 창·웹뷰 바탕을 끈다. 윈도우는 tauri transparent 가 창(DWM)·WebView2 바탕(0,0,0,0)을 같이 끈다
    expect(rust).toMatch(/#\[cfg\(not\(target_os = "macos"\)\)\]\s*let b = b\.focusable\(false\)\.transparent\(true\);/);
    // 맥 커서(CGEvent)는 논리 점, 윈도우 GetCursorPos 는 물리 px — 창 배율로 나눠 rect_of 와 같은 단위로
    expect(rust).toContain('GetCursorPos(&mut pt)');
    expect(rust).toContain('phys_to_logical((pt.x, pt.y), k)');
    expect(rust).not.toContain('커서를 못 읽는 곳(윈도우)');
  });
});

describe('누가 누구인지 — 별명(10-28 사용자 "호버하면 이름 정도는(별명)")', () => {
  const desk = src('./DeskBubble.tsx');
  const fan = src('./BubbleFan.tsx');
  it('비활성 패널은 :hover 가 안 올 수 있어 Rust 가 창 안 마우스 자리를 넘기고, 화면이 그 자리 [data-hot] 에 hot 을 붙인다', () => {
    expect(rust).toContain('window.__bubbleMouse && window.__bubbleMouse(');
    expect(desk).toContain("document.elementFromPoint(x, y)?.closest('[data-hot]')");
    expect(desk).toContain("setTip(t && r ? { text: t, x: r.left + r.width / 2, y: r.bottom + 4 } : null);"); // 얼굴 줄은 가로 스크롤이라 잘린다 — 창 맨 위 층에 따로
    expect(desk).toContain('{open && tip && <span className="obd-tip"');
  });
  it('부채 얼굴은 올리면 별명(obb-fn), 대화창 머리 얼굴은 별명 툴팁, 머리엔 지금 상대 별명을 늘 글자로', () => {
    expect(fan).toContain('data-hot');
    expect(css).toMatch(/\.obb-fo\.hot \.obb-fn/);
    expect(desk).toMatch(/className=\{`obb-face[^`]*`\}[^>]*data-hot data-tip=\{nick\(o\.label\)\}/);
    expect(desk).toContain('<b className="obd-who">{nick(who.label)}</b>');
  });
  it('부채가 펴지면 앞 참모 별명 칩이 배지 옆(화면 가운데 쪽)에 — 별명은 이름 줄의 " · " 뒤', () => {
    expect(desk).toContain('const nick = (l: string) => shownName(l);');
    expect(desk).toMatch(/\{!open && fanShown && <span className=\{`obd-name/);
  });
});

describe('배너·부채·대화창이 떠 있을 때 창을 배지 크기로 덮지 않는다(10-28 사용자 "배너 오른쪽이 잘림·배지가 사라졌다 좀 기다리니 나타남")', () => {
  const desk = src('./DeskBubble.tsx');
  it('제자리 확인(toBadge 강제 아님)은 기다린 뒤에도 배너·부채·대화창·끌기 중이면 안 놓는다 — 배너 상태로 그린 배지가 88px 창 밖으로 밀려 사라졌다', () => {
    expect(desk).toMatch(/const s = await screensNow\(\);\n\s*if \(!force && \(openRef\.current \|\| peekRef\.current \|\| fanRef\.current \|\| draggingRef\.current \|\| openingRef\.current\)\) return;/);
  });
  it('다시 띄우기(앱 창 보임·bubbleDesk 켬)는 지금 모양 그대로 다시 놓는다 — 대화창은 안 닫고, 아니면 무대 창(배너·부채도 그 안)', () => {
    expect(desk).toContain('w.__bubbleShow = () => { void settle().then(() => invoke(\'bubble_reveal\')).catch(() => {}); };');
    expect(desk).toMatch(/const settle = async \(\) => \{\n\s*if \(openRef\.current \|\| openingRef\.current\) return;\n\s*await toBadge\(true\);/);
  });
});

describe('대화창 = 메인 참모 채팅과 같은 ChatView 그대로(10-28 사용자 "참모 챗 기본 기능·채팅 유아이도")', () => {
  const desk = src('./DeskBubble.tsx');
  const drop = src('../../../src-tauri/src/drop.rs');
  it('원격(remote) 모드가 아니다 — 슬래시·#참조·@멘션·그림 붙여넣기·멈춤 단추가 켜진다', () => {
    expect(desk).toMatch(/<ChatView key=\{who\.id\} sessionId=\{sid\}/);
    expect(desk).not.toMatch(/<ChatView[^>]*\bremote\b/);
  });
  it('터미널 손잡이는 그 세션에 키를 넣는 같은 길 — 멈춤 Esc·그림 Ctrl+V·선택지 키, 선택지 화면은 물을 때만 읽는다', () => {
    expect(desk).toContain("const stop = async () => {");
    expect(desk).toContain("pasteImage={() => void keys([imagePasteKey(IS_WIN)])}"); // 맥 Ctrl+V·윈도우 Alt+V(ux-daily H1)
    expect(desk).toContain('rawKeys={(seq) => keys(seq)}');
    expect(desk).toContain("screen={state === 'blocked' ? () => scr.current : undefined}");
    expect(desk).toContain("invoke<string>('bubble_screen', { id: chatId })");
    expect(rust).toContain('pub async fn bubble_keys(');
  });
  it('터미널 입력칸은 작은 버퍼로 — 끌어 놓은 경로·typeOnly 를 쌓았다가 보낼 때 앞에 붙인다(메인은 터미널 입력칸에 쌓인 뒤 Enter)', () => {
    expect(desk).toContain('pane.addEventListener(DROP_EVENT, onType);');
    expect(desk).toContain('const text = term.current + body;');
    expect(desk).toContain("clearTerminal={() => { term.current = ''; }}");
  });
  it('모델 칩·컨텍스트·음성 모드 — 메인과 같은 자료(read_ctx·voiceMode)와 같은 길(__appctl model-pick·voice)', () => {
    expect(desk).toContain('parseCtx(await readCtx([a.sessionId]))');
    expect(desk).toContain("invoke('bubble_appctl', { action: 'model-pick'");
    expect(desk).toContain("invoke('bubble_appctl', { action: 'voice'");
    expect(desk).toContain("readVoice()");
    expect(desk).toContain('<ChatVoice.Provider value={voiceCtl}>');
  });
  it('세션 상태는 메인과 같은 규칙(agentState) — 선택지 창(waiting)이면 물어봄이라 화면을 읽어 선택지를 띄운다', () => {
    expect(desk).toContain('setState(a ? agentState(a) : \'idle\');');
  });
  it('멈춘 뒤 Claude 가 입력칸에 되돌려 놓은 말은 세션 입력칸에서 지우고 대화창 입력칸으로(안 그러면 다음 말 앞에 붙는다)', () => {
    expect(desk).toMatch(/const stop = async \(\) => \{[\s\S]{0,500}promptInput\([\s\S]{0,300}keys\(\['\\x03'\]\)[\s\S]{0,200}CHAT_INSERT/);
    expect(desk).toContain('interrupt={() => void stop()}');
  });
  it('대화창 안 채팅 칸엔 메인 고른 칸 진한 테두리가 없다', () => {
    expect(css).toMatch(/\.obd-body \.pane, \.obd-body \.pane:focus-within \{ border-color: transparent; box-shadow: none;/);
  });
  it('파일을 끌어 놓으면 그 참모 대화창에 붙는다 — Rust 가 바탕 창으로 넘기고(main.rs 가드·drop.rs), 화면은 attachToChat', () => {
    expect(mainRs).toContain('window.label() == orch_bubble::LABEL || team_window::is_team_window');
    expect(drop).toContain('label == crate::orch_bubble::LABEL');
    expect(desk).toContain('if (e.type === \'drop\' && e.paths?.length && chatId) attachToChat(chatId, e.paths);');
    expect(desk).toContain('<div className="cell" data-session={chatId ?? undefined}>');
    expect(desk).toContain('<div className="pane headless" data-drop ref={paneRef}>');
  });
});

describe('바탕 배지 얼굴은 따로 합성 층이 아니다(10-28 사용자 363 — 원 둘레가 각진다)', () => {
  it('투명 웹킷 창에선 얼굴(.oa 44px) 합성 층이 고리 그림자를 네모로 비워 대각선에 모서리가 비쳤다 — 바탕 배지에선 will-change·isolation 을 끈다', () => {
    expect(css).toMatch(/html\.obd-root \.oa \{ will-change: auto; isolation: auto; \}/);
  });
  it('그래도 얼굴 안 움직이는 층(.oa-l)이 합성 층이라 고리보다 위면 대각선 네모가 남는다(사용자 18:30 "여전히 네모") — 고리는 얼굴 위 층, 새 답 점은 고리 위', () => {
    const z = (sel: RegExp) => Number(css.match(sel)![1]);
    const ring = z(/^\.obb-ring \{[^}]*z-index: calc\(var\(--z-base\) \+ (\d+)\)/m);
    expect(ring).toBeGreaterThan(0);
    expect(z(/^\.obb-dot \{[^}]*z-index: calc\(var\(--z-base\) \+ (\d+)\)/m)).toBeGreaterThan(ring);
  });
});

describe('고리와 흰 원 사이 틈 없음(10-28 사용자 "링과 참모 원형 사이 투명한 공간 없애줘")', () => {
  it('고리 안쪽 1px 이 흰 원 위에 겹친다 — 고리 안쪽 가장자리와 원 가장자리가 같은 자리면 둘 다 반투명이라 1배 화면에서 틈이 비쳤다(사용자 379, 진짜 창 8배)', () => {
    const r = css.match(/^\.obb-ring \{[^}]*\}/m)![0];
    const inset = Number(r.match(/inset: -(\d+)px/)![1]);
    const border = Number(r.match(/border: (\d+)px solid/)![1]);
    expect(inset).toBe(border - 1);
  });
});

describe('얼굴은 원 안에만, 고리는 정수 테두리 한 겹(10-28 21시 사용자 379 "외곽선 흐림·원 안 네모")', () => {
  const desk = src('./DeskBubble.tsx');
  const fan = src('./BubbleFan.tsx');
  it('배지·부채·대화창 머리 얼굴은 원으로 잘린 칸(obb-clip) 안 — 투명 웹킷 창에서 얼굴 층 네모가 원 밖으로 안 나온다', () => {
    expect(css).toMatch(/\.obb-clip \{[^}]*position: absolute; inset: 0;[^}]*border-radius: 50%; overflow: hidden;/);
    expect(fan).toContain('<span key={face.id} className="obb-facein obb-clip">{node}</span>');
    expect(fan).toMatch(/className="obb-fo"[^]*?<span className="obb-clip">\{o\.small\}<\/span>/);
    expect(desk).toContain('<span className="obb-clip">{avatar(o, 28)}</span>');
    expect(bubble).toContain('<span className="obb-clip">{o.small}</span>');
  });
  it('머리 고른 얼굴 고리 = 정수 테두리 한 겹 — 흰 2px + 색 3.5px 퍼짐 그림자 두 겹은 안쪽 가장자리가 겹쳐 흐린 안쪽 원이 하나 더 보였다', () => {
    expect(css).not.toMatch(/\.obb-face\.on \{[^}]*box-shadow/);
    const on = css.match(/\.obb-face\.on::after \{[^}]*\}/)![0];
    expect(on).toMatch(/inset: -\d+px;[^}]*border: 2px solid var\(--orch-solid, var\(--text\)\); border-radius: 50%;/);
    expect(css.match(/^\.obb-face[^{]*\{[^}]*\}/gm)!.join('')).not.toMatch(/\d\.\d+px/);
  });
  it('머리 얼굴이 정수 픽셀 자리 — 머리 44(아래 선 1) 안 가운데, 얼굴 줄 위아래 여백 합이 홀수면 y = 5.5 로 고리가 번졌다', () => {
    const head = Number(css.match(/\.obb-float > \.obb-head \{[^}]*height: (\d+)px/)![1]);
    const m = css.match(/\.obb-faces \{[^}]*padding: (\d+)px \d+px (\d+)px/)!;
    expect(((head - 1) - (32 + Number(m[1]) + Number(m[2]))) % 2).toBe(0);
  });
  it('부채 얼굴 둘레는 테두리 — 퍼짐 그림자 1px 는 단추 가장자리와 겹쳐 흐렸다', () => {
    const fo = css.match(/^\.obb-fo \{[^}]*\}/m)![0];
    expect(fo).toMatch(/border: 1px solid var\(--line\)/);
    expect(fo).not.toMatch(/0 0 0 1px/);
  });
});

describe('대화창 크기를 사람이 끌어 바꾼다(10-28 사용자 "늘렸다 줄였다")', () => {
  const desk = src('./DeskBubble.tsx');
  it('배지 반대쪽 두 변·모서리에 손잡이 — 끄는 동안 맥 창을 그 크기로 다시 놓고, 놓으면 보통 크기로 기억', () => {
    expect(desk).toContain('const far = farEdges(frame.origin, pop);');
    expect(desk).toMatch(/className=\{`obd-grip g-\$\{g\}/);
    expect(desk).toContain('resizedPop(d.size, e.screenX - d.x, e.screenY - d.y, d.far, d.axis)');
    expect(desk).toContain("write(SIZE_KEY, JSON.stringify(sizeRef.current));");
    expect(desk).toContain('const f = frameAt(b, s.screens, isBig);');
  });
  it("'크게' 는 화면 높이 꽉 찬 따로 모드(기억 안 함) — 손으로 끌기 시작하면 크게 모드는 풀린다", () => {
    expect(desk).toMatch(/onPointerDown=\{\(e\) => void startGrip\(e, g\)\}/);
    expect(desk).toMatch(/const startGrip = async[\s\S]{0,600}setBig\(false\)/);
    expect(css).toMatch(/\.obd-grip\.g-xy\.left\.top[^{]*\{ cursor: nwse-resize; \}/);
  });
});

describe('v3 N 모양(BubbleFan) — 사용자 10-28 "이게 맞는 듯"', () => {
  const o = (id: string, pip: 'ask' | 'new' | 'run' | 'rest' | null) => ({ id, label: id, color: '#2f74e0', pip, small: createElement('i', null, id) });
  it('배지 안 = 테두리(얼굴 참모 상태 색) + 얼굴 + 숫자 알약(물어봄·일함, 쉼은 안 셈)', async () => {
    const { BadgeCore } = await import('./BubbleFan');
    const list = [o('a', 'ask'), o('b', 'run'), o('c', 'run'), o('d', 'rest')];
    const h = renderToStaticMarkup(createElement(BadgeCore, { face: list[0]!, node: createElement('b', null, '얼굴'), orchs: list }));
    expect(h).toContain('class="obb-ring r-ask"');
    expect(h).toContain('<span class="obb-cnt c-ask"><i></i>1</span>');
    expect(h).toContain('<span class="obb-cnt"><i></i>2</span>');
  });
  it('아무도 안 묻고 안 일하면 숫자 알약 없음', async () => {
    const { BadgeCore } = await import('./BubbleFan');
    const list = [o('a', 'rest'), o('b', null)];
    expect(renderToStaticMarkup(createElement(BadgeCore, { face: list[0]!, node: null, orchs: list }))).not.toContain('obb-counts');
  });
  it('부채 = 13명이면 6명 + "+6"(얼굴 참모 빼고), 이름은 올릴 때만(obb-fn)', async () => {
    const { BubbleFan } = await import('./BubbleFan');
    const list = Array.from({ length: 13 }, (_, i) => o(`p${i}`, i % 2 ? 'run' : 'rest'));
    const h = renderToStaticMarkup(createElement(BubbleFan, { orchs: list, front: 'p0', cx: 100, cy: 100, side: { x: -1, y: -1 }, onPick: () => {}, onEnter: () => {}, onLeave: () => {} }));
    expect((h.match(/class="obb-fo"/g) ?? []).length).toBe(6);
    expect(h).toContain('>+6</button>');
    expect(css).toMatch(/\.obb-fo:hover \.obb-fn, \.obb-fo:focus-visible \.obb-fn \{ opacity: 1; \}/);
  });
  it('물결은 합성기가 돌린다 — 프레임마다 칠하는 속성을 안 움직인다(11-07 작은 창 하나가 웹 9%·GPU 18%)', async () => {
    const kf = css.match(/@keyframes obb-wave \{[\s\S]*?\n/)![0];
    expect(kf).toMatch(/transform: scale\(1\)/);
    expect(kf).not.toMatch(/box-shadow|border|width|height|inset|background/);
    expect(css).toMatch(/\.obb-ring \{[^}]*box-shadow: var\(--obb-drop\)/); // 떨어지는 그림자는 그대로 고리에
    expect(css).not.toMatch(/\.obb-ring\.r-ask \{[^}]*animation/);
    const { BadgeCore } = await import('./BubbleFan');
    const one = (pip: 'ask' | 'run') => renderToStaticMarkup(createElement(BadgeCore, { face: o('a', pip), node: null, orchs: [o('a', pip)] }));
    expect(one('ask')).toContain('class="obb-wave"');
    expect(one('run')).not.toContain('obb-wave');
  });
  it('물결 크기는 고리 바깥 28px → 40px — 예전 0→12px 퍼짐과 같다, 흰 원은 얼굴 칸이 맡아 물결이 얼굴 뒤로 간다', () => {
    const inset = Number(css.match(/^\.obb-wave \{[^}]*inset: -(\d+)px/m)![1]);
    const scale = Number(css.match(/@keyframes obb-wave[^\n]*scale\(1\.(\d+)\)/)![1]) / 1e4 + 1;
    expect(Math.round((26 + inset) * (scale - 1))).toBe(12);
    expect(css).toMatch(/\.obb-badge > \.obb-clip \{ background: var\(--surface\); \}/);
  });
  it('바탕 배지 물결은 창 포커스로 안 멈추고 자리 비움으로만 멈춘다 — 다른 앱 쓰는 중에도 물어봄을 알려야 한다', () => {
    expect(css).toMatch(/html\.obd-root:not\(\.obd-away\):not\(\.oa-calm\) \.obb-wave \{ animation-play-state: running !important; \}/);
    expect(css).toMatch(/html\.obd-root\.obd-away \.obb-wave \{ animation-play-state: paused !important; \}/);
  });
  it('묻는 참모 테두리 물결은 멈춤 목록에, 바탕 배지가 그린다', () => {
    expect(paused).toContain('.obb-wave');
    expect(src('./DeskBubble.tsx')).toContain('<BadgeCore face={me} node={avatar(who, 44)} orchs={fanOrchs} />');
  });
});

describe('열린 동안 배지를 끌면 대화창째 옮긴다(10-31 사용자 "대화창 떠 있을 때 배지가 손 모양인데 안 끌림")', () => {
  const desk = src('./DeskBubble.tsx');
  const badge = desk.slice(desk.indexOf('obb-badge obd-badge${dragging'), desk.indexOf('<BadgeCore face={me}'));
  it('열린 배지도 닫힌 배지와 같은 누르기 길(같은 요소) — 5px 넘게 움직이면 창 끌기, 짧게 누르면 열기·접기', () => {
    expect(badge).toContain('onPointerDown={grab}');
    expect(badge).toContain('onPointerMove={drag}');
    expect(badge).toMatch(/onClick=\{\(\) => \{ if \(!pressed\(\)\) void openPop\(!open\); \}\}/);
    expect(desk).toMatch(/const drag = \(e: React\.PointerEvent\) => \{[\s\S]{0,200}isDrag\(e\.screenX - p\.x, e\.screenY - p\.y\)[\s\S]{0,400}startDrag\(\);/);
  });
  it('끌기를 시작하면 걸려 있던 놓음 처리(옮김 사건 0.3초 뒤)를 지운다 — 부채가 펴진 창 크기 사건이 끄는 도중 판을 다시 놓았다(11-11 실측 40px)', () => {
    expect(desk).toContain("const startDrag = () => { window.clearTimeout(movedT.current); draggedRef.current = true; void invoke('bubble_drag'); };");
    expect(desk).toMatch(/w\.__bubbleMoved = \(\) => \{\s*window\.clearTimeout\(movedT\.current\);\s*movedT\.current = window\.setTimeout\(/);
  });
  it('놓으면 열린 창이 배지 화면 밖으로 나간 만큼 통째로 당기고(openKeep), 당긴 자리로 배지 자리를 기억', () => {
    expect(desk).toContain('const to = openRef.current ? openKeep(s.win, frameRef.current.box, s.screens, DESK) : null;');
    expect(desk).toContain("if (to) await place({ ...s.win, ...to }, true, 0, viewOf(frameRef.current, 'open'));");
    expect(desk).toContain('const w0 = to ? { ...s.win, ...to } : s.win;');
  });
  it('커서 — 끌 수 있는 배지는 손(grab), 끄는 중엔 잡은 손(grabbing)', () => {
    expect(css).toMatch(/\.obb-badge \{[^}]*cursor: grab;/);
    expect(css).toContain('.obb-badge.obb-drag { cursor: grabbing; }');
    expect(desk).toContain("${dragging ? ' obb-drag' : ''}");
  });
  it('윈도우 — 열린 동안 받는 자리(hot)에 배지 원이 들어 있어 원 위 누름이 창에 온다(밖은 바탕으로)', () => {
    expect(desk).toContain('const badgeAt: [number, number, number, number] = [P + off.x, P + off.y, 52, 52];');
    expect(desk).toContain('{ hot: [...(pop ? [[pop.x, pop.y, pop.w, pop.h]] : []), ...(frame.badge ? [badgeAt] : [])], hover: [] }');
    expect(badge).toContain('style={{ left: off.x, top: off.y,');
  });
});

describe('바탕 배지 창 크기 = 판의 보일 칸(11-10 사용자 "참모 배지가 항상 이 정도 영역을 차지 … 크기가 변해야 하는 거 아님?")', () => {
  const desk = src('./DeskBubble.tsx');
  it('놓을 때마다 판과 함께 지금 보일 칸을 넘긴다 — 배지만이면 배지 칸, 부채·배너는 무대, 대화창은 판 전체', () => {
    expect(desk).toContain("const mode: DeskMode = open ? 'open' : (fanShown || peek) && !dragging ? 'stage' : 'rest';");
    expect(desk).toContain("invoke('bubble_place', { x: r.x, y: r.y, w: r.w, h: r.h, key, radius, view: [view.x, view.y, view.w, view.h] })");
    expect(desk).toMatch(/useLayoutEffect\(\(\) => \{ if \(frame\.win\.w > 0 && !open && !openingRef\.current\) void invoke\('bubble_view'/);
    expect(desk.match(/await place\(|void place\(/g)?.length).toBe(desk.match(/place\([^;]*viewOf\(/g)?.length); // 칸 없이 놓는 곳이 없다
  });
  it('Rust: 맥은 창 = 보일 칸, 웹뷰 = 판 크기 그대로 칸만큼 비켜 — 둘을 한 화면 갱신에(웹 그림을 다시 안 그려 배지가 안 튄다)', () => {
    expect(rust).toContain('disableScreenUpdatesUntilFlush');
    expect(rust).toContain('setAutoresizingMask: 0usize');
    // 창 위로 삐져나간 웹뷰를 웹킷이 '가려진 위 여백'으로 잡으면 화면 높이가 108 로 줄어 배지가 화면 밖(실측) — 자동 여백 끄기
    expect(rust).toContain('_setAutomaticallyAdjustsContentInsets: Bool::NO');
    expect(rust).toContain('setObscuredContentInsets: objc2_foundation::NSEdgeInsets { top: 0.0, left: 0.0, bottom: 0.0, right: 0.0 }');
    expect(rust).toMatch(/setFrame: r\(a\), display: false\];\s*let _: \(\) = msg_send!\[web, setFrame: r\(b\)\];/);
    expect(mainRs).toContain('orch_bubble::bubble_view,');
  });
  it('Rust: 화면이 받는 창 자리·마우스 자리는 판 기준(받는 자리·올림 자리가 판 기준)', () => {
    expect(rust).toContain('win: rect_of(&window).map(|r| plate_of(&r, shape()))');
    expect(rust).toContain('let p = local(m, &win).map(|_| (m.0 - plate.x, m.1 - plate.y));');
  });
  it('배너·별명은 살짝 나타난다 — 창이 커지는 한 박자 동안 잘린 그림이 안 보이게', () => {
    expect(css).toMatch(/\.obd-peek \{[^}]*animation: obd-in/);
    expect(css).toMatch(/\.obd-name \{[^}]*animation: obd-in/);
    expect(css).toMatch(/@keyframes obd-in \{ from \{ opacity: 0; \} \}/);
  });
});
