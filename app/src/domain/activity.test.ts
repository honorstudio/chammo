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
