// 보내기 겹침 막기 — 11-17 13:39 스페이스 '고친 것'이 1.3초 사이 두 번 갔다(space-send chars=486 두 줄).
// 메모 칸 Enter 와 단추가 sendAll 을 겹쳐 불렀고, Rust 치기 잠금이 둘을 차례로 쳤다
import { describe, expect, it } from 'vitest';
import { guarded } from './guarded';
import fab from '../ui/space/SendFab.tsx?raw';
import note from '../ui/space/NotePanel.tsx?raw';

describe('guarded', () => {
  it('도는 동안 또 부르면 안 돌린다', async () => {
    const flag = { current: false };
    let n = 0;
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    const a = guarded(flag, async () => { n++; await gate; });
    const b = guarded(flag, async () => { n++; });
    expect(await b).toBe(false);
    open();
    expect(await a).toBe(true);
    expect(n).toBe(1);
  });
  it('끝나면(실패해도) 다시 부를 수 있다', async () => {
    const flag = { current: false };
    await expect(guarded(flag, async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(await guarded(flag, async () => {})).toBe(true);
  });
});

describe('배선', () => {
  it('스페이스 보낼 것·할 일 메모 보내기는 한 번에 하나', () => {
    expect(fab).toMatch(/guarded\(inflight, async \(\) => \{/);
    expect(note).toMatch(/guarded\(inflight, async \(\) => \{/);
  });
});
