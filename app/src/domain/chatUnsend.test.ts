// 보낸 말에 참모가 아직 아무 기록(생각·도구·글)도 안 남긴 동안 Esc 가 가면 Claude Code 는 '멈춤'이 아니라 '보낸 말 거둬들이기'로 받는다 —
// 그 말을 입력칸에 되돌리고, 기록엔 버려진 갈래(다음 말과 같은 부모의 user 줄)로 남긴다(Claude Code 2.1.301 시험 세션 실측, 2026-10-16).
// 사용자 채팅엔 그 말이 보통 말풍선 + '안 갔어요' 말풍선으로 두 번 보였고 참모는 못 받았다(2026-10-16 22:56 참모-2)
import { describe, expect, it } from 'vitest';
import { appendChat, chatEscStops, escUnsends, parseChat } from './chat';

const line = (o: object) => JSON.stringify(o);
const user = (uuid: string, parent: string, content: unknown, extra: object = {}) => line({ type: 'user', uuid, parentUuid: parent, timestamp: `t-${uuid}`, message: { role: 'user', content }, ...extra });
const asst = (uuid: string, parent: string, content: unknown[]) => line({ type: 'assistant', uuid, parentUuid: parent, timestamp: `t-${uuid}`, message: { role: 'assistant', content } });
const att = (uuid: string, parent: string, attachment: object) => line({ type: 'attachment', uuid, parentUuid: parent, timestamp: `t-${uuid}`, attachment });
const sys = (uuid: string, parent: string) => line({ type: 'system', subtype: 'turn_duration', uuid, parentUuid: parent, timestamp: `t-${uuid}` });
const text = (t: string) => ({ type: 'text', text: t });

// 실제 기록 모양(글은 지어낸 것): 턴 끝 → 첫 말(부모 s1) → 훅 첨부 → Esc 로 거둬들임(기록엔 흔적 없음) → 다음 말(같은 부모 s1)
const turnEnd = [user('u0', 'x0', '카드 하나 만들어 줘'), asst('a0', 'u0', [text('만들었어')]), sys('s1', 'a0')];
const first = [user('u1', 's1', '움직이는 표시가 너무 빨라?'), att('h1', 'u1', { type: 'hook_success' })];
const second = [user('u2', 's1', '안 보이는데?'), att('h2', 'u2', { type: 'hook_success' })];
const users = (items: ReturnType<typeof parseChat>) => items.filter((i) => i.kind === 'user').map((i) => (i as { text: string }).text);

describe('거둬들인 말 — 버려진 갈래의 user 줄은 말풍선에서 뺀다', () => {
  it('재현: 같은 부모의 다음 말이 오면 앞 말은 참모에게 안 간 것 — 보통 말풍선으로 남기지 않는다', () => {
    expect(users(parseChat([...turnEnd, ...first, ...second].join('\n')))).toEqual(['카드 하나 만들어 줘', '안 보이는데?']);
  });
  it('이어 읽기(appendChat)로 나중에 와도 뺀다', () => {
    const a = parseChat([...turnEnd, ...first].join('\n'));
    expect(users(a)).toEqual(['카드 하나 만들어 줘', '움직이는 표시가 너무 빨라?']);
    expect(users(appendChat(a, second.join('\n')))).toEqual(['카드 하나 만들어 줘', '안 보이는데?']);
  });
  it('앞 말을 거둬들여 이어 친 말(앞 말 + 새 말)도 앞 말 한 번만 남는다', () => {
    const merged = [user('u2', 's1', '움직이는 표시가 너무 빨라?그리고 하나 더')];
    expect(users(parseChat([...turnEnd, ...first, ...merged].join('\n')))).toEqual(['카드 하나 만들어 줘', '움직이는 표시가 너무 빨라?그리고 하나 더']);
  });
  it('부모가 다르면(보통 이어진 대화) 그대로', () => {
    const t = [...turnEnd, ...first, asst('a1', 'h1', [text('응')]), sys('s2', 'a1'), user('u2', 's2', '안 보이는데?')].join('\n');
    expect(users(parseChat(t))).toEqual(['카드 하나 만들어 줘', '움직이는 표시가 너무 빨라?', '안 보이는데?']);
  });
});

describe('escUnsends — 지금 Esc 를 넘기면 방금 보낸 말을 거둬들이나', () => {
  it('재현: 보낸 말이 기록에 붙었고 참모가 아직 아무것도 안 냈다 → 거둬들인다', () => {
    expect(escUnsends(parseChat([...turnEnd, ...first].join('\n')), false)).toBe(true);
  });
  it('생각 줄 하나라도 붙었으면(말풍선은 없어도) 그 뒤 Esc 는 멈춤이다', () => {
    const t = [...turnEnd, ...first, asst('a1', 'h1', [{ type: 'thinking', thinking: '...' }])].join('\n');
    expect(escUnsends(parseChat(t), false)).toBe(false);
  });
  it('이어 읽기로 생각 줄이 와도(새 말풍선 없음) 알아본다', () => {
    const a = parseChat([...turnEnd, ...first].join('\n'));
    const b = appendChat(a, asst('a1', 'h1', [{ type: 'thinking', thinking: '...' }]));
    expect(escUnsends(b, false)).toBe(false);
  });
  it('도구가 도는 중이면 멈춤', () => {
    const t = [...turnEnd, ...first, asst('a1', 'h1', [{ type: 'tool_use', name: 'Bash', input: { command: 'sleep 9' } }])].join('\n');
    expect(escUnsends(parseChat(t), false)).toBe(false);
  });
  it('일하는 중 줄 섰다 흡수된 말(queued_command)이 끝 항목이어도 멈춤 — 턴은 이미 돌고 있다', () => {
    const t = [...turnEnd, ...first, asst('a1', 'h1', [{ type: 'tool_use', name: 'Bash', input: {} }]), user('r1', 'a1', [{ type: 'tool_result', content: '' }]),
      att('q1', 'r1', { type: 'queued_command', prompt: '하나 더', origin: { kind: 'human' } })].join('\n');
    const items = parseChat(t);
    expect(items[items.length - 1]).toMatchObject({ kind: 'user', text: '하나 더' });
    expect(escUnsends(items, false)).toBe(false);
  });
  it('턴이 끝난 뒤 보낸 말이 아직 기록 전(훅 도는 중)이면 거둬들인다 — 쉬는 데 보낸 말은 새 턴을 연다', () => {
    const items = parseChat(turnEnd.join('\n'));
    expect(escUnsends(items, true)).toBe(true);
    expect(escUnsends(items, false)).toBe(false);
  });
  it('앱이 친 줄([앱] …)도 보낸 말과 같다', () => {
    expect(escUnsends(parseChat([...turnEnd, user('u1', 's1', '[앱] 세션이 멈췄어')].join('\n')), false)).toBe(true);
  });
});

describe('chatEscStops — 거둬들이게 되는 때는 Esc 를 안 넘긴다', () => {
  const base = { key: 'Escape', composing: false, prevented: false, working: true, overlay: false, inInput: true, review: false };
  it('재현: 일하는 중으로 보여도 보낸 말에 아직 답이 없으면 넘기지 않는다(입력칸·입력칸 밖 둘 다)', () => {
    expect(chatEscStops({ ...base, unsends: true })).toBe(false);
    expect(chatEscStops({ ...base, inInput: false, unsends: true })).toBe(false);
    expect(chatEscStops({ ...base, unsends: false })).toBe(true);
  });
});
