import { describe, expect, it } from 'vitest';
import { filterAvailable, filterSkills, mcpRows, removeScope, respawnTargets, shortMcpName, type Available, type McpConf, type McpStatus, type ToolSkill } from './tools';

const conf = (name: string, source: McpConf['source'], offHere = false): McpConf => ({ name, source, target: `cmd-${name}`, http: false, offHere });
const st = (name: string, state: McpStatus['state'], detail = ''): McpStatus => ({ name, target: `t-${name}`, state, detail });

describe('mcpRows — 설정 + 상태 + 쉬어 둔 것을 한 목록으로', () => {
  it('내장 화면 조종(computer-use)은 사용자 것 다음, 모든 프로젝트 토글 되고 상태 점은 mcp list 대신 켬·끔만(2026-10-05)', () => {
    const rows = mcpRows([conf('computer-use', 'builtin'), conf('mobile', 'user')], [st('mobile', 'ok'), st('claude.ai X', 'ok')], []);
    expect(rows.map((r) => [r.name, r.source, r.dot, r.canAll])).toEqual([
      ['mobile', 'user', 'ok', true],
      ['computer-use', 'builtin', 'builtin', true],
      ['claude.ai X', 'connector', 'ok', false],
    ]);
    expect(mcpRows([conf('computer-use', 'builtin', true)], [], [])[0]).toMatchObject({ on: false, dot: 'off' });
    // 지우기는 없다(내장)
    expect(removeScope(rows[1]!)).toBeNull();
  });

  it('이 프로젝트 것 → 모든 프로젝트 것 → 커넥터 → 플러그인 순, 상태 점은 mcp list 값', () => {
    const rows = mcpRows(
      [conf('mobile', 'user'), conf('pw', 'project'), conf('loc', 'local')],
      [st('plugin:sentry:sentry', 'ok'), st('claude.ai Gmail', 'auth'), st('mobile', 'fail', 'boom'), st('pw', 'pending'), st('loc', 'ok')],
      [],
    );
    expect(rows.map((r) => [r.name, r.source, r.dot, r.on])).toEqual([
      ['loc', 'local', 'ok', true],
      ['pw', 'project', 'pending', true],
      ['mobile', 'user', 'fail', true],
      ['claude.ai Gmail', 'connector', 'auth', true],
      ['plugin:sentry:sentry', 'plugin', 'ok', true],
    ]);
    expect(rows.find((r) => r.name === 'mobile')!.detail).toBe('boom');
  });

  it('상태를 아직 못 받았으면 확인 중, 이 프로젝트에서 끈 건 꺼짐', () => {
    const rows = mcpRows([conf('a', 'user'), conf('b', 'user', true)], null, []);
    expect(rows.map((r) => [r.name, r.dot, r.on])).toEqual([['a', 'checking', true], ['b', 'off', false]]);
  });

  it('상태 목록에서만 보이는 서버도 꺼짐(⊘)이면 끈 것으로', () => {
    const rows = mcpRows([], [st('claude.ai Drive', 'off')], []);
    expect(rows[0]).toMatchObject({ name: 'claude.ai Drive', source: 'connector', on: false, dot: 'off' });
  });

  it('모든 프로젝트에서 쉬어 둔 것은 사용자 줄로 꺼짐, 모든 프로젝트 토글은 사용자 범위만', () => {
    const rows = mcpRows([conf('a', 'user'), conf('l', 'local')], [st('claude.ai X', 'ok')], ['sns']);
    expect(rows.map((r) => [r.name, r.parked, r.on, r.canAll])).toEqual([
      ['l', false, true, false],
      ['a', false, true, true],
      ['sns', true, false, true],
      ['claude.ai X', false, true, false],
    ]);
  });

  it('같은 이름이 설정·상태 둘 다에 있으면 한 줄', () => {
    expect(mcpRows([conf('a', 'user')], [st('a', 'ok')], []).length).toBe(1);
  });
});

describe('shortMcpName — 화면에 보일 이름', () => {
  it('커넥터·플러그인 접두는 뗀다', () => {
    expect(shortMcpName('claude.ai Gmail')).toBe('Gmail');
    expect(shortMcpName('plugin:sentry:sentry')).toBe('sentry');
    expect(shortMcpName('plugin:supabase:db')).toBe('supabase · db');
    expect(shortMcpName('mobile')).toBe('mobile');
  });
});

describe('respawnTargets — 다시 연결할 세션', () => {
  it('쉬는 백그라운드 세션만, 일하거나 창을 기다리는 건 수만', () => {
    const s = [
      { id: 'aaaa1111', kind: 'background', state: 'idle' },
      { id: 'bbbb2222', kind: 'background', state: 'working' },
      { id: 'cccc3333', kind: 'interactive', state: 'idle' },
      { id: 'dddd4444', kind: 'background', state: 'blocked' },
      { id: 'eeee5555', kind: 'background', state: 'blocked', waitingFor: 'input needed' }, // 선택지를 기다리는 중 — 다시 켜면 질문이 날아간다
    ];
    expect(respawnTargets(s)).toEqual({ ids: ['aaaa1111', 'dddd4444'], busy: 2 });
  });
});

describe('filterSkills — 스킬 찾기', () => {
  const skills: ToolSkill[] = [
    { name: 'project-starter', desc: '프로젝트 하네스', source: 'user', path: '/u/a', plugin: null },
    { name: 'document-skills:xlsx', desc: '엑셀 표', source: 'plugin', path: '/p/x', plugin: 'document-skills@m' },
    { name: 'deploy', desc: '배포 순서', source: 'project', path: '/q/d', plugin: null },
  ];
  it('이름·설명에서 대소문자 없이, 빈 글이면 다', () => {
    expect(filterSkills(skills, '').length).toBe(3);
    expect(filterSkills(skills, 'XLSX').map((s) => s.name)).toEqual(['document-skills:xlsx']);
    expect(filterSkills(skills, '배포').map((s) => s.name)).toEqual(['deploy']);
  });
});

describe('removeScope — 지울 수 있는 MCP 와 그 범위', () => {
  it('설정에 적힌 것은 그 범위, 쉬어 둔 것은 parked, 커넥터·플러그인·출처 모름은 못 지움', () => {
    const rows = mcpRows([conf('a', 'user'), conf('l', 'local'), conf('p', 'project')], [st('claude.ai X', 'ok'), st('plugin:s:s', 'ok'), st('other', 'ok')], ['z']);
    expect(rows.map((r) => [r.name, removeScope(r)])).toEqual([
      ['l', 'local'], ['p', 'project'], ['a', 'user'], ['z', 'parked'], ['claude.ai X', null], ['plugin:s:s', null], ['other', null],
    ]);
  });
});

describe('filterAvailable — 깔 플러그인 찾기', () => {
  const list: Available[] = [
    { id: 'expo@official', name: 'expo', desc: 'Expo 앱', market: 'official' },
    { id: 'supabase@official', name: 'supabase', desc: '데이터베이스', market: 'official' },
    { id: 'expo-tools@other', name: 'expo-tools', desc: '', market: 'other' },
  ];
  it('빈 글이면 없음(목록이 수천 개라), 이름이 앞에서 맞는 것 먼저, 개수 제한', () => {
    expect(filterAvailable(list, '  ')).toEqual([]);
    expect(filterAvailable(list, 'EXPO').map((a) => a.id)).toEqual(['expo@official', 'expo-tools@other']);
    expect(filterAvailable(list, '데이터').map((a) => a.id)).toEqual(['supabase@official']);
    expect(filterAvailable(list, 'o', 1).length).toBe(1);
  });
});
