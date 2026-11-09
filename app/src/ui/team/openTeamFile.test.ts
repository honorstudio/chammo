import { beforeEach, describe, expect, it, vi } from 'vitest';

const chat = vi.hoisted(() => vi.fn(async () => {}));
const craft = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../chat/openChatFile', () => ({ openChatFile: chat }));
vi.mock('../craft/openInCraft', () => ({ openInCraft: craft }));
vi.mock('./confirmRunnable', () => ({ confirmRunnable: vi.fn(async () => false) }));
import { openTeamFile } from './openTeamFile';

// 보안 점검 H-1(2026-11-07) — 팀원이 올린 .exe 를 한 번 누르면 묻지 않고 돌았다. 관문은 Rust(푼 뒤 진짜 이름으로 본다), 여기는 답을 받아 글자 확인을 띄운다
describe('openTeamFile — 실행될 수 있는 파일', () => {
  const calls: [boolean, boolean | undefined][] = [];
  const open = (external: boolean, runOk?: boolean) => {
    calls.push([external, runOk]);
    return external && !runOk ? Promise.reject('needs-run-ok:계약서.exe') : Promise.resolve('/d/peek/계약서.exe');
  };
  beforeEach(() => { calls.length = 0; chat.mockClear(); craft.mockClear(); });

  it('누르면 글자 확인이 뜨고, 취소하면 다시 부르지 않는다', async () => {
    const ask = vi.fn(async () => false);
    await openTeamFile(open, '계약서.exe', false, ask);
    expect(ask).toHaveBeenCalledWith('계약서.exe');
    expect(calls).toEqual([[true, false]]);
    expect(chat).not.toHaveBeenCalled();
  });
  it('확인을 누른 뒤에만 run_ok 로 다시 부른다', async () => {
    const ask = vi.fn(async () => true);
    await openTeamFile(open, '계약서.exe', false, ask);
    expect(calls).toEqual([[true, false], [true, true]]);
  });
  it("'다른 앱으로 열기'도 같은 관문 — 글로 보이는 .sh 를 우클릭으로 돌리는 길", async () => {
    const ask = vi.fn(async () => false);
    await openTeamFile(open, 'install.sh', true, ask);
    expect(ask).toHaveBeenCalledOnce();
    expect(calls).toEqual([[true, false]]);
  });
  it('문서는 묻지 않고 전처럼 — 기본 앱도 스페이스도', async () => {
    const ask = vi.fn(async () => true);
    const fine = (external: boolean, runOk?: boolean) => { calls.push([external, runOk]); return Promise.resolve('/d/peek/a'); };
    await openTeamFile(fine, 'a.zip', false, ask);
    await openTeamFile(fine, 'b.pdf', false, ask);
    expect(ask).not.toHaveBeenCalled();
    expect(calls).toEqual([[true, false], [false, false]]);
    expect(chat).toHaveBeenCalledOnce();
  });
  it('다른 실패는 그대로 올린다', async () => {
    const ask = vi.fn(async () => true);
    await expect(openTeamFile(() => Promise.reject('못 받았어'), 'a.zip', false, ask)).rejects.toBe('못 받았어');
    expect(ask).not.toHaveBeenCalled();
  });
});
