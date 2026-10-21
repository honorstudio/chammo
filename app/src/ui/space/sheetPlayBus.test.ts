import { describe, expect, it, vi } from 'vitest';
import { ackThenPlay, installSheetPlay, onSheetPlay, type SheetPlay } from './sheetPlayBus';
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
    expect(grid).toMatch(/invoke<boolean>\('sheet_play_ack', \{ id: p\.id \}\)/);
  });
});

describe('ackThenPlay — 받았어가 늦으면(Rust 가 이미 파일에 썼다) 표는 칠하지 않는다(0.3.6 리뷰)', () => {
  it('기다리는 중이었으면 칠한다', async () => {
    const played: string[] = [];
    await ackThenPlay(async () => true, () => played.push('x'));
    expect(played).toEqual(['x']);
  });
  it('늦었으면 안 칠한다 — 두 번 적용·충돌 띠·답 덮어쓰기', async () => {
    const played: string[] = [];
    await ackThenPlay(async () => false, () => played.push('late'));
    expect(played).toEqual([]);
  });
  it('묻기가 실패하면(받았는지 모름) 칠한다 — 받아 놓고 아무도 답 안 하면 scripts/sheet 가 영영 기다린다', async () => {
    const played: string[] = [];
    await ackThenPlay(async () => { throw new Error('ipc'); }, () => played.push('err'));
    expect(played).toEqual(['err']);
  });
});
