import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { teamAccountDelete, teamDeviceRename, teamHumanSay, teamLogin } from './teamApi';

beforeEach(() => invoke.mockReset().mockResolvedValue({ room: 'r1', seq: 3 }));

describe('팀 사람 말 — 진짜 입력 뒤 1.5초 안에서만', () => {
  it('방금 친 말은 team_human_say 로', async () => {
    expect(await teamHumanSay('민아', '안녕', 1000, 1500)).toEqual({ room: 'r1', seq: 3 });
    const [cmd, arg] = invoke.mock.calls[0]!;
    expect(cmd).toBe('team_human_say');
    expect(arg).toMatchObject({ to: '민아', text: '안녕' });
    expect(arg.cid).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });
  it('진짜 입력이 없거나 오래됐거나 빈 말이면 안 보낸다', () => {
    expect(teamHumanSay('민아', '안녕', 0, 1500)).toBeNull();
    expect(teamHumanSay('민아', '안녕', 1000, 2600)).toBeNull();
    expect(teamHumanSay('민아', '  ', 1000, 1100)).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('계정 명령 이름·인자', () => {
  it('Rust 명령 이름과 칸 이름이 맞다', async () => {
    await teamLogin('https://relay.example.dev');
    await teamDeviceRename('d1', '회사 맥');
    await teamAccountDelete('me@example.com');
    expect(invoke.mock.calls).toEqual([
      ['team_login', { server: 'https://relay.example.dev', device: '' }],
      ['team_device_rename', { id: 'd1', name: '회사 맥' }],
      ['team_account_delete', { confirm: 'me@example.com' }],
    ]);
  });
});
