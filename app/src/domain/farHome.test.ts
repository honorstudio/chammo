import { describe, expect, it } from 'vitest';
import { farHome, farLocker, showFarButton } from './farHome';

const env = { assistantName: '참모', language: 'ko', devRoot: '/Users/b/dev', extraProjects: ['/Users/b/work/ops'], hqDir: '/Users/b/.chammo/hq' };
const agents = (rows: object[]) => JSON.stringify(rows);
const send = (task: string, from: string, target: string, ts: string) => JSON.stringify({ type: 'send', task, from, target, title: '일', ts });

describe('farHome — 그 기기 홈(참모·맡긴 세션)', () => {
  const now = Date.parse('2026-10-22T10:00:00Z');
  const raw = agents([
    { id: 'o1', name: '참모', cwd: env.hqDir, status: 'busy', sessionId: 'S-o1' },
    { id: 'o2', name: '참모-2 · 영상', cwd: env.hqDir, status: 'idle', sessionId: 'S-o2' },
    { id: 'h1', name: 'sns-post', cwd: env.hqDir, status: 'idle', sessionId: 'S-h1' },
    { id: 'p1', name: 'nas-backup', cwd: '/Users/b/dev/nas-backup', status: 'busy', sessionId: 'S-p1' },
    { id: 'p2', name: 'ops', cwd: '/Users/b/work/ops', status: 'waiting', waitingFor: 'input needed', sessionId: 'S-p2' },
    { id: 'x1', name: 'outside', cwd: '/Users/b/Downloads', status: 'busy', sessionId: 'S-x1' },
  ]);
  const tasks = [send('t1', 'o1', 'nas-backup', '2026-10-22T09:50:00Z')].join('\n');

  it('참모는 그 기기 HQ 의 참모 이름 세션만(도우미는 빼고), 세션은 devRoot·추가 폴더 안만', () => {
    const h = farHome({ env, sessionsRaw: raw, tasksText: tasks, tails: {}, now });
    expect(h.assistants.map((a) => a.id)).toEqual(['o1', 'o2']);
    const all = h.groups.flatMap((g) => g.sessions.map((s) => s.id));
    expect(all).toContain('p1');
    expect(all).toContain('p2');
    expect(all).not.toContain('x1');
    expect(all).not.toContain('h1');
  });

  it('맡긴 참모 아래로 묶고, 맡긴 참모가 없는 세션은 마지막 묶음(owner null)', () => {
    const h = farHome({ env, sessionsRaw: raw, tasksText: tasks, tails: {}, now });
    expect(h.groups[0]).toMatchObject({ owner: 'o1' });
    expect(h.groups[0]!.sessions.map((s) => s.id)).toEqual(['p1']);
    expect(h.groups.at(-1)).toMatchObject({ owner: null });
    expect(h.groups.at(-1)!.sessions.map((s) => s.id)).toEqual(['p2']);
  });

  it('점: 일함 run · 물음 ask · 쉼 rest, 하는 일은 대화 꼬리 마지막 답 한 줄', () => {
    const tail = JSON.stringify({ type: 'assistant', timestamp: '2026-10-22T09:59:00Z', message: { role: 'assistant', content: [{ type: 'text', text: 'acme-shop 빌드 확인 중\n둘째 줄' }] } });
    const h = farHome({ env, sessionsRaw: raw, tasksText: tasks, tails: { 'S-p1': tail }, now });
    const p1 = h.groups[0]!.sessions[0]!;
    expect(p1.dot).toBe('run');
    expect(p1.doing).toBe('acme-shop 빌드 확인 중 둘째 줄'); // 답 요약은 줄바꿈을 한 줄로 편다(summarizeTranscript)
    expect(h.groups.at(-1)!.sessions[0]!.dot).toBe('ask');
    expect(h.assistants[1]!.dot).toBe('rest');
  });

  it('그 기기 참모 기본 이름이 달라도(env.assistantName) 참모로 친다', () => {
    const h = farHome({ env: { ...env, assistantName: 'Jarvis' }, sessionsRaw: agents([{ id: 'j1', name: 'Jarvis-2', cwd: env.hqDir, status: 'idle', sessionId: 'S-j' }]), tasksText: '', tails: {}, now });
    expect(h.assistants.map((a) => a.id)).toEqual(['j1']);
  });

  it('깨진 목록은 빈 홈(던지지 않는다)', () => {
    expect(farHome({ env, sessionsRaw: 'nope', tasksText: '', tails: {}, now })).toEqual({ assistants: [], groups: [] });
  });
});

describe('farLocker — 그 기기 보관함 목록', () => {
  it('참모별로 묶고 최근 순, 폴더는 그 참모 아래', () => {
    const v = farLocker({ items: [
      { owner: '운영', rel: '10월/a.pdf', folder: '10월', size: 10, mtime: 100 },
      { owner: '운영', rel: 'b.md', folder: null, size: 5, mtime: 300 },
      { owner: '디자인', rel: 'c.png', folder: null, size: 1, mtime: 200 },
    ], folders: [{ owner: '운영', name: '10월' }], owners: ['운영', '디자인', '빈 참모'] });
    expect(v.map((o) => o.owner)).toEqual(['운영', '디자인', '빈 참모']);
    expect(v[0]!.files.map((f) => f.name)).toEqual(['b.md', 'a.pdf']);
    expect(v[0]!.folders).toEqual(['10월']);
    expect(v[2]!.files).toEqual([]);
  });
  it('모양이 틀리면 빈 목록', () => {
    expect(farLocker(null)).toEqual([]);
    expect(farLocker({ items: 'x' })).toEqual([]);
  });
});

describe('showFarButton — 띠의 기기 단추', () => {
  it('짝지은 기기가 하나라도 있을 때만(끊긴 기기도 짝은 지은 것)', () => {
    expect(showFarButton([])).toBe(false);
    expect(showFarButton([{ id: 'nA', name: '아이맥' }])).toBe(true);
  });
});
