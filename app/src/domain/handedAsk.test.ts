import { describe, expect, it } from 'vitest';
import type { ChatItem } from './chat';
import { chatWoke, gaveTo, giverTurn, handedTurn, quietHanded } from './handedAsk';
import { waitingList } from './mobile';
import type { Session } from './session';
import type { TaskEvent } from './tasks';

// 2026-10-28 사용자 제보: 비서에게 시켰는데 영업 담당(넘겨받은 참모)이 직접 물어 같은 걸 두 번 답했다.
// 재현 — 비서가 scripts/task send 로 영업 담당에게 맡기고 SendMessage, 영업 담당은 그 말로 깬 턴을 "재배포해도 될까?"로 끝냈다
const NOW = Date.parse('2026-10-28T03:06:00Z');
const ev = (e: Partial<TaskEvent>): TaskEvent => ({ ts: '2026-10-28T03:00:00Z', type: 'send', task: 't1', ...e }) as TaskEvent;
const toSales = ev({ target: '참모-8 · 영업 담당', from: 'aaaa1111', fromName: '참모' });
const handover = ev({ type: 'handover', task: 'h-1', target: '참모-2 · 디자인', toName: '참모-2', toId: 'bbbb2222', fromName: '참모' });
const SECRETARY = '참모 · 비서';
const SALES = '참모-8 · 영업 담당';

describe('gaveTo — 둘 사이 마지막 넘김의 방향(넘김·참모에게 보낸 send)', () => {
  it('넘긴 쪽 → 받은 쪽만 참', () => {
    expect(gaveTo([toSales], '참모', '참모-8', NOW)).toBe(true);
    expect(gaveTo([toSales], '참모-8', '참모', NOW)).toBe(false);
    expect(gaveTo([handover], '참모', '참모-2', NOW)).toBe(true);
  });
  it('뒤집혀 넘기면 마지막 것', () => {
    const back = ev({ ts: '2026-10-28T03:05:00Z', target: '참모 · 비서', fromName: '참모-8' });
    expect(gaveTo([toSales, back], '참모', '참모-8', NOW)).toBe(false);
  });
  it('7일 넘은 기록·상관없는 참모는 안 본다', () => {
    expect(gaveTo([{ ...toSales, ts: '2026-10-01T00:00:00Z' }], '참모', '참모-8', NOW)).toBe(false);
    expect(gaveTo([toSales], '참모', '참모-5', NOW)).toBe(false);
  });
});

describe('handedTurn — 일을 넘긴 참모의 말로만 깬 턴(같은 판단: voice fromOrchTurn + 넘김 방향)', () => {
  it('재현: 영업 담당이 비서 말로 깬 턴 → 참', () => {
    expect(handedTurn([SECRETARY], SALES, [toSales], NOW)).toBe(true);
  });
  it('넘긴 쪽(비서)이 받은 쪽 질문으로 깬 턴은 거짓 — 모아서 사람에게 한 번 묻는 길', () => {
    expect(handedTurn([SALES], SECRETARY, [toSales], NOW)).toBe(false);
  });
  it('사람·하위 세션 회신이 섞였거나 넘긴 기록이 없으면 거짓(질문을 잃는 것보다 두 번 보이는 게 낫다)', () => {
    expect(handedTurn([SECRETARY, ''], SALES, [toSales], NOW)).toBe(false);
    expect(handedTurn([SECRETARY, 'shop-app'], SALES, [toSales], NOW)).toBe(false);
    expect(handedTurn(undefined, SALES, [toSales], NOW)).toBe(false);
    expect(handedTurn([SECRETARY], SALES, [], NOW)).toBe(false);
  });
});

describe('quietHanded — 받은 쪽 답 끝 질문은 사람 몫이 아니다(결정 대기함·알림·상태가 이 활동을 본다)', () => {
  const asking = { reply: { ts: 't9', text: '재배포해도 될까?', asks: true, turnEnd: true, woke: [SECRETARY], ask: { lead: '', q: '재배포해도 될까?' } } };
  it('묻지 않은 답으로 바꾼다', () => {
    const a = quietHanded(asking, SALES, [toSales], NOW);
    expect(a.reply?.asks).toBe(false);
    expect(a.reply?.ask).toBeUndefined();
    expect(a.reply?.text).toBe('재배포해도 될까?');
  });
  it('넘긴 쪽·사람이 깬 턴은 그대로(같은 객체)', () => {
    expect(quietHanded(asking, SECRETARY, [toSales], NOW)).toBe(asking);
    const human = { reply: { ...asking.reply, woke: undefined } };
    expect(quietHanded(human, SALES, [toSales], NOW)).toBe(human);
  });
});

describe('chatWoke — 폰 대화 목록에서 마지막 턴을 깨운 쪽', () => {
  const relay = (from: string): ChatItem => ({ kind: 'relay', id: from, ts: 't', from, text: '봐 줘' });
  const said = (text: string): ChatItem => ({ kind: 'assistant', id: text, ts: 't', text });
  const tools: ChatItem = { kind: 'tools', id: 'x', ts: 't', tools: [] };
  it('앞 턴 답 뒤의 다른 세션 말들', () => {
    expect(chatWoke([said('앞 턴'), relay(SECRETARY), tools, said('중간'), tools, said('될까?')])).toEqual([SECRETARY]);
  });
  it('사람 말은 빈 이름', () => {
    expect(chatWoke([said('앞'), { kind: 'user', id: 'u', ts: 't', text: '해 줘' }, said('될까?')])).toEqual(['']);
  });
  it('답이 없으면 없음', () => expect(chatWoke([relay(SECRETARY)])).toBeUndefined());
});

describe('waitingList — 폰 대기 카드도 같은 판단', () => {
  const orch = (id: string, name: string) => ({ id, name, state: 'idle' }) as Session;
  it('받은 쪽 물음은 빼고 넘긴 쪽 물음은 둔다', () => {
    const asks = { a: { ts: 't1', lead: '', q: '재배포해도 될까?', woke: [SECRETARY] }, b: { ts: 't2', lead: '', q: '머지할까?', woke: [SALES] } };
    const w = waitingList([orch('a', SALES), orch('b', SECRETARY)], asks, [toSales], NOW);
    expect(w.map((x) => x.orch)).toEqual(['b']);
  });
});

describe('giverTurn — 이 참모가 일을 넘긴 참모들의 말로만 깬 턴(음성: 버리지 않는 참모끼리 턴, 기록 없으면 거짓 = 조용히)', () => {
  it('넘긴 쪽이 받은 쪽 말로 깬 턴만 참', () => {
    expect(giverTurn([SALES], SECRETARY, [toSales], NOW)).toBe(true);
    expect(giverTurn([SECRETARY], SALES, [toSales], NOW)).toBe(false);
  });
  it('기록 없음·사람 섞임·깬 말 없음은 거짓', () => {
    expect(giverTurn([SALES], SECRETARY, [], NOW)).toBe(false);
    expect(giverTurn([SALES, ''], SECRETARY, [toSales], NOW)).toBe(false);
    expect(giverTurn(undefined, SECRETARY, [toSales], NOW)).toBe(false);
  });
});
