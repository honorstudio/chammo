// 앱이 넘긴 줄([앱] …)도 '보낸 말'로 — 참모 입력칸에 앱이 친 줄이 실제로 가도 채팅엔 '안 갔어요'로 남아,
// 사용자가 다시 보내기를 눌러 같은 줄이 다섯 번 갔다(2026-10-10 개인 참모). 기록엔 그 줄이 사람 말이 아니라 '앱이 넘긴 줄'(relay)로 잡힌다
import { describe, expect, it } from 'vitest';
import { alreadySent, parseChat, pendingLeft, sentByMe } from './chat';
import { againPlan, autoEnterTarget, DUP_CONFIRM, emptyQueue, inputLeftover, mineForLeftover, pendingState } from './chatQueue';

const L = (o: object) => JSON.stringify(o);
const APP = '[앱] demo / feature-x 세션(ab12cd34)이 2분째 답을 기다려 — 마지막 말: "… 시험 다 돌렸어. 진행 상황: - 화면 두 개 고침 - 커밋 2개" — 되돌리기 쉬운 건 네가 답하고(SendMessage), 사람이 정할 거면 물어봐';
// 채팅이 터미널 화면에서 읽은 같은 줄 — 칸 폭에서 접혀 줄바꿈이 들어 있다
const WRAPPED = APP.replace('마지막 말: ', '마지막 말:\n').replace('- 화면', '-\n화면').replace('답하고(SendMessage),', '답하고(SendMessage),\n');
const T0 = Date.parse('2026-10-10T11:23:20Z');
const asUser = (ts: string, text: string) => L({ type: 'user', uuid: `u-${ts}`, timestamp: ts, message: { role: 'user', content: text } });
const asQueued = (ts: string, text: string) => L({ type: 'attachment', uuid: `q-${ts}`, timestamp: ts, attachment: { type: 'queued_command', prompt: text, origin: { kind: 'human' } } });

describe('pendingLeft — 앱이 넘긴 줄도 기록에 들어오면 보내는 중에서 빠진다', () => {
  it('쉬는 세션에 간 것(user 줄) — 화면에서 접혀 읽힌 글이어도', () => {
    const items = parseChat(asUser('2026-10-10T11:23:25Z', APP));
    expect(items[0]?.kind).toBe('relay');
    expect(pendingLeft([{ text: WRAPPED, at: T0 }], items)).toEqual([]);
    expect(pendingLeft([{ text: APP, at: T0 }], items)).toEqual([]);
  });
  it('일하는 중에 줄 섰다 들어간 것(queued_command)', () => {
    const items = parseChat(asQueued('2026-10-10T11:23:31Z', APP));
    expect(pendingLeft([{ text: WRAPPED, at: T0 }], items)).toEqual([]);
  });
  it('다른 세션이 보낸 말은 내 말이 아니다 — 글이 같아도 안 맞춘다', () => {
    const peer = `<cross-session-message from="x" from-name="demo">${APP.slice(5)}</cross-session-message>`;
    expect(pendingLeft([{ text: APP, at: T0 }], parseChat(asUser('2026-10-10T11:23:25Z', peer)))).toHaveLength(1);
  });
});

describe('sentByMe — 내가(채팅·앱) 보낸 말 목록', () => {
  it('사람 말 그대로 + 앱이 넘긴 줄은 [앱] 머리말을 붙여 원래 글로', () => {
    const items = parseChat([asUser('2026-10-10T11:20:00Z', '안녕'), asUser('2026-10-10T11:23:25Z', APP)].join('\n'));
    expect(sentByMe(items).map((x) => x.text)).toEqual(['안녕', APP]);
  });
  it('Esc 로 끊겨 입력칸에 되돌아온 앱 줄도 내 말로 알아본다(새 말과 한 말로 붙어 가지 않게)', () => {
    const items = parseChat(asUser('2026-10-10T11:23:25Z', APP));
    expect(inputLeftover(WRAPPED, mineForLeftover(sentByMe(items)))).toEqual([APP]);
  });
});

describe('alreadySent·againPlan — 이미 간 글을 또 보내려 하면 한 번 막는다', () => {
  const items = parseChat(asUser('2026-10-10T11:23:25Z', APP));
  it('그 시각 뒤 기록에 같은 글이 있으면 이미 간 것', () => {
    expect(alreadySent(WRAPPED, items, T0)).toBe(true);
    expect(alreadySent(WRAPPED, items, Date.parse('2026-10-10T11:24:00Z'))).toBe(false);
    expect(alreadySent('다른 말', items, T0)).toBe(false);
  });
  it('처음 누르면 막고(warn), 곧 한 번 더 누르면 보낸다', () => {
    const now = Date.parse('2026-10-10T11:28:00Z');
    expect(againPlan(WRAPPED, items, now, null)).toBe('warn');
    expect(againPlan(WRAPPED, items, now + 2000, { text: WRAPPED, at: now })).toBe('send');
    expect(againPlan(WRAPPED, items, now + DUP_CONFIRM + 1, { text: WRAPPED, at: now })).toBe('warn');
  });
  it('아직 안 간 글·오래전에 간 글은 그냥 보낸다', () => {
    expect(againPlan('새 말', items, Date.parse('2026-10-10T11:28:00Z'), null)).toBe('send');
    expect(againPlan(APP, items, Date.parse('2026-10-10T12:30:00Z'), null)).toBe('send');
  });
});

describe('앱이 친 줄이 입력칸에 걸렸을 때 — 채팅이 보낸 말로 알면 Enter 를 다시 넣는다', () => {
  // 앱 줄의 Enter 가 줄바꿈으로 먹혀 참모 입력칸에 10분 걸려 있었다(2026-10-10). sendToSession 이 다 친 뒤 채팅에 '보낸 말'로 알린다
  it('화면에서 접혀 읽힌 입력칸 글과 앱이 친 원래 줄을 같은 말로 본다', () => {
    const p = { text: APP, at: T0 };
    const c = { queue: emptyQueue, termText: WRAPPED, now: T0 + 3000, enterWait: 400 };
    expect(pendingState(p, c)).toBe('input');
    expect(autoEnterTarget([p], { ...c, tries: {} })).toBe(APP);
  });
});
