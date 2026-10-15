// '고른 곳' 이음매 — 고른 참모가 입력칸·채팅 탭·스페이스·보낼 곳에 같이 가야 한다(docs/selection-rules.md). 화면 없이 잴 수 없는 이음매만 소스로 지킨다
import { describe, expect, it } from 'vitest';
import grid from '../ui/SessionGrid.tsx?raw';

describe('SessionGrid — 그 창으로 가기(⌘1~9·알림) 요청을 받으면 고른 창을 위(App)에도 알린다', () => {
  it('재현: 쌓아 보기에서 ⌘2 — 입력칸만 옮기고 알리지 않으면 스페이스·보낼 곳이 앞 참모에 남는다(2026-10-11 하네스)', () => {
    const effect = grid.slice(grid.indexOf('if (!focusRequest) return;'), grid.indexOf('}, [focusRequest?.n]'));
    expect(effect).toMatch(/onFocusSession\?\.\(id\)/);
  });
});
