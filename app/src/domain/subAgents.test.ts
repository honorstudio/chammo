import { describe, expect, it } from 'vitest';
import { agentRows, agentWord, foldAgents, nowDoing, revive, type SubAgent } from './subAgents';

const L = (o: object) => JSON.stringify(o);
const call = (id: string, description: string, ts: string, subagent_type = 'general-purpose') =>
  L({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', id, name: 'Agent', input: { description, subagent_type, prompt: '긴 지시' } }] } });
const launched = (id: string, agentId: string, ts: string) =>
  L({ type: 'user', timestamp: ts, toolUseResult: { isAsync: true, status: 'async_launched', agentId }, message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: `agentId: ${agentId}` }] }] } });
const notif = (id: string, agentId: string, status: string, ts: string, result = '다 했어\n둘째 줄') =>
  L({ type: 'user', timestamp: ts, message: { content: `<task-notification>\n<task-id>${agentId}</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n<summary>Agent finished</summary>\n<result>${result}</result>\n</task-notification>` } });

describe('foldAgents — 참모 대화 기록에서 Agent 도구로 띄운 분신(2026-10-02 사용자: 대시보드 제목 아래)', () => {
  it('Agent 호출 → 일하는 중, 띄운 결과에서 agentId, 알림이 오면 끝', () => {
    const a = foldAgents([call('t1', '스킬 분류', '2026-10-02T01:00:00Z'), launched('t1', 'a111', '2026-10-02T01:00:01Z')].join('\n'), []);
    expect(a).toEqual([{ id: 't1', name: '스킬 분류', kind: 'general-purpose', since: '2026-10-02T01:00:00Z', status: 'run', agentId: 'a111' }]);
    const b = foldAgents(notif('t1', 'a111', 'completed', '2026-10-02T01:20:00Z'), a);
    expect(b[0]).toMatchObject({ status: 'done', end: '2026-10-02T01:20:00Z', result: '다 했어' });
  });

  it('참모가 일하는 도중 끝나면 알림이 끼워 넣은 명령(attachment queued_command)으로 온다', () => {
    const queued = L({ type: 'attachment', timestamp: '2026-10-02T01:30:00Z', attachment: { type: 'queued_command', prompt: '<task-notification>\n<task-id>a111</task-id>\n<tool-use-id>t1</tool-use-id>\n<status>completed</status>\n</task-notification>' } });
    expect(foldAgents([call('t1', 'A', '2026-10-02T01:00:00Z'), queued].join('\n'), [])[0]).toMatchObject({ status: 'done', end: '2026-10-02T01:30:00Z' });
  });

  it('실패·멈춤 알림은 그렇게', () => {
    const a = foldAgents([call('t1', 'A', '2026-10-02T01:00:00Z'), call('t2', 'B', '2026-10-02T01:00:00Z'),
      notif('t1', 'x1', 'failed', '2026-10-02T01:05:00Z'), notif('t2', 'x2', 'killed', '2026-10-02T01:06:00Z')].join('\n'), []);
    expect(a.map((x) => x.status)).toEqual(['failed', 'killed']);
  });

  it('도구 결과 안에 알림 글자가 섞여도(grep 출력) 끝으로 치지 않는다', () => {
    const grep = L({ type: 'user', timestamp: '2026-10-02T01:02:00Z', message: { content: [{ type: 'tool_result', tool_use_id: 'bash1', content: '<task-notification><tool-use-id>t1</tool-use-id><status>completed</status>' }] } });
    const a = foldAgents([call('t1', 'A', '2026-10-02T01:00:00Z'), grep].join('\n'), []);
    expect(a[0]!.status).toBe('run');
  });

  it('동기 호출은 도구 결과가 곧 끝(에러면 실패)', () => {
    const done = L({ type: 'user', timestamp: '2026-10-02T01:03:00Z', toolUseResult: { status: 'completed', agentId: 'a9' }, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '결과 첫 줄\n더' }] }] } });
    const err = L({ type: 'user', timestamp: '2026-10-02T01:04:00Z', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: '에러' }] } });
    const a = foldAgents([call('t1', 'A', '2026-10-02T01:00:00Z'), call('t2', 'B', '2026-10-02T01:00:00Z'), done, err].join('\n'), []);
    expect(a[0]).toMatchObject({ status: 'done', agentId: 'a9', result: '결과 첫 줄', end: '2026-10-02T01:03:00Z' });
    expect(a[1]).toMatchObject({ status: 'failed' });
  });

  it('끝난 분신에 SendMessage 로 다시 말 걸면 다시 일하는 중(그 때부터)', () => {
    const prev: SubAgent[] = [{ id: 't1', name: 'A', since: '2026-10-02T01:00:00Z', status: 'done', end: '2026-10-02T01:10:00Z', agentId: 'a111', result: 'x' }];
    const send = L({ type: 'assistant', timestamp: '2026-10-02T02:00:00Z', message: { content: [{ type: 'tool_use', id: 's1', name: 'SendMessage', input: { to: 'a111', message: '하나 더' } }] } });
    expect(foldAgents(send, prev)[0]).toEqual({ id: 't1', name: 'A', since: '2026-10-02T02:00:00Z', status: 'run', agentId: 'a111' });
  });

  it('깨진 줄·다른 도구는 건너뛰고, 같은 호출은 한 번만', () => {
    const a = foldAgents(['{잘린', call('t1', 'A', '2026-10-02T01:00:00Z'), call('t1', 'A', '2026-10-02T01:00:00Z'),
      L({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'ls' } }] } })].join('\n'), []);
    expect(a).toHaveLength(1);
  });

  it('description 이 없으면 종류 이름', () => {
    const l = L({ type: 'assistant', timestamp: '2026-10-02T01:00:00Z', message: { content: [{ type: 'tool_use', id: 't1', name: 'Agent', input: { subagent_type: 'Explore', prompt: 'x' } }] } });
    expect(foldAgents(l, [])[0]!.name).toBe('Explore');
  });
});

describe('agentRows — 일하는 중 위, 끝난 건 1시간 지나면 접기, 24시간 넘으면 안 보임', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const A = (id: string, status: SubAgent['status'], since: string, end?: string): SubAgent => ({ id, name: id, since, status, ...(end ? { end } : {}) });
  it('나누고 정렬한다', () => {
    const r = agentRows([
      A('old', 'done', '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z'), // 26시간 전 — 안 보임
      A('d1', 'done', '2026-10-02T11:00:00Z', '2026-10-02T11:30:00Z'),
      A('d2', 'failed', '2026-10-02T11:00:00Z', '2026-10-02T11:50:00Z'),
      A('f1', 'done', '2026-10-02T08:00:00Z', '2026-10-02T09:00:00Z'),
      A('r1', 'run', '2026-10-02T11:00:00Z'),
      A('r2', 'run', '2026-10-02T11:40:00Z'),
    ], now);
    expect(r.running.map((x) => x.id)).toEqual(['r2', 'r1']);
    expect(r.recent.map((x) => x.id)).toEqual(['d2', 'd1']);
    expect(r.folded.map((x) => x.id)).toEqual(['f1']);
  });
  it('하루 넘게 소식 없는 일하는 중도 안 보인다(참모가 꺼지며 알림 없이 끝난 것)', () => {
    expect(agentRows([A('r', 'run', '2026-10-01T10:00:00Z')], now).running).toEqual([]);
  });
});

describe('agentWord — 줄 가운데 상태 말', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  it('일하는 중 N분 · 방금 · 오래 조용하면 조용함', () => {
    expect(agentWord({ id: 'a', name: 'a', since: '2026-10-02T11:48:00Z', status: 'run' }, now)).toBe('일하는 중 12분');
    expect(agentWord({ id: 'a', name: 'a', since: '2026-10-02T11:59:40Z', status: 'run' }, now)).toBe('일하는 중 방금');
    expect(agentWord({ id: 'a', name: 'a', since: '2026-10-02T10:00:00Z', status: 'run' }, now, Date.parse('2026-10-02T11:00:00Z'))).toMatch(/^조용함 · 마지막 \d\d:\d\d$/);
  });
  it('끝·실패·멈춤 + 시각', () => {
    const end = '2026-10-02T11:30:00Z';
    expect(agentWord({ id: 'a', name: 'a', since: end, end, status: 'done' }, now)).toMatch(/^끝 \d\d:\d\d$/);
    expect(agentWord({ id: 'a', name: 'a', since: end, end, status: 'failed' }, now)).toMatch(/^실패 \d\d:\d\d$/);
    expect(agentWord({ id: 'a', name: 'a', since: end, end, status: 'killed' }, now)).toMatch(/^멈춤 \d\d:\d\d$/);
  });
});

describe('nowDoing — 분신 기록 꼬리에서 마지막 도구 한 줄', () => {
  it('분신 기록(isSidechain)의 마지막 도구 호출', () => {
    const tail = ['잘린 앞', L({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a/b/space.css' } }] } }),
      L({ type: 'user', isSidechain: true, message: { content: [{ type: 'tool_result', content: '1 줄' }] } }),
      L({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test', description: '테스트 돌리기' } }] } }),
      L({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: '생각 중' }] } })].join('\n');
    expect(nowDoing(tail)).toBe('Bash(테스트 돌리기)');
  });
  it('도구가 없으면 마지막 말, 아무것도 없으면 빈 글', () => {
    expect(nowDoing(L({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: '읽어 볼게' }] } }))).toBe('읽어 볼게');
    expect(nowDoing('')).toBe('');
  });
});

describe('revive — 끝 알림 뒤에 분신 기록이 또 쓰이면 다시 일하는 중', () => {
  const a: SubAgent = { id: 't1', name: 'A', since: '2026-10-02T01:00:00Z', end: '2026-10-02T01:10:00Z', status: 'done', result: '중간 보고' };
  it('백그라운드 일을 걸어 두고 멈췄다가 스스로 깨어난 분신(실제 시험 — sleep 을 뒤로 돌리고 끝 알림)', () => {
    expect(revive(a, Date.parse('2026-10-02T01:12:00Z'))).toEqual({ id: 't1', name: 'A', since: '2026-10-02T01:10:00Z', status: 'run' });
  });
  it('끝 무렵에 쓴 기록(몇 초 안)·기록 없음·일하는 중은 그대로', () => {
    expect(revive(a, Date.parse('2026-10-02T01:10:03Z'))).toBe(a);
    expect(revive(a, undefined)).toBe(a);
    const run: SubAgent = { ...a, status: 'run' };
    expect(revive(run, Date.parse('2026-10-02T02:00:00Z'))).toBe(run);
  });
});
