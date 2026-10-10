import { describe, expect, it } from 'vitest';
import { makeEditor } from './editor';
import { place, type GachaFile } from '../../domain/gacha';

// 느린 가짜 파일 — 읽기·쓰기가 각각 한 박자씩 걸린다(invoke 왕복)
function slowFile(text: string) {
  let disk = text;
  const tick = () => new Promise((r) => setTimeout(r, 5));
  return { read: async () => { const t = disk; await tick(); return t; }, write: async (t: string) => { await tick(); disk = t; }, now: () => disk };
}
const base = { coins: 100, since: 1, owned: { 'furn.sofa': 1 }, pity: 0, shards: 0, history: [], equip: {} };

describe('makeEditor — gacha.json 고치기는 한 줄로(코인 적립과 가구 놓기가 겹쳐도 안 잃게)', () => {
  it('동시에 와도 둘 다 남는다 — 놓은 가구가 코인 적립에 덮이던 것', async () => {
    const disk = slowFile(JSON.stringify(base));
    const edit = makeEditor(disk.read, disk.write, 0);
    await Promise.all([
      edit((f) => ({ ...f, coins: f.coins + 10 })), // 코인 적립(1분마다 읽고 다시 쓴다)
      edit((f) => place(f, 'furn.sofa', [3, 5])),
    ]);
    const f = JSON.parse(disk.now()) as GachaFile;
    expect(f.coins).toBe(110);
    expect(f.placed).toEqual({ 'furn.sofa': [3, 5] });
  });
  it('바꿀 게 없으면(null·같은 것) 안 쓴다', async () => {
    const disk = slowFile(JSON.stringify(base));
    let writes = 0;
    const edit = makeEditor(disk.read, async (t) => { writes++; await disk.write(t); }, 0);
    expect(await edit(() => null)).toBeNull();
    await edit((f) => f);
    expect(writes).toBe(0);
  });
  it('하나가 실패해도 다음 고치기는 돈다', async () => {
    const disk = slowFile(JSON.stringify(base));
    const edit = makeEditor(disk.read, disk.write, 0);
    await expect(edit(() => { throw new Error('boom'); })).rejects.toThrow('boom');
    await edit((f) => ({ ...f, coins: 7 }));
    expect((JSON.parse(disk.now()) as GachaFile).coins).toBe(7);
  });
});
