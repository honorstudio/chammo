import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { cmd: string; args: Record<string, unknown> }[] = [];
let reply: (cmd: string, args: Record<string, unknown>) => unknown = () => undefined;
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => { calls.push({ cmd, args }); return reply(cmd, args); },
}));
const { lastSaved, newSession, saveNow, saveSoon, setBase } = await import('./docSave');

const P = '/h/pages/메모.md';
const writes = () => calls.filter((c) => c.cmd === 'write_doc_text');

describe('docSave — 알던 판일 때만 쓴다(밖에서 고친 줄을 덮지 않게, 2026-10-04 QA D1)', () => {
  beforeEach(() => { calls.length = 0; lastSaved.clear(); reply = (cmd) => (cmd === 'write_doc_text' ? '9:9' : undefined); });

  it('편집기가 본 파일 글을 expected 로 보내고, 쓰면 새 글·도장을 기억한다', async () => {
    const s = newSession(P, '# 옛\n');
    await saveNow(s, '# 새\n');
    expect(writes()[0]!.args).toEqual({ path: P, text: '# 새\n', expected: '# 옛\n' });
    expect(s.base).toMatchObject({ text: '# 새\n', stamp: '9:9', ver: 2 });
    expect(lastSaved.get(P)).toBe('# 새\n');
    expect(s.writing).toBe(false);
  });

  it('밖에서 바뀌어 거절되면 열린 편집기에 알린다(합치기는 편집기 몫) — 기억한 판은 그대로', async () => {
    const s = newSession(P, '# 옛\n');
    reply = (cmd) => { if (cmd === 'write_doc_text') throw 'CHANGED_OUTSIDE'; };
    s.onOutside = vi.fn(); s.onGone = vi.fn();
    await saveNow(s, '# 새\n');
    expect(s.onOutside).toHaveBeenCalled();
    expect(s.onGone).not.toHaveBeenCalled();
    expect(s.base.text).toBe('# 옛\n');
    expect(lastSaved.has(P)).toBe(false);
  });

  it('편집기가 닫힌 뒤 거절되면 내 판을 history 에 남긴다(잃지 않게)', async () => {
    const s = newSession(P, '# 옛\n');
    reply = (cmd) => { if (cmd === 'write_doc_text') throw 'CHANGED_OUTSIDE'; };
    await saveNow(s, '# 내 글\n');
    expect(calls.find((c) => c.cmd === 'keep_doc_version')?.args).toEqual({ path: P, text: '# 내 글\n' });
  });

  it('파일이 지워졌거나 이름이 바뀌어 못 쓰면 gone — 못 쓴 판은 늘 history 로', async () => {
    reply = (cmd) => { if (cmd === 'write_doc_text') throw 'No such file or directory'; };
    const s = newSession(P, '# 옛\n');
    s.onOutside = vi.fn(); s.onGone = vi.fn();
    await saveNow(s, '# 새\n');
    expect(s.onGone).toHaveBeenCalled();
    expect(s.onOutside).not.toHaveBeenCalled();
    await saveNow(newSession(P, '# 옛\n'), '# 닫힌 뒤\n');
    expect(calls.filter((c) => c.cmd === 'keep_doc_version').map((c) => c.args.text)).toEqual(['# 새\n', '# 닫힌 뒤\n']);
  });

  it('충돌로 멈춘 문서는 안 쓴다', async () => {
    const s = newSession(P, '# 옛\n');
    s.blocked = true;
    await saveNow(s, '# 새\n');
    expect(writes()).toEqual([]);
  });

  it('문서를 떠났다 바로 돌아와도 옛 편집기의 늦은 저장은 그 편집기 기준으로 — 새 편집기 기준을 바꾸지 않는다', async () => {
    vi.useFakeTimers();
    const old = newSession(P, '# 원래\n');
    saveSoon(old, '# 원래 + 마지막 타자\n'); // 0.7초 기다리는 중에 문서를 떠남
    const fresh = newSession(P, '# 원래\n'); // 다시 열었을 땐 아직 옛 글을 읽었다
    await vi.advanceTimersByTimeAsync(800);
    vi.useRealTimers();
    expect(writes()[0]!.args.expected).toBe('# 원래\n');
    expect(old.base.text).toBe('# 원래 + 마지막 타자\n');
    expect(fresh.base).toMatchObject({ text: '# 원래\n', stamp: null }); // 새 편집기는 첫 감시에서 파일을 읽어 마지막 타자를 받아 온다
  });

  it('기준 번호(ver)는 바뀔 때마다 오른다 — 감시가 낡은 결과를 버린다', () => {
    const s = newSession(P, 'a');
    setBase(s, 'b', '2:2');
    expect(s.base.ver).toBe(2);
  });
});
