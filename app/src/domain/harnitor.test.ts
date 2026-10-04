import { describe, expect, it } from 'vitest';
import { bridgeCommand, harnitorUrl, harnitorViewWord, readBridgeMsg, themeVars } from './harnitor';

describe('하니터 다리 — iframe 이 부른 명령 → 참모 명령', () => {
  it('하니터 명령은 harnitor_ 를 붙여 넘긴다', () => {
    expect(bridgeCommand('scan')).toBe('harnitor_scan');
    expect(bridgeCommand('scan_fast')).toBe('harnitor_scan_fast');
    expect(bridgeCommand('plan_toggle_mcp')).toBe('harnitor_plan_toggle_mcp');
    expect(bridgeCommand('apply_plan')).toBe('harnitor_apply_plan');
    expect(bridgeCommand('undo')).toBe('harnitor_undo');
    expect(bridgeCommand('sessions')).toBe('harnitor_sessions');
  });

  it('옮기지 않은 것(AI·청사진)과 참모 자체 명령은 막는다 — iframe 이 참모 명령을 마음대로 부르면 안 된다', () => {
    for (const c of ['ai_propose', 'ai_progress', 'ai_stop', 'blueprint_apply', 'make_skill', 'desk_load', 'pty_write', 'app_exit', 'harnitor_scan', '', '__proto__', 'constructor']) {
      expect(bridgeCommand(c)).toBeNull();
    }
  });

  it('주소 — 맥은 harnitor://, 윈도우는 http://harnitor.localhost', () => {
    expect(harnitorUrl(false)).toBe('harnitor://localhost/');
    expect(harnitorUrl(true)).toBe('http://harnitor.localhost/');
  });
});

describe('readBridgeMsg — iframe 이 보낸 것만 골라 읽는다', () => {
  it('invoke·esc·ready', () => {
    expect(readBridgeMsg({ harnitor: 'invoke', id: 3, cmd: 'scan', args: { lang: 'ko' } })).toEqual({ kind: 'invoke', id: 3, cmd: 'scan', args: { lang: 'ko' } });
    expect(readBridgeMsg({ harnitor: 'invoke', id: 4, cmd: 'undo' })).toEqual({ kind: 'invoke', id: 4, cmd: 'undo', args: {} });
    expect(readBridgeMsg({ harnitor: 'esc' })).toEqual({ kind: 'esc' });
    expect(readBridgeMsg({ harnitor: 'ready' })).toEqual({ kind: 'ready' });
  });

  it('모양이 틀리면 null', () => {
    expect(readBridgeMsg(null)).toBeNull();
    expect(readBridgeMsg('scan')).toBeNull();
    expect(readBridgeMsg({ hodoc: 'esc' })).toBeNull();
    expect(readBridgeMsg({ harnitor: 'invoke', id: '1', cmd: 'scan' })).toBeNull();
    expect(readBridgeMsg({ harnitor: 'invoke', id: 1, cmd: 7 })).toBeNull();
    expect(readBridgeMsg({ harnitor: 'invoke', id: 1, cmd: 'scan', args: [1] })).toBeNull();
    expect(readBridgeMsg({ harnitor: 'reply', id: 1 })).toBeNull();
  });
});

describe('themeVars — 하니터 색 변수를 참모 테마 토큰으로', () => {
  const tokens: Record<string, string> = { '--panel': '#f6f6f8', '--surface': '#fff', '--surface-2': '#f0f0f3', '--tag-bg': '#ececef', '--text': '#1d1d20', '--text-2': '#4a4a52', '--text-3': '#8a8a92', '--line': '#dcdce1', '--line-strong': '#c6c6cd', '--accent': '#d9622b', '--idle': '#1f9a62', '--tag-done': '#dcf2e6', '--danger-ink': '#a12a2a', '--danger-bg': '#fbe3e3', '--working': '#2f74e0', '--tag-working': '#dde8fb' };
  const v = themeVars((n) => tokens[n] ?? '');

  it('하니터 변수마다 참모 값', () => {
    expect(v['--ground']).toBe('#f6f6f8');
    expect(v['--surface']).toBe('#fff');
    expect(v['--ink']).toBe('#1d1d20');
    expect(v['--ink-3']).toBe('#8a8a92');
    expect(v['--line-2']).toBe('#c6c6cd');
    expect(v['--copper']).toBe('#d9622b');
    expect(v['--alert']).toBe('#a12a2a');
    expect(v['--teal']).toBe('#1f9a62');
    expect(v['--doc']).toBe('#2f74e0');
  });

  it('옅은 칸은 참모 강조색을 면에 섞어서', () => {
    expect(v['--copper-wash']).toContain('color-mix');
    expect(v['--copper-wash']).toContain('#d9622b');
  });

  it('토큰을 못 읽으면 그 변수는 안 넘긴다(하니터 원래 색이 남게)', () => {
    const none = themeVars(() => '');
    expect(Object.keys(none)).toHaveLength(0);
  });
});

describe('readBridgeMsg — 하니터 안에서 고른 것(view)', () => {
  // 화면 감지(2026-10-02): 하니터에서 고른 프로젝트·항목을 참모가 알고, 탭을 바꿨다 와도 되살린다
  it('프로젝트·경로·항목을 글자로만 받는다', () => {
    expect(readBridgeMsg({ harnitor: 'view', project: 'project-b', path: '/d/project-b', item: 'mcp:p:supabase' })).toEqual({ kind: 'view', project: 'project-b', path: '/d/project-b', item: 'mcp:p:supabase' });
    expect(readBridgeMsg({ harnitor: 'view' })).toEqual({ kind: 'view', project: '', path: '', item: '' });
  });
  it('글자가 아니면 비우고, 너무 길면 자른다', () => {
    const m = readBridgeMsg({ harnitor: 'view', project: { x: 1 }, path: 'p'.repeat(900), item: 3 });
    expect(m).toEqual({ kind: 'view', project: '', path: 'p'.repeat(300), item: '' });
  });
  it('보이는 말 — 고른 게 없으면 빈 말', () => {
    expect(harnitorViewWord({ project: 'project-b', path: '/d', item: 'mcp:p:supabase' })).toBe('프로젝트 project-b · 고른 것 mcp:p:supabase');
    expect(harnitorViewWord({ project: 'project-b', path: '/d', item: '' })).toBe('프로젝트 project-b');
    expect(harnitorViewWord({ project: '', path: '', item: '' })).toBe('');
  });
});
