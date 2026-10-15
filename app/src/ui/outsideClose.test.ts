import { describe, expect, it } from 'vitest';
import { closeOnOutside } from './outsideClose';
import dialogs from './OrchDialogs.tsx?raw';
import actions from './orchActions.tsx?raw';
import chip from './chat/ModelChip.tsx?raw';
import locker from './space/LockerPage.tsx?raw';
import view from './space/SpaceView.tsx?raw';

// 2026-10-12 사용자(209.png): 띠의 도우미 묶음 메뉴가 바깥을 눌러도 안 닫히고 다른 참모를 눌러야만 닫혔다.
// 메뉴는 window 'mousedown'(버블)로 닫았는데, 채팅 칸 전체가 onMouseDown stopPropagation 이라 거기를 누르면 window 까지 안 올라온다.
// 닫는 신호는 capture 로 받는다 — 어느 칸이 mousedown 을 삼켜도 바깥 누름은 닫기

/** 노드 없는 시험용 — target 은 아무 EventTarget, inside 는 문자열 표지 */
const fire = (t: EventTarget, type: string, target: unknown) => { const e = new Event(type); Object.defineProperty(e, 'target', { value: target }); t.dispatchEvent(e); };

describe('closeOnOutside — 바깥 누름 닫기', () => {
  it('바깥 pointerdown·mousedown 은 닫고, 안쪽 누름은 안 닫는다', () => {
    const w = new EventTarget();
    let n = 0;
    const off = closeOnOutside(w, (t) => (t as unknown) === 'in', () => { n++; });
    fire(w, 'pointerdown', 'in'); fire(w, 'mousedown', 'in');
    expect(n).toBe(0);
    fire(w, 'pointerdown', 'out');
    expect(n).toBe(1);
    fire(w, 'mousedown', 'out'); // pointerdown 이 막힌 환경(preventDefault)에선 mousedown 만 오기도
    expect(n).toBe(2);
    off();
    fire(w, 'pointerdown', 'out');
    expect(n).toBe(2); // 정리하면 더 안 듣는다
  });
  it('capture 로 듣는다 — 칸이 mousedown 을 stopPropagation 해도 먼저 받는다', () => {
    const src = String(closeOnOutside);
    expect(src).toMatch(/capture: true/);
  });
});

describe('띠·앱 팝오버 — 같은 규칙(바깥 누름·Esc·창 blur·창 크기·⌘ 조합키 닫기)', () => {
  it('공용 메뉴(ContextMenu)는 closeOnOutside 로 닫고, window mousedown 버블에 기대지 않는다', () => {
    expect(dialogs).toMatch(/closeOnOutside\(window, \(t\) => !!box\.current\?\.contains\(t as Node\), onClose\)/);
    expect(dialogs).not.toMatch(/addEventListener\('mousedown', off\)/);
    expect(dialogs).toMatch(/addEventListener\('blur', off\)/);
    expect(dialogs).toMatch(/e\.key === 'Escape'/);
    expect(dialogs).toMatch(/e\.metaKey \|\| e\.ctrlKey\) \{ onClose\(\); return; \}/); // ⌘B 로 띠가 접혀도
  });
  it('띠의 메뉴 셋(도우미 묶음·참모 우클릭·쉬는 참모)은 모두 공용 메뉴 하나(openMenu)로 열린다', () => {
    expect(view).toMatch(/onOpen: \(e: React\.MouseEvent\) => act\?\.openMenu\(e, hs\.map/); // 도우미 묶음
    expect(view).toMatch(/act\.menu\(e, o, colorOf/); // 참모 우클릭
    expect(view).toMatch(/act\.openMenu\(e, \[\s*\.\.\.\(onWakeOrch \?\? onResume/); // 쉬는 참모
    expect(actions).toMatch(/const \[menu, setMenu\] = useState<\{ x: number; y: number; items: MenuItem\[\] \} \| null>\(null\)/); // 메뉴 상태 하나 — 다른 메뉴를 열면 바뀐다
  });
  it('모델 칩·보관함 + 메뉴·프로젝트 칩도 capture 로', () => {
    expect(chip).toMatch(/closeOnOutside\(window, \(t\) => !!\(t as HTMLElement\)\.closest\?\.\('\.mc-pop, \.mc-chip'\), \(\) => setOpen\(false\)\)/);
    expect((locker.match(/closeOnOutside\(window, \(t\) => !!box\.current\?\.contains\(t as Node\), \(\) => setOpen\(false\)\)/g) ?? []).length).toBe(2);
  });
});

// 앞으로 새 팝오버가 같은 실수를 안 하게 — ui 아래 window 'mousedown' 은 capture(true)로만
const files = import.meta.glob(['./**/*.tsx', '../App.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
describe('window mousedown 버블 리스너 금지', () => {
  it('window.addEventListener(\'mousedown\', …) 는 capture 로 — 채팅 칸이 삼켜도 닫히게', () => {
    const bad = Object.entries(files).flatMap(([f, s]) => [...s.matchAll(/window\.addEventListener\('mousedown', [^,)]+\)/g)].map((m) => `${f}: ${m[0]}`));
    expect(bad).toEqual([]);
  });
});
