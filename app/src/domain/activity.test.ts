import { describe, expect, it } from 'vitest';
import { askView, summarizeTranscript, workAct } from './activity';

const line = (o: object) => JSON.stringify(o);
const user = (ts: string, content: unknown, extra: object = {}) => line({ type: 'user', timestamp: ts, message: { role: 'user', content }, ...extra });
const asst = (ts: string, text: string) => line({ type: 'assistant', timestamp: ts, message: { role: 'assistant', content: [{ type: 'text', text }] } });

describe('summarizeTranscript — 세션 대화 기록 꼬리에서 마지막 지시·답', () => {
  it('마지막 사람 지시와 마지막 답을 뽑는다', () => {
    const t = [user('t1', '감사 돌려줘'), asst('t2', '감사 끝났어. 리포트 만들었어'), user('t3', '크리티컬 먼저 진행하자'), asst('t4', 'PR #460 올렸어')].join('\n');
    expect(summarizeTranscript(t)).toMatchObject({
      prompt: { ts: 't3', text: '크리티컬 먼저 진행하자' },
      reply: { ts: 't4', text: 'PR #460 올렸어' },
    });
  });

  it('도구 결과·메타·<태그>로 시작하는 주입 메시지는 사람 지시로 안 친다', () => {
    const t = [
      user('t1', '진짜 지시'),
      user('t2', [{ type: 'tool_result', content: 'ok' }]),
      user('t3', '<command-name>/model</command-name>'),
      user('t4', '보조 알림', { isMeta: true }),
      user('t5', 'Another Claude session sent a message: <teammate-message>…'),
    ].join('\n');
    expect(summarizeTranscript(t).prompt).toEqual({ ts: 't1', text: '진짜 지시' });
  });

  it('도구만 부르고 글이 없는 답은 건너뛴다', () => {
    const t = [asst('t1', '앞선 답'), line({ type: 'assistant', timestamp: 't2', message: { content: [{ type: 'tool_use', name: 'Bash' }] } })].join('\n');
    expect(summarizeTranscript(t).reply).toMatchObject({ ts: 't1', text: '앞선 답' });
  });

  it('꼬리를 잘라 읽어서 첫 줄이 깨져 있어도 괜찮다', () => {
    const t = ['{"type":"user","mess', asst('t2', '답')].join('\n');
    expect(summarizeTranscript(t)).toMatchObject({ reply: { ts: 't2', text: '답' } });
  });

  it('긴 글은 공백을 한 칸으로 줄이고 240자에서 자른다', () => {
    const long = '가'.repeat(300);
    const r = summarizeTranscript(asst('t1', `첫줄\n\n  ${long}`)).reply!;
    expect(r.text.startsWith('첫줄 가')).toBe(true);
    expect(r.text.length).toBe(241); // 240 + …
    expect(r.text.endsWith('…')).toBe(true);
  });

  it('턴 중간 멘트(stop_reason=tool_use)는 midTurn — 턴 끝 답(end_turn)과 가른다', () => {
    const mid = line({ type: 'assistant', timestamp: 't2', message: { stop_reason: 'tool_use', content: [{ type: 'text', text: '먼저 찾아볼게' }] } });
    expect(summarizeTranscript([user('t1', '알림 봐줘'), mid].join('\n')).reply).toMatchObject({ ts: 't2', midTurn: true });
    const end = line({ type: 'assistant', timestamp: 't3', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '두 군데서 나와' }] } });
    expect(summarizeTranscript([user('t1', '알림 봐줘'), mid, end].join('\n')).reply?.midTurn).toBeUndefined();
  });

  it('턴 끝 답(end_turn)은 turnEnd — 세션 상태가 계속 작업 중으로 나와도 답이 끝난 걸 안다', () => {
    const end = line({ type: 'assistant', timestamp: 't3', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '다 됐어' }] } });
    expect(summarizeTranscript([user('t1', '해줘'), end].join('\n')).reply?.turnEnd).toBe(true);
    const mid = line({ type: 'assistant', timestamp: 't2', message: { stop_reason: 'tool_use', content: [{ type: 'text', text: '볼게' }] } });
    expect(summarizeTranscript([user('t1', '해줘'), mid].join('\n')).reply?.turnEnd).toBeUndefined();
  });

  // 2026-09-28: 붙여넣기 메시지는 "<pasted_content" 로 시작해 훅 주입으로 오해 → 지시 시각이 옛것으로 남아 음성이 저녁 내내 말을 이어 읽었다
  it('붙여넣은 메시지도 사람 지시다', () => {
    const t = summarizeTranscript(user('t9', '<pasted_content id="x">\n무언가\n</pasted_content id="x">\n이거 봐줘'));
    expect(t.prompt?.ts).toBe('t9');
  });

  it('빈 기록', () => {
    expect(summarizeTranscript('')).toMatchObject({});
  });
});

describe('askView — 결정 대기함에 띄울 물음(2026-09-27 사용자: 마크다운 기호가 그대로, 앞만 잘려 질문이 안 보였다)', () => {
  const reply = `맞아, 2번은 A31 실기기로 확인해야 해서 밖에선 못 해. 폰이 집 와이파이에 붙어 있어야 하거든.

그럼 이렇게 가자.
- **지금**: **1번 acme-shop 엠버서더 온보딩**부터 시킬게. 승인·승급 흐름을 점검하고 PR까지야
- **healing**: OTA를 올리는 것까진 밖에서도 돼. 그래서 집에 가서 하는 게 좋아

acme-shop 바로 시작할까?`;
  it('결론 첫 문장 + 마지막 질문, 마크다운 기호는 지운다', () => {
    expect(askView(reply)).toEqual({ lead: '맞아, 2번은 A31 실기기로 확인해야 해서 밖에선 못 해.', q: 'acme-shop 바로 시작할까?' });
  });
  it('질문이 목록 끝 줄이어도 기호 없이', () => {
    expect(askView('이렇게 할게.\n\n- **A**랑 `B` 중에 뭐로 할까?').q).toBe('A랑 B 중에 뭐로 할까?');
  });
  it('한 문장짜리면 lead 없이 질문만', () => {
    expect(askView('교체해도 될까?')).toEqual({ lead: '', q: '교체해도 될까?' });
  });
  it('답 기록에 실린다 — 물어볼 때만', () => {
    const line = (text: string) => JSON.stringify({ type: 'assistant', timestamp: 't', message: { content: [{ type: 'text', text }] } });
    expect(summarizeTranscript(line(reply)).reply?.ask?.q).toBe('acme-shop 바로 시작할까?');
    expect(summarizeTranscript(line('다 끝났어.')).reply?.ask).toBeUndefined();
  });
});

describe('도구 — 지금 뭘 하고 있나(사무실 행동·머리 위 한 줄)', () => {
  const tool = (name: string, input: object) => JSON.stringify({ type: 'assistant', timestamp: '2026-09-27T10:00:00Z', message: { content: [{ type: 'text', text: '볼게' }, { type: 'tool_use', name, input }] } });
  it('마지막 도구 이름 + 대상(파일 이름·명령 앞부분)', () => {
    expect(summarizeTranscript(tool('Edit', { file_path: '/a/b/ambassador.ts' })).tool).toEqual({ name: 'Edit', target: 'ambassador.ts', ts: '2026-09-27T10:00:00Z' });
    expect(summarizeTranscript(tool('Bash', { command: 'npm test -- --run src/x.test.ts' })).tool?.target).toBe('npm test -- --run…');
    expect(summarizeTranscript(tool('Grep', { pattern: 'approve' })).tool?.target).toBe('approve');
  });
  it('도구 뒤에 글 답이 오면 도구는 그대로 두되, 답 시각이 더 뒤', () => {
    const t = summarizeTranscript([tool('Read', { file_path: '/x/y.md' }), JSON.stringify({ type: 'assistant', timestamp: '2026-09-27T10:00:05Z', message: { content: [{ type: 'text', text: '끝' }] } })].join('\n'));
    expect(t.tool?.name).toBe('Read');
    expect(t.reply!.ts > t.tool!.ts).toBe(true);
  });
});

describe('workAct — 도구 → 사무실 행동', () => {
  it('고치기·읽기·실행·웹·분신·생각', () => {
    expect(workAct({ name: 'Edit', target: '', ts: '' })).toBe('type');
    expect(workAct({ name: 'Write', target: '', ts: '' })).toBe('type');
    expect(workAct({ name: 'Read', target: '', ts: '' })).toBe('read');
    expect(workAct({ name: 'Grep', target: '', ts: '' })).toBe('read');
    expect(workAct({ name: 'Bash', target: '', ts: '' })).toBe('run');
    expect(workAct({ name: 'WebSearch', target: '', ts: '' })).toBe('web');
    expect(workAct({ name: 'Agent', target: '', ts: '' })).toBe('agent');
    expect(workAct({ name: 'mcp__playwright__browser_click', target: '', ts: '' })).toBe('web');
    expect(workAct(undefined)).toBe('think');
  });
});

describe('summarizeTranscript — 넘기기 판단용(2026-09-30 한 프로젝트 오판)', () => {
  const tool = (ts: string, name: string) => line({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', name, input: {} }] } });
  it('마지막 SendMessage 시각을 남긴다(이미 참모에게 보고했는지)', () => {
    const t = [user('t1', '해줘'), tool('t2', 'SendMessage'), tool('t3', 'Bash'), asst('t4', '끝')].join('\n');
    expect(summarizeTranscript(t).messaged).toBe('t2');
  });
  it('답의 끝부분을 따로 남긴다 — 앞에서 자른 글엔 끝의 질문이 빠졌다', () => {
    const long = '앞부분 설명 '.repeat(40) + '사용자가 직접 인증 풀어야 해';
    const r = summarizeTranscript(asst('t1', long)).reply!;
    expect(r.tail?.endsWith('사용자가 직접 인증 풀어야 해')).toBe(true);
    expect(r.tail!.length).toBeLessThanOrEqual(201);
  });
});

describe('limit — 사용 한도로 멈춘 세션(대화 기록의 API 오류 줄, 2026-10-02)', () => {
  const err = (ts: string, text: string, error?: string) =>
    JSON.stringify({ type: 'assistant', timestamp: ts, isApiErrorMessage: true, ...(error ? { error } : {}), message: { model: '<synthetic>', content: [{ type: 'text', text }] } });
  const user = (ts: string, text: string) => JSON.stringify({ type: 'user', timestamp: ts, message: { content: text } });

  it('글로 잡는다 — "hit your … limit"(NAS 원문)', () => {
    const a = summarizeTranscript([user('2026-10-02T10:00:00Z', '고쳐줘'), err('2026-10-02T10:05:00Z', "You've hit your weekly limit · resets 11am (Asia/Seoul)")].join('\n'));
    expect(a.limit).toEqual({ ts: '2026-10-02T10:05:00Z', text: "You've hit your weekly limit · resets 11am (Asia/Seoul)" });
  });

  it('오류 종류로도 잡는다 — 문구가 바뀌어도', () => {
    const a = summarizeTranscript(err('2026-10-02T10:05:00Z', 'Claude AI usage cap · try later', 'rate_limit'));
    expect(a.limit?.ts).toBe('2026-10-02T10:05:00Z');
  });

  it('일시적 429·529·과부하는 한도가 아니다(Claude Code 가 다시 시도한다)', () => {
    expect(summarizeTranscript(err('t', 'API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.', 'server_error')).limit).toBeUndefined();
    expect(summarizeTranscript(err('t', 'API Error: 429 Too many requests — try again in a moment.', 'rate_limit')).limit).toBeUndefined();
  });

  it('API 오류 줄이 아니면 같은 글이어도 아니다(세션이 한도 얘기를 한 것)', () => {
    const a = summarizeTranscript(JSON.stringify({ type: 'assistant', timestamp: 't', message: { content: [{ type: 'text', text: "You've hit your session limit 문구를 잡아야 해" }] } }));
    expect(a.limit).toBeUndefined();
  });

  it('그 뒤에 새 줄(계속해 등)이 오면 멈춘 게 아니다', () => {
    const a = summarizeTranscript([err('2026-10-02T10:05:00Z', "You've hit your session limit · resets 3:45pm"), user('2026-10-02T10:06:00Z', '계속해')].join('\n'));
    expect(a.limit).toBeUndefined();
  });
});

describe('auth — 로그인이 풀려 멈춘 세션(2026-10-06 아이맥 참모 실측 원문)', () => {
  const err = (ts: string, text: string, error?: string) =>
    JSON.stringify({ type: 'assistant', timestamp: ts, isApiErrorMessage: true, ...(error ? { error } : {}), message: { model: '<synthetic>', content: [{ type: 'text', text }] } });
  const user = (ts: string, text: string) => JSON.stringify({ type: 'user', timestamp: ts, message: { content: text } });

  it('Login expired · Please run /login (error authentication_failed)', () => {
    const a = summarizeTranscript([user('2026-10-06T00:30:21Z', '클론해줘'), err('2026-10-06T00:30:22Z', 'Login expired · Please run /login', 'authentication_failed')].join('\n'));
    expect(a.auth).toEqual({ ts: '2026-10-06T00:30:22Z', text: 'Login expired · Please run /login' });
    expect(a.limit).toBeUndefined();
  });

  it('Not logged in · Please run /login — 오류 종류가 없어도 글로', () => {
    expect(summarizeTranscript(err('t', 'Not logged in · Please run /login')).auth?.ts).toBe('t');
    expect(summarizeTranscript(err('t', 'OAuth token has expired. Please obtain a new token or refresh your existing token.', 'authentication_failed')).auth?.ts).toBe('t');
  });

  it('갱신 겹침(server_error · Try again in a minute)은 로그인 풀림이 아니라 잠깐 뒤 다시(retry) — 실측 2026-09-27 project-b-g', () => {
    const t = 'Could not refresh your login because another Claude Code process is refreshing it (or exited mid-refresh) · Try again in a minute; if it keeps happening, close other Claude Code windows or sign in again with /login';
    expect(summarizeTranscript(err('t', t, 'server_error')).auth).toEqual({ ts: 't', text: t.slice(0, 240), retry: true });
  });

  it('API 오류 줄이 아니면(답 글에 문구를 인용) 아니다', () => {
    const a = summarizeTranscript(JSON.stringify({ type: 'assistant', timestamp: 't', message: { content: [{ type: 'text', text: '세션이 Login expired · Please run /login 으로 멈췄어' }] } }));
    expect(a.auth).toBeUndefined();
  });

  it('"다시 로그인함, 이어서" 뒤 또 같은 오류면 그 새 오류가 남는다(아이맥 00:30:31)', () => {
    const a = summarizeTranscript([
      err('2026-10-06T00:30:22Z', 'Login expired · Please run /login', 'authentication_failed'),
      user('2026-10-06T00:30:31Z', '로그인 오류로 멈췄었어(다시 로그인함). 하던 거 이어서 해줘.'),
      err('2026-10-06T00:30:31.8Z', 'Login expired · Please run /login', 'authentication_failed'),
    ].join('\n'));
    expect(a.auth?.ts).toBe('2026-10-06T00:30:31.8Z');
  });

  it('그 뒤에 정상 답이 오면 풀린 것이다', () => {
    const ok = JSON.stringify({ type: 'assistant', timestamp: '2026-10-06T00:31:39Z', message: { content: [{ type: 'text', text: '클론했어' }] } });
    expect(summarizeTranscript([err('2026-10-06T00:30:22Z', 'Login expired · Please run /login', 'authentication_failed'), ok].join('\n')).auth).toBeUndefined();
  });
});

describe('summarizeTranscript lastAt — 마지막 대화 줄 시각(꺼진 세션이 턴 중간이었나)', () => {
  const toolOnly = (ts: string) => line({ type: 'assistant', timestamp: ts, message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'gh pr checks' } }], stop_reason: 'tool_use' } });
  it('글 없는 도구 줄·다른 세션 메시지·작업 알림도 센다 — 답 뒤에 오면 답보다 늦다', () => {
    const a = summarizeTranscript([asst('2026-10-04T01:00:00Z', '다 했어'), user('2026-10-04T01:05:00Z', 'Another Claude session sent a message: 이것도'), toolOnly('2026-10-04T01:05:03Z')].join('\n'));
    expect(a.reply?.ts).toBe('2026-10-04T01:00:00Z');
    expect(a.lastAt).toBe('2026-10-04T01:05:03Z');
  });
  it('끝에 시스템 줄만 붙으면 답 시각 그대로', () => {
    const a = summarizeTranscript([asst('2026-10-04T01:00:00Z', '다 했어'), line({ type: 'system', subtype: 'stop_hook_summary', timestamp: '2026-10-04T01:00:01Z' }), line({ type: 'last-prompt' })].join('\n'));
    expect(a.lastAt).toBe('2026-10-04T01:00:00Z');
  });
  it('큐에 쌓인 입력(attachment)도 센다', () => {
    const a = summarizeTranscript([asst('2026-10-04T01:00:00Z', '다 했어'), line({ type: 'attachment', timestamp: '2026-10-04T01:02:00Z', attachment: { type: 'queued_command' } })].join('\n'));
    expect(a.lastAt).toBe('2026-10-04T01:02:00Z');
  });
});
