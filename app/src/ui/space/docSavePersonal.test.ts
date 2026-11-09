// 내 메모는 참모에게 저절로 안 읽힌다 — 고쳐도 space-log(참모·다마고치가 읽는 기록)와 '보낼 것'(참모 입력칸으로 가는 모음)에 안 남는다(11-05 사용자)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { cmd: string; args: unknown }[] = [];
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args: unknown) => { calls.push({ cmd, args }); return 'stamp'; }),
}));

const { newSession, saveSoon, lastSaved } = await import('./docSave');
const { pendingNow, setBaseline } = await import('./pending');

const NOTE = '/d/notes/note-1.md';
const DOC = '/d/project/docs/a.md';
const names = () => calls.map((c) => c.cmd);

beforeEach(() => { vi.useFakeTimers(); calls.length = 0; lastSaved.clear(); });
afterEach(() => { vi.useRealTimers(); });

describe('내 메모(personal) 저장', () => {
  it('파일엔 쓰고 space-log 에는 안 남긴다', async () => {
    const s = newSession(NOTE, '', true);
    saveSoon(s, '장 볼 것 내용\n');
    await vi.advanceTimersByTimeAsync(800);
    expect(names()).toEqual(['write_doc_text']);
    expect(calls[0]!.args).toEqual({ path: NOTE, text: '장 볼 것 내용\n', expected: '' });
  });

  it('보낼 것(참모 입력칸으로 가는 모음)에도 안 들어간다', async () => {
    const s = newSession(NOTE, '첫 줄\n', true);
    saveSoon(s, '첫 줄\n둘째 줄\n');
    await vi.advanceTimersByTimeAsync(800);
    expect(pendingNow().docs.map((d) => d.path)).not.toContain(NOTE);
  });
});

describe('보통 문서는 그대로 — 위 시험이 헛돌지 않게', () => {
  it('고치면 space-log 와 보낼 것에 남는다', async () => {
    setBaseline(DOC, '첫 줄\n');
    const s = newSession(DOC, '첫 줄\n');
    saveSoon(s, '첫 줄\n둘째 줄\n');
    await vi.advanceTimersByTimeAsync(800);
    expect(names()).toEqual(['write_doc_text', 'space_log_append']);
    expect(pendingNow().docs.map((d) => d.path)).toContain(DOC);
  });
});
