import { describe, expect, it, vi } from 'vitest';
import { installSheetPlay, onSheetPlay, type SheetPlay } from './sheetPlayBus';
import grid from './SheetGrid.tsx?raw';

// 2026-10-21 실측: 이 앱은 capabilities 가 없어 웹 listen('sheet-play') 가 막혀, 열린 표에 scripts/sheet set 하면 영영 답이 없었다.
// Rust 가 window.__sheetPlay(…) 를 eval 로 부르고(Craft 의 __craftSpace 와 같은 길), 그 파일 표가 받으면 바로 sheet_play_ack
const pl = (path: string): SheetPlay => ({ id: 'a1', path, puts: [], by: '' });

describe('참모 칸 쓰기 받기(window.__sheetPlay)', () => {
  it('그 파일을 연 표에만 간다 — 받은 표가 있으면 true', () => {
    const w: { __sheetPlay?: (p: SheetPlay) => boolean } = {};
    installSheetPlay(w);
    const a = vi.fn(), b = vi.fn();
    const offA = onSheetPlay('/x/a.xlsx', a);
    onSheetPlay('/x/b.xlsx', b);
    expect(w.__sheetPlay!(pl('/x/a.xlsx'))).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    offA();
    expect(w.__sheetPlay!(pl('/x/a.xlsx'))).toBe(false);
    expect(a).toHaveBeenCalledTimes(1);
  });
  it('표는 이벤트 listen 대신 onSheetPlay, 받자마자 sheet_play_ack', () => {
    expect(grid).not.toMatch(/listen<[^>]*>\('sheet-play'/);
    expect(grid).not.toMatch(/@tauri-apps\/api\/event/);
    expect(grid).toMatch(/onSheetPlay\(path, /);
    expect(grid).toMatch(/invoke\('sheet_play_ack', \{ id: p\.id \}\)/);
  });
});
