// 세션 상태 판정 표 — 사이드바·대시보드·작업 패널·폰이 다 쓰는 activityStatus 하나를 표 한 장으로 시험한다.
// agents 칸(state·status)은 2026-10-11 시험 세션(claude 2.1.296 --bg)에서 잰 값 그대로다:
//   질문으로 끝냄 = blocked·idle · 답하고 끝 = done·idle · 실패를 알리고 끝 = blocked·idle · 백그라운드 일 기다림 = working·busy(턴은 끝남)
import { describe, expect, it } from 'vitest';
import { summarizeTranscript } from './activity';
import { parseAgents } from './session';
import { activityStatus, liveLine, type ActivityStatus } from './status';

const T0 = Date.parse('2026-10-11T00:45:44Z');
const t = (sec: number) => new Date(T0 + sec * 1000).toISOString();
const NOW = T0 + 5 * 60_000;

const line = (o: object) => JSON.stringify(o);
const user = (sec: number, content: unknown, extra: object = {}) => line({ type: 'user', timestamp: t(sec), message: { role: 'user', content }, ...extra });
const end = (sec: number, text: string) => line({ type: 'assistant', timestamp: t(sec), message: { role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn' } });
const tool = (sec: number, name: string, input: object, id = `tu${sec}`) =>
  line({ type: 'assistant', timestamp: t(sec), message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' } });
const launch = (sec: number, id: string) =>
  [tool(sec, 'Bash', { command: 'sleep 150', run_in_background: true }, `tu-${id}`),
    user(sec, [{ type: 'tool_result', tool_use_id: `tu-${id}`, content: `Command running in background with ID: ${id}` }], { toolUseResult: { stdout: '', backgroundTaskId: id } })].join('\n');
const notified = (sec: number, id: string) => user(sec, `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n</task-notification>`);
const authFail = (sec: number) =>
  line({ type: 'assistant', timestamp: t(sec), isApiErrorMessage: true, error: 'authentication_failed', message: { role: 'assistant', content: [{ type: 'text', text: 'Login expired · Please run /login' }] } });

type Row = {
  name: string;
  /** claude agents --json 한 줄(id·cwd 는 채운다) */
  agent: { state: string; status?: string; waitingFor?: string };
  /** 대화 기록 꼬리 — null 이면 아직 못 읽음 */
  tx: string[] | null;
  /** 세션 목록을 마지막으로 받은 때(초, T0 기준) — 없으면 방금 */
  seen?: number;
  want: ActivityStatus;
};

const ASK = [user(0, '시험'), end(2, '빨강이랑 파랑 중 어느 색으로 할까?')];

const TABLE: Row[] = [
  // 사람에게 묻는다
  { name: '질문으로 턴을 끝냄(실측 blocked·idle)', agent: { state: 'blocked', status: 'idle' }, tx: ASK, want: 'asks' },
  { name: '질문으로 끝냈는데 Claude 가 done 으로 봄', agent: { state: 'done', status: 'idle' }, tx: ASK, want: 'asks' },
  { name: '묻고 백그라운드 일도 기다림 — 묻는 게 먼저', agent: { state: 'working', status: 'busy' }, tx: [user(0, '시험'), launch(1, 'b1'), end(2, 'CI 도는 중이야. 머지할까?')], want: 'asks' },
  { name: '선택지 창', agent: { state: 'blocked', status: 'waiting', waitingFor: 'input needed' }, tx: [user(0, '시험'), tool(1, 'AskUserQuestion', {})], want: 'blocked' },
  { name: '로그인 풀려 멈춤', agent: { state: 'blocked', status: 'idle' }, tx: [user(0, '시험'), authFail(1)], want: 'login' },
  // 일한다
  { name: '포그라운드 명령 도는 중', agent: { state: 'working', status: 'busy' }, tx: [user(0, '시험'), tool(1, 'Bash', { command: 'pnpm test' })], want: 'working' },
  { name: '끝 알림을 받고 다시 일함', agent: { state: 'working', status: 'busy' }, tx: [user(0, '시험'), launch(1, 'b1'), end(2, '돌려 뒀어'), notified(150, 'b1'), tool(152, 'Read', { file_path: '/x/a.ts' })], want: 'working' },
  { name: '둘 중 하나만 끝나 다시 일함 — 남은 하나가 있어도 일하는 중', agent: { state: 'working', status: 'busy' }, tx: [user(0, '시험'), launch(1, 'b1'), launch(2, 'b2'), end(3, '둘 다 돌려 뒀어'), notified(150, 'b1'), tool(152, 'Read', { file_path: '/x/a.ts' })], want: 'working' },
  { name: '새 지시를 받아 답 쓰기 전', agent: { state: 'working', status: 'busy' }, tx: [user(0, '시험'), end(2, '끝났어.'), user(200, '다음 거 해')], want: 'working' },
  // 백그라운드 일을 기다린다 — 멈춤도 일함도 아니다
  { name: '백그라운드 일 기다림(실측 working·busy, 턴은 끝남)', agent: { state: 'working', status: 'busy' }, tx: [user(0, '시험'), launch(1, 'b1'), end(2, '아직 sleep 150 이 돌고 있어요. 끝나면 알림이 오고, 그때 답할게요.')], want: 'bgwait' },
  { name: '깨우기 예약 걸고 쉼', agent: { state: 'done', status: 'idle' }, tx: [user(0, '시험'), tool(1, 'ScheduleWakeup', { delaySeconds: 600, prompt: '/loop CI' }), end(2, '10분 뒤 다시 볼게')], want: 'bgwait' },
  // L11(2026-10-11 bug-hunt) — 백그라운드 일이 살아 있으면 agents 는 working 을 준다(실측). 쉬는데 끝 알림 없는 일이 남았으면 죽인 일 — 기다림이 아니라 답함
  { name: '띄운 일이 끝 알림 없이 사라짐(죽임) — 쉬는 세션은 답함', agent: { state: 'done', status: 'idle' }, tx: [user(0, '시험'), launch(1, 'b1'), end(2, '돌려 뒀어')], want: 'done' },
  { name: '죽인 일이 남았어도 질문으로 끝냈으면 물어봄', agent: { state: 'blocked', status: 'idle' }, tx: [user(0, '시험'), launch(1, 'b1'), end(2, '돌려 뒀어. 머지할까?')], want: 'asks' },
  { name: '죽인 일 + 깨우기 예약 — 깨우기가 있으면 기다림', agent: { state: 'done', status: 'idle' }, tx: [user(0, '시험'), launch(1, 'b1'), tool(2, 'ScheduleWakeup', { delaySeconds: 600, prompt: '/loop CI' }), end(3, '10분 뒤 다시 볼게')], want: 'bgwait' },
  // 끝났다·쉰다
  { name: '답하고 끝(실측 done·idle)', agent: { state: 'done', status: 'idle' }, tx: [user(0, '시험'), end(2, '끝났어.')], want: 'done' },
  { name: '실패를 알리고 끝 — Claude 는 blocked 로 보지만 묻지 않음(실측)', agent: { state: 'blocked', status: 'idle' }, tx: [user(0, '시험'), tool(1, 'Bash', { command: 'sleep 150' }), end(2, '시험은 실패했어. Bash가 sleep 150을 차단했어.')], want: 'done' },
  { name: '지시를 받고 답 없이 쉼', agent: { state: 'done', status: 'idle' }, tx: [end(0, '끝났어.'), user(60, '다음 거 해')], want: 'idle' },
  { name: '띄우고 아무 말 없음', agent: { state: 'done', status: 'idle' }, tx: [], want: 'idle' },
  { name: '하루 넘게 조용', agent: { state: 'done', status: 'idle' }, tx: [user(-25 * 3600, '시험'), end(-25 * 3600 + 2, '할까?')], want: 'stale' },
  // 모른다 — 추측으로 쉼·일함을 칠하지 않는다
  { name: '기록을 아직 못 읽음 + 목록은 쉼', agent: { state: 'done', status: 'idle' }, tx: null, want: 'unknown' },
  { name: '기록을 아직 못 읽음 + 질문으로 멈춤(blocked·idle)', agent: { state: 'blocked', status: 'idle' }, tx: null, want: 'unknown' },
  { name: '기록을 아직 못 읽음 + 목록이 일함', agent: { state: 'working', status: 'busy' }, tx: null, want: 'working' },
  { name: '기록을 아직 못 읽음 + 권한 창', agent: { state: 'blocked', status: 'waiting', waitingFor: 'permission prompt' }, tx: null, want: 'blocked' },
  { name: '세션 목록이 40초째 안 옴 — 옛 일함을 믿지 않는다', agent: { state: 'working', status: 'busy' }, tx: [user(0, '시험'), tool(1, 'Bash', { command: 'pnpm test' })], seen: 300 - 40, want: 'unknown' },
  { name: '세션 목록이 15초 전 — 아직 믿는다', agent: { state: 'working', status: 'busy' }, tx: [user(0, '시험'), tool(1, 'Bash', { command: 'pnpm test' })], seen: 300 - 15, want: 'working' },
];

describe('세션 상태 판정 표 — activityStatus 하나', () => {
  for (const r of TABLE) {
    it(r.name, () => {
      const s = parseAgents(JSON.stringify([{ id: 'aa11', cwd: '/dev/acme', kind: 'background', ...r.agent }]), '/dev')[0]!;
      const a = r.tx === null ? undefined : summarizeTranscript(r.tx.join('\n'));
      const seenAt = r.seen === undefined ? NOW : T0 + r.seen * 1000;
      expect(activityStatus(s.state, a, NOW, seenAt)).toBe(r.want);
    });
  }
});

// 대시보드·참모 홈 '지금 하는 일' 한 줄 — 판단(st)과 같이 간다. 오래 도는 명령은 몇 분째인지, 백그라운드 기다림은 그렇다고(2026-09-30 조사 4번)
describe('liveLine — 지금 하는 일 한 줄', () => {
  const at = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
  const bash = (minAgo: number) => ({ name: 'Bash', target: 'pnpm test', ts: at(minAgo) });
  it('일하는 중 — 마지막 도구, 3분 넘게 그 도구에 머물면 몇 분째', () => {
    expect(liveLine('working', { tool: bash(1), lastMsgAt: at(1) }, NOW)).toEqual({ status: 'run', line: 'Bash pnpm test' });
    expect(liveLine('working', { tool: bash(7), lastMsgAt: at(7) }, NOW)).toEqual({ status: 'run', line: 'Bash pnpm test · 7분째' });
    expect(liveLine('working', { tool: bash(7), lastMsgAt: at(1) }, NOW).line).toBe('Bash pnpm test'); // 그 뒤에 새 줄이 있다
    expect(liveLine('working', { tool: { name: 'mcp__playwright__browser_click', target: '', ts: at(1) } }, NOW).line).toBe('browser_click');
    expect(liveLine('working', {}, NOW).line).toBe('생각 중');
  });
  it('물어봄·확인창은 답 끝, 백그라운드 기다림은 몇 분째, 모름은 모름, 나머지는 쉼', () => {
    expect(liveLine('asks', { reply: { ts: at(2), text: '…', tail: '…어느 색으로 할까?' } }, NOW)).toEqual({ status: 'ask', line: '어느 색으로 할까?' });
    expect(liveLine('bgwait', { reply: { ts: at(4), text: '돌려 뒀어' } }, NOW)).toEqual({ status: 'wait', line: '백그라운드 기다림 · 4분째' });
    expect(liveLine('unknown', undefined, NOW)).toEqual({ status: 'wait', line: '모름' });
    expect(liveLine('done', { reply: { ts: at(2), text: '끝났어' } }, NOW)).toEqual({ status: 'wait', line: '쉼' });
  });
});
