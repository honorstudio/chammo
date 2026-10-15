import { describe, expect, it } from 'vitest';
import { closeCurrentTab, newDocFolder, swapHold, type LkHold } from './lockerTabs';
import { lkPick } from './lockerTree';

// 2026-10-12 사용자: ⌘W = 스페이스에서 지금 열려 있는 탭(파일·문서·세션) 닫기. 홈·보관함 고정 탭은 안 닫히고, 닫을 탭이 없으면 아무 일도 없다
const hold = (tabs: string[], back = 'l:o1'): LkHold => ({ orch: 'o1', back, tabs });

describe('closeCurrentTab — ⌘W', () => {
  it('보던 파일 탭을 닫는다 — 다음은 마지막 탭, 다 닫으면 보관함 자리', () => {
    expect(closeCurrentTab(hold(['/a.md', '/b.md']), 'o1', 'd:/b.md')).toEqual({ hold: hold(['/a.md']), pick: 'd:/a.md' });
    expect(closeCurrentTab(hold(['/a.md'], 'l:o1#d:자료'), 'o1', 'd:/a.md')).toEqual({ hold: hold([], 'l:o1#d:자료'), pick: 'l:o1#d:자료' });
  });
  it('세션 탭(s:)도 닫는다', () => {
    expect(closeCurrentTab(hold(['/a.md', 's:x1']), 'o1', 's:x1')).toEqual({ hold: hold(['/a.md']), pick: 'd:/a.md' });
  });
  it('고정 탭(홈·보관함)을 보고 있으면 아무것도 안 한다', () => {
    expect(closeCurrentTab(hold(['/a.md']), 'o1', lkPick('o1', { kind: 'home' }))).toBeNull();
    expect(closeCurrentTab(hold(['/a.md']), 'o1', 'l:o1')).toBeNull();
    expect(closeCurrentTab(hold(['/a.md']), 'o1', 'l:o1#d:자료')).toBeNull();
  });
  it('탭 줄에 없는 화면(다른 참모의 탭·기능 화면)이면 아무것도 안 한다', () => {
    expect(closeCurrentTab(null, 'o1', 'd:/a.md')).toBeNull();
    expect(closeCurrentTab(hold(['/a.md']), 'o2', 'd:/a.md')).toBeNull();
    expect(closeCurrentTab(hold(['/a.md']), 'o1', 'd:/other.md')).toBeNull();
    expect(closeCurrentTab(hold(['/a.md']), 'o1', 't:/root')).toBeNull();
  });
});

describe('newDocFolder — ⌘T 새 문서가 놓일 보관함 폴더', () => {
  it('보관함 폴더를 보고 있으면 그 폴더', () => expect(newDocFolder(lkPick('o1', { kind: 'dir', rel: '10월/세부' }))).toBe('10월/세부'));
  it('보관함 맨 위·진행 중 칩·홈·문서 탭·세션 탭이면 보관함 맨 위(빈 글)', () => {
    for (const pick of ['l:o1', lkPick('o1', { kind: 'root', project: '/H/p' }), lkPick('o1', { kind: 'home' }), 'd:/x/a.md', 's:x1', 't:/r', ''])
      expect(newDocFolder(pick)).toBe('');
  });
});

// 2026-10-12 사용자(참모-2 전달): 참모를 바꿨다 돌아오면 그 참모가 마지막에 보던 화면 그대로 — 탭 줄이 참모 하나 몫(LkHold)이라
// 다른 참모에서 파일을 열면 먼저 참모의 열린 탭·보관함 자리가 사라졌다
describe('swapHold — 참모를 바꿀 때 탭 줄을 참모마다 따로 기억', () => {
  const A: LkHold = { orch: 'oA', back: 'l:oA#d:자료', tabs: ['/a1.md', '/a2.md'] };
  const B: LkHold = { orch: 'oB', back: 'l:oB', tabs: ['/b1.md'] };
  it('떠나는 참모 것을 적고, 가는 참모 것을 돌려준다(처음 가는 참모는 없음)', () => {
    const saved = new Map<string, LkHold>();
    expect(swapHold(saved, A, 'oB')).toBeNull();
    expect(saved.get('oA')).toEqual(A);
  });
  it('갔다 돌아오면 탭·보관함 자리가 그대로', () => {
    const saved = new Map<string, LkHold>();
    swapHold(saved, A, 'oB');
    const back = swapHold(saved, B, 'oA');
    expect(back).toEqual(A);
    expect(swapHold(saved, A, 'oB')).toEqual(B);
  });
  it('탭 줄이 없던 참모를 떠나도 괜찮고, 같은 참모로의 바꾸기는 자기 것', () => {
    const saved = new Map<string, LkHold>();
    expect(swapHold(saved, null, 'oA')).toBeNull();
    expect(swapHold(saved, A, 'oA')).toEqual(A);
  });
});

describe('참모를 바꿨다 돌아오는 화면 기억 — SpaceView·홈 모드 칸', () => {
  it('switchTo 가 탭 줄을 참모마다 적고 되살린다', async () => {
    const view = (await import('../ui/space/SpaceView.tsx?raw')).default;
    const sw = view.slice(view.indexOf('const switchTo = '), view.indexOf('// 화면에 돌아오면 그 문서에서 보던 자리로'));
    expect(sw).toMatch(/swapHold\(holds\.current, lkRef\.current\.hold, id\)/);
    expect(sw).toMatch(/setLkHold\(/);
  });
  it('홈 모드 칸 크게 보기는 이름이 비어도 참모 id 로 기억한다(이름 빈 참모끼리 섞이지 않게)', async () => {
    const mp = (await import('../ui/mode/ModePanel.tsx?raw')).default;
    expect(mp).toMatch(/const k = keys\.find\(Boolean\) \?\? ''/);
  });
});
