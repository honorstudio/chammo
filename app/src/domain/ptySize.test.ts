import { describe, expect, it } from 'vitest';
import { resizeAfterOpen } from './ptySize';

describe('resizeAfterOpen — pty 가 열리는 사이 창 크기가 바뀌면 그 크기를 다시 보낸다', () => {
  // 앱을 막 켰을 때 레이아웃이 자리 잡는 동안 크기가 바뀌었는데 pty 가 아직 없어 버려졌다 →
  // Claude Code 가 줄 수가 적은 채로 그려 입력칸이 위로 붙었다(사용자 2026-09-28, ⌘2→⌘1 하면 정상)
  it('열 때 보낸 크기와 지금이 다르면 지금 크기', () => expect(resizeAfterOpen({ cols: 80, rows: 24 }, { cols: 120, rows: 50 })).toEqual({ cols: 120, rows: 50 }));
  it('같으면 보낼 것 없음', () => expect(resizeAfterOpen({ cols: 120, rows: 50 }, { cols: 120, rows: 50 })).toBeNull());
  it('줄 수만 달라도 보낸다', () => expect(resizeAfterOpen({ cols: 120, rows: 30 }, { cols: 120, rows: 50 })).toEqual({ cols: 120, rows: 50 }));
});
