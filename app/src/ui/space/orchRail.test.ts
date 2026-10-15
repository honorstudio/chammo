import { describe, expect, it } from 'vitest';
import grid from '../SessionGrid.tsx?raw';
import rail from './OrchRail.tsx?raw';
import lockerCss from './locker.css?raw';
import icons from '../Icons.tsx?raw';
import view from './SpaceView.tsx?raw';
import app from '../../App.tsx?raw';

// 2026-10-11 사용자(178.png): 채팅 칸 위 참모 탭 줄을 뺀다 — 참모 바꾸기는 왼쪽 프사 띠가 한다.
// 탭 줄에만 있던 기능(고르기·끌어 순서 바꾸기·두 번 눌러 이름·오른쪽 메뉴의 고정·프로필·끄기·말하는 빛·⌘ 번호 안내)은 프사 띠로 옮긴다
describe('참모 탭 줄 → 프사 띠', () => {
  it('채팅 칸(SessionGrid)엔 참모 탭 줄이 없다', () => {
    expect(grid).not.toMatch(/ChatTabStrip/);
    expect(grid).not.toMatch(/role="tab"/);
  });
  it('프사 띠가 탭 줄 기능을 다 갖는다', () => {
    expect(rail).toMatch(/onContextMenu=/); // 고정·이름·프로필·끄기·지우기 메뉴
    expect(rail).toMatch(/onDoubleClick=/); // 이름·맡은 일
    expect(rail).toMatch(/onPointerDown=/); // 끌어 순서 바꾸기
    expect(rail).toMatch(/speakGlowRef/); // 말하는 참모 빛
    expect(rail).toMatch(/⌘\$\{i \+ 1\}/); // ⌘1~9 안내
  });
  // 179.png — 프사 띠 아래 빈 곳에 + : 새 참모(⌘⇧T 와 같은 창·이름·맡은 일 흐름)
  it('프사 바로 아래 새 참모 + — 직접 그린 아이콘, 이름은 aria-label·호버 카드', () => {
    const plus = rail.slice(rail.indexOf('{avatars.map('), rail.indexOf('<span className="lk-sp" />'));
    expect(plus).toMatch(/onNew && <IconButton size="l" className="rail-new" label=\{tr\(`\$\{assistant\(\)\} 하나 더`/);
    expect(plus).toMatch(/data-tip=\{tr\(`\$\{assistant\(\)\} 하나 더`[\s\S]*?data-tip-key=\{keyLabel\('⌘⇧T', IS_WIN\)\}/); // 2026-10-12 기본 title 대신 띠 호버 카드
    expect(plus).toMatch(/<IconPlus \/>/);
  });
  // 2026-10-11 사용자(182·183.png): 둘째 세로줄을 없애고 기능 아이콘은 프사 띠 맨 아래 빈 곳에 — 한 줄 띠, 위는 프사·+, 아래 끝에 기능
  it('기능 아이콘은 띠(nav) 안 빈 자리 아래 — 띠 밖 둘째 줄이 없다', () => {
    const strip = rail.slice(rail.indexOf('<nav ref={navRef} className={`lk-strip'), rail.indexOf('</nav>'));
    expect(strip.indexOf('{fns}')).toBeGreaterThan(strip.indexOf('<span className="lk-sp" />'));
    expect(rail.slice(rail.indexOf('</nav>'))).not.toMatch(/\{fns\}/);
    expect(lockerCss.length).toBeGreaterThan(0);
    expect(lockerCss).not.toMatch(/\.rail-fns\.col\s*\{[^}]*border-right/);
  });
});

// 2026-10-12 패널 하나로 P2·P3·P4 — 옛 펼친 메뉴의 세 덩어리가 띠 안으로
describe('띠 — 도우미 묶음 · 쉬는 참모 · 예약', () => {
  const strip = rail.slice(rail.indexOf('<nav ref={navRef} className={`lk-strip'), rail.lastIndexOf('</nav>'));
  it('도우미는 묶음 프사 하나(숫자) — 누르면 목록', () => {
    expect(strip).toMatch(/className="lk-av grp"[^>]*onClick=\{group\.onOpen\}/);
    expect(strip).toMatch(/<IconPeople \/>/);
    expect(strip).toMatch(/\{group\.count\}/);
  });
  it('쉬는 참모는 빈 자리 아래 흐린 프사 — 누르면 깨움, 오른쪽 메뉴', () => {
    expect(strip.indexOf('resting.map(')).toBeGreaterThan(strip.indexOf('<span className="lk-sp" />'));
    expect(strip).toMatch(/className="lk-av rest"[\s\S]*onClick=\{\(\) => wake\(r\)\}/); // wake = pointerup·click 중복 한 번(domain/railWake)
    expect(rail).toMatch(/if \(w\.wake\) r\.onWake\(\)/);
  });
  it('예약은 기능 줄 시계 — 이름은 aria-label·title, 켜짐 표시', () => {
    expect(rail).toMatch(/aria-label=\{tr\('예약', 'Scheduled'\)\}[^>]*><IconCalendarClock \/>/); // 기록(되감기 시계)과 덜 닮게 달력+시계(207.png)
    expect(rail).toMatch(/sched\.on \? 'on'/);
    expect(strip).toMatch(/\{schedBtn\}/);
  });
  it('도우미 아이콘은 직접 그린 SVG', () => expect(icons).toMatch(/export const IconPeople = \(\) => \(\s*<svg viewBox="0 0 16 16" \{\.\.\.P\}>/));
});

// 2026-10-12 패널 하나로 P1 A — ⌘B 는 다른 화면(옛 메뉴 SpaceNav)으로 바꾸지 않고 같은 띠를 넓힌다: 프사 + 이름 + 맡은 일,
// 도우미 묶음 한 줄, 아래 쉬는 참모, 맨 아래 기능 줄 가로. 나무(보관함 폴더)는 접힘·펼침 둘 다 옆에
describe('펼친 패널 A — 같은 띠를 넓게', () => {
  it('넓을 땐 프사 옆에 이름과 맡은 일', () => {
    expect(rail).toMatch(/className=\{`lk-strip \$\{wide \? 'wide' : ''\}/);
    // 켜는 중·끄는 중이면 맡은 일 자리에 그 단계 글(2026-10-12 rail-wake)
    expect(rail).toMatch(/wide && <span className="lk-av-tx"><b>\{a\.label\}<\/b>\{\(a\.phaseText \?\? a\.role\) && <span[^>]*>\{a\.phaseText \?\? a\.role\}<\/span>\}<\/span>/);
  });
  it('넓을 땐 기능 줄이 맨 아래 가로 한 줄(예약·기능 — 접기는 따로 맨 위)', () => expect(rail).toMatch(/wide \? <div className="lk-foot">\{schedBtn\}\{fns\}<\/div>/));
  it('스페이스는 옛 메뉴(SpaceNav)를 안 그리고 늘 띠 + 나무', () => {
    expect(view).not.toMatch(/<SpaceNav /);
    expect(view).toMatch(/\{rail\}/); // 2026-10-12 나무 칸은 없앴다(treeGone.test)
  });
});

// 2026-10-12 사용자(참모-2 전달) "쉬는 참모를 불러올 방법이 없다" — 띠 흐린 프사 = 깨우기, 깨우면 떠오를 때 그 참모(채팅 탭까지)로 간다
// (오케스트레이터 홈의 깨우기와 같은 길 resumeFromHome — 이어서 켜기만 하던 onResume 은 그 참모로 안 갔다)
describe('쉬는 참모 깨우기 → 그 참모로', () => {
  it('앱은 띠 깨우기에 홈과 같은 길(resumeFromHome)을 넘긴다', () => expect(app).toMatch(/onWakeOrch=\{resumeFromHome\}/));
  it('띠 흐린 프사 = onWakeOrch(없으면 onResume)', () => expect(view).toMatch(/onWake: \(\) => \(onWakeOrch \?\? onResume\)\?\.\(x\)/));
});

// 191.png — 펼친 띠는 정해진 폭(맡은 일 글이 길어도 안 늘어남) + 오른쪽 손잡이, 이름·맡은 일은 한 줄 말줄임
describe('펼친 띠 폭', () => {
  it('폭은 밖에서 받은 값으로 고정 — 내용 폭으로 안 늘어난다', () => {
    expect(rail).toMatch(/style=\{wide \? \{ width, flexBasis: width \} : undefined\}/);
    expect(lockerCss).toMatch(/\.lk-strip\.wide \{[^}]*min-width: 0;[^}]*overflow: hidden;/);
  });
  it('오른쪽 가장자리 손잡이(Grip side right)', () => expect(rail).toMatch(/wide && onWidth && <Grip side="right" width=\{width\} onWidth=\{onWidth\} min=\{200\} max=\{360\} \/>/));
  it('이름·맡은 일은 한 줄 말줄임', () => expect(lockerCss).toMatch(/\.lk-av-tx b \{[^}]*text-overflow: ellipsis;/));
});

// 2026-10-12 사용자(206.png): 접힌 띠 '›' 가 창 왼쪽 아래 둥근 모서리에 걸쳤다 — 보관함 옛 접기 줄 .lk-fold(폭 100%·왼쪽 붙음)와 이름이 겹친 탓
describe('띠 펼치기·접기 단추 자리', () => {
  it('띠 단추는 자기 이름(rail-fold) — 다른 화면 규칙이 안 걸린다', () => {
    expect(rail).toMatch(/className="rail-fold"/);
    expect(rail).not.toMatch(/className="lk-fold"/);
    expect(lockerCss).not.toMatch(/\.lk-fold\s*\{[^}]*width: 100%/);
  });
  // 같은 날 207.png: 접기가 기능 아이콘 사이에 끼어 이상하다 → 기능 줄에서 빼서 띠 맨 위(펼침 = 오른쪽, 접힘 = 가운데). 창 모서리와도 멀다
  it('접기·펼치기는 띠 맨 위 따로 — 펼침은 오른쪽 끝, 접힘은 가운데', () => {
    expect(rail).toMatch(/<div className="rail-top">\{fold\}<\/div>/);
    expect(rail.indexOf('<div className="rail-top">')).toBeLessThan(rail.indexOf('{avatars.map('));
    expect(lockerCss).toMatch(/\.rail-top \{[^}]*justify-content: center;/);
    expect(lockerCss).toMatch(/\.lk-strip\.wide \.rail-top \{[^}]*justify-content: flex-end;/);
  });
  it('펼친 기능 줄은 고른 간격 — 같은 칸 크기(격자 1fr), 기능 묶음은 풀어서 한 줄', () => {
    expect(lockerCss).toMatch(/\.lk-foot \{[^}]*display: grid;[^}]*grid-auto-flow: column;[^}]*grid-auto-columns: 1fr;[^}]*justify-items: center;/);
    expect(lockerCss).toMatch(/\.lk-foot > \.rail-fns \{ display: contents; \}/);
  });
  it('예약 아이콘(달력+시계)은 기록 아이콘과 다른 직접 그린 SVG', () => {
    expect(icons).toMatch(/export const IconCalendarClock = \(\) => \(\s*<svg viewBox="0 0 16 16" \{\.\.\.P\}>/);
  });
});
