// 따로 창 팀 보관함 → 메인 창 참모로 끌어 놓기(10-28 사용자 "참모한테 드래그해서 파일을 주려고 하는데 안된다") — 받는 창이 주는 길
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RosterOrch } from '../../domain/teamGive';

const invoked: { cmd: string; args: Record<string, unknown> }[] = [];
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: Record<string, unknown>) => {
    invoked.push({ cmd, args });
    if (cmd === 'team_locker_give') return Promise.resolve(['/u/보관함/팀 보관함/t/a.pdf']);
    if (cmd === 'team_locker_open') return Promise.resolve(`/d/peek/${String(args.id)}.pdf`);
    return Promise.resolve(null);
  },
}));
const attached: unknown[] = [];
vi.mock('../fileDrop', () => ({ attachToChat: (id: string, paths: string[]) => attached.push({ id, paths }) }));
vi.mock('./OrchPick', () => ({ OrchPickRow: () => null, rememberPick: () => {} }));
vi.mock('../OrchDialogs', () => ({ ContextMenu: () => null }));

const o: RosterOrch = { id: 'o-1', owner: '참모', label: '참모', color: '#000', busy: false };

const gave: unknown[] = [];
beforeEach(() => { invoked.length = 0; attached.length = 0; gave.length = 0; vi.stubGlobal('window', { __teamGive: (r: unknown) => gave.push(r), addEventListener: () => {} }); });

describe('다른 창에서 놓은 팀 파일 받기', () => {
  it('참모면 \'내 참모에게\'와 같은 길(team_locker_give) — 폴더는 뺀다', async () => {
    const { giveIn } = await import('./teamGive');
    await giveIn({ team: 't1', ids: ['f1', 'dir:견적'], to: 'o-1' }, [o]);
    expect(invoked).toEqual([{ cmd: 'team_locker_give', args: { team: 't1', ids: ['f1'], orch: 'o-1', name: '참모' } }]);
    expect(gave).toEqual([{ orch: 'o-1', paths: ['/u/보관함/팀 보관함/t/a.pdf'] }]); // 메인 창이 그 참모 채팅 입력칸에 칩(보내기는 사람이)
  });
  it('참모가 아닌 세션 채팅이면 풀어 둔 자리 그대로 그 채팅에 붙인다', async () => {
    const { giveIn } = await import('./teamGive');
    await giveIn({ team: 't1', ids: ['f1'], to: 's-9' }, [o]);
    expect(invoked.map((c) => c.cmd)).toEqual(['team_locker_open']);
    expect(attached).toEqual([{ id: 's-9', paths: ['/d/peek/f1.pdf'] }]);
  });
  it('폴더뿐이면 아무 일도 안 한다', async () => {
    const { giveIn } = await import('./teamGive');
    await giveIn({ team: 't1', ids: ['dir:견적'], to: 'o-1' }, [o]);
    expect(invoked).toEqual([]);
  });
});
