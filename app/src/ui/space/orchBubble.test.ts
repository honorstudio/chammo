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
    expect(paused).toContain('.obb-ring.r-ask');
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
    expect(desk).toContain('{ x: s.win.x + boxOffRef.current.x, y: s.win.y + boxOffRef.current.y, w: DESK, h: DESK }');
    expect(desk).toContain('openingRef.current = true;');
  });
  it('올림·뺌·배너는 창 크기·자리를 안 바꾼다 — 창은 늘 무대 크기, 바뀌는 건 웹뷰 안 그림뿐(10-28 사용자 "호버하면 깜빡이면서 잠깐 위치가 바뀜", 실측 올림 6번 중 4번 -150px 튐·뺌 1번 사라짐)', () => {
    expect(desk).toContain('deskStage(');
    expect(desk).not.toMatch(/w: DESK \+ FAN, h: DESK \+ FAN/); // 부채만큼 창을 키우던 것
    expect(desk).not.toContain('placePeek'); // 배너만큼 창을 키우던 것
    const fanFx = desk.slice(desk.indexOf('// 부채 —'), desk.indexOf('const press = useRef'));
    expect(fanFx).not.toMatch(/placeBox|toBadge|place\(/);
    expect(desk).not.toMatch(/useEffect\(\(\) => \{[^\n]*peek[^\n]*toBadge/);
  });
  it('무대 쪽이 바뀌어 창 자리와 웹뷰 안 배지 자리가 같이 바뀔 땐 배지를 감춘 채 옮기고 다 그린 뒤 보인다(한 프레임 어긋남이 안 보이게)', () => {
    expect(desk).toMatch(/if \(flip\) \{ setHide\(true\); await paint\(\); \}[\s\S]{0,200}await place\(st\.win, false, 0\);[\s\S]{0,120}setSide\(st\.side\);[\s\S]{0,120}if \(flip\) \{ await paint\(\); setHide\(false\); \}/);
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
    expect(desk).toContain('deskPop({ x: b.x, y: b.y, w: DESK, h: DESK }, s.screens, sizeRef.current, isBig)');
  });
});

describe('대화창 톡 열림·닫힘(10-28 사용자 "눌러서 채팅하는 작은 창 애니메이션으로 팝업")', () => {
  const desk = src('./DeskBubble.tsx');
  it('열 때: 접힌 대화창(from)을 먼저 그리고 창을 대화창 크기로 키운 뒤 펼친다(in) — 맥 창 크기 바뀌는 순간을 가린다', () => {
    expect(desk).toMatch(/setAnim\('from'\)[\s\S]{0,400}await place\(l\.win, true, l\.badge \? 0 : 14\)[\s\S]{0,200}setAnim\('in'\)/);
  });
  it('이미 열린 대화창의 키우기·참모 바꾸기는 다시 톡 하지 않는다', () => {
    expect(desk).toContain('const grow = !openRef.current;');
  });
  it('닫을 때: 배지 쪽으로 접고(out) 안 보이게(gone) 한 뒤 창을 배지로, 그다음 배지 — 큰 창에 배지가 한 번 튀지 않게', () => {
    expect(desk).toMatch(/setAnim\('out'\)[\s\S]{0,300}POP_MS\.close[\s\S]{0,300}setAnim\('gone'\)[\s\S]{0,300}await toBadge\(true\)[\s\S]{0,200}setOpen\(false\)/);
  });
  it('자라 나오는 점은 배지 가운데(popOrigin) — 부채·배너에서 열어도 같은 openPop 한 길', () => {
    expect(desk).toContain('popLayout(b, { x: b.x + BX, y: b.y + BY, w: 52, h: 52 }, r)');
    expect(desk).toMatch(/onPick=\{\(id\) => \{[^}]*openPop\(true, big, id\)/);
    expect(desk).toContain('transformOrigin: `${lay.origin.x}px ${lay.origin.y}px`');
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
    const wave = num(/100% \{ box-shadow: var\(--obb-drop\), 0 0 0 (\d+)px transparent/, css);
    const dy = num(/^\.obb-ring \{ --obb-drop: 0 (\d+)px \d+px rgba/m, css), blur = num(/^\.obb-ring \{ --obb-drop: 0 \d+px (\d+)px rgba/m, css);
    const pad = num(/export const DESK_PAD = (\d+);/, dom);
    const [box, bx, by] = [num(/const DESK = (\d+);/, desk), num(/const BX = (\d+)/, desk), num(/BY = (\d+);/, desk)];
    const reach = { top: ring + Math.max(wave, blur - dy), side: ring + Math.max(wave, blur), bottom: ring + Math.max(wave, blur + dy) };
    expect(by + pad).toBeGreaterThan(reach.top);
    expect(bx + pad).toBeGreaterThan(reach.side);
    expect(box - bx - 52 + pad).toBeGreaterThan(reach.side);
    expect(box - by - 52 + pad).toBeGreaterThan(reach.bottom);
  });
  it('배지·부채·배너 창(무대)은 상자에 여백·펼칠 자리를 더해 놓고(deskStage), 읽을 땐 무대 안 상자 자리로 — 놓는 자리·작업 영역 당김·누름은 배지 상자 기준 그대로', () => {
    expect(desk).toContain('const st = deskStage({ x: p.x, y: p.y, w: DESK, h: DESK }, s.screens, EXT);');
    expect(desk).toContain('const boxOff = stageBox(side, EXT);');
    expect(desk).not.toMatch(/place\(\{ x: (p|side)\./); // 상자 창을 맨 place 로 놓지 않는다
    expect(desk).toContain("<div className={`obd-wrap${hide ? ' hide' : ''}`} style={{ inset: DESK_PAD }}");
    expect(desk).toMatch(/await place\(l\.win, true, l\.badge \? 0 : 14\)/); // 대화창 창은 popLayout 그대로(배지 상자 여백은 그 안에)
  });
});

describe('열린 동안 배지는 제자리, 대화창은 끌어 옮긴다(10-28 사용자 "최소화할 때 위치가 불분명·채팅창 이동 불가")', () => {
  const desk = src('./DeskBubble.tsx');
  it('열린 대화창 옆에 배지가 남고, 누르면 접힌다', () => {
    expect(desk).toContain('{lay.badge && (');
    expect(desk).toMatch(/aria-label=\{tr\(`\$\{who\.label\} 대화창 접기`[\s\S]{0,300}onClick=\{\(\) => void openPop\(false\)\}/);
    expect(css).toMatch(/\.obd-open\.a-from \.obd-wrap, \.obd-open\.a-gone \.obd-wrap \{ visibility: hidden; \}/); // 창 크기가 바뀌는 동안은 안 보이게
  });
  it('대화창 머리 빈 곳을 끌면 맥 창 끌기(단추 위는 아님) — 놓으면 같이 옮겨진 배지 자리를 기억', () => {
    expect(desk).toMatch(/className="obb-head obd-head"[^>]*onPointerDown=\{\(e\) => \{ if \(e\.button === 0 && !\(e\.target as Element\)\.closest\('button'\)\) \{ draggedRef\.current = true; void invoke\('bubble_drag'\)/);
    expect(desk).toContain('const b = openRef.current ? { x: s.win.x + layRef.current.box.x, y: s.win.y + layRef.current.box.y } : { x: s.win.x + boxOffRef.current.x, y: s.win.y + boxOffRef.current.y };');
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
    expect(desk).toContain('{fanShown && <BubbleFan');
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
    expect(desk).toMatch(/onClick=\{\(\) => \{ const p = press\.current; press\.current = null; if \(!p\?\.dragged\) void openPop\(true\); \}\}/);
  });
  it('끄는 동안엔 제자리 확인(3초)·부채 크기 바꾸기·올림이 끼어들지 않는다 — 놓은 뒤 배지 상자 자리를 기억하고 배지로', () => {
    expect(desk).toContain('draggingRef.current = true;');
    expect(desk).toMatch(/setInterval\(\(\) => \{ if \(!draggingRef\.current && !openRef\.current/);
    expect(desk).toContain('const fan = hover.on && !dragging;');
    expect(desk).toContain(': { x: s.win.x + boxOffRef.current.x, y: s.win.y + boxOffRef.current.y };'); // 부채·배너로 넓은 창을 끌어도 배지 상자 자리
  });
  it('받는 자리만 클릭을 받고 투명 여백은 바탕으로 — 배지 원·배너·대화창(열린 동안 배지도), 부채가 펴진 동안은 창 전체', () => {
    expect(desk).toContain("void invoke('bubble_hot', hits).catch(() => {});");
    expect(rust).toContain('w.set_ignore_cursor_events(pass)');
  });
});

describe('누가 누구인지 — 별명(10-28 사용자 "호버하면 이름 정도는(별명)")', () => {
  const desk = src('./DeskBubble.tsx');
  const fan = src('./BubbleFan.tsx');
  it('비활성 패널은 :hover 가 안 올 수 있어 Rust 가 창 안 마우스 자리를 넘기고, 화면이 그 자리 [data-hot] 에 hot 을 붙인다', () => {
    expect(rust).toContain('window.__bubbleMouse && window.__bubbleMouse(');
    expect(desk).toContain("document.elementFromPoint(x, y)?.closest('[data-hot]')");
    expect(desk).toContain("setTip(t && r ? { text: t, x: r.left + r.width / 2, y: r.bottom + 4 } : null);"); // 얼굴 줄은 가로 스크롤이라 잘린다 — 창 맨 위 층에 따로
    expect(desk).toContain('{tip && <span className="obd-tip"');
  });
  it('부채 얼굴은 올리면 별명(obb-fn), 대화창 머리 얼굴은 별명 툴팁, 머리엔 지금 상대 별명을 늘 글자로', () => {
    expect(fan).toContain('data-hot');
    expect(css).toMatch(/\.obb-fo\.hot \.obb-fn/);
    expect(desk).toMatch(/className=\{`obb-face[^`]*`\}[^>]*data-hot data-tip=\{nick\(o\.label\)\}/);
    expect(desk).toContain('<b className="obd-who">{nick(who.label)}</b>');
  });
  it('부채가 펴지면 앞 참모 별명 칩이 배지 옆(화면 가운데 쪽)에 — 별명은 이름 줄의 " · " 뒤', () => {
    expect(desk).toContain('const nick = (l: string) => shownName(l);');
    expect(desk).toMatch(/\{fanShown && <span className=\{`obd-name/);
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
    expect(desk).toContain("pasteImage={() => void keys(['\\x16'])}");
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
    expect(desk).toContain('setCtxs(parseCtx(await readCtx()))');
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
    expect(desk).toContain('const far = farEdges(lay.origin, lay.pop);');
    expect(desk).toMatch(/className=\{`obd-grip g-\$\{g\}/);
    expect(desk).toContain('resizedPop(d.size, e.screenX - d.x, e.screenY - d.y, d.far, d.axis)');
    expect(desk).toContain("write(SIZE_KEY, JSON.stringify(sizeRef.current));");
    expect(desk).toContain('deskPop({ x: b.x, y: b.y, w: DESK, h: DESK }, s.screens, sizeRef.current, isBig)');
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
  it('묻는 참모 테두리 물결은 멈춤 목록에, 바탕 배지가 그린다', () => {
    expect(paused).toContain('.obb-ring.r-ask');
    expect(src('./DeskBubble.tsx')).toContain('<BadgeCore face={me} node={avatar(who, 44)} orchs={fanOrchs} />');
  });
});
