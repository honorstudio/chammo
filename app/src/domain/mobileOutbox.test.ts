import { describe, expect, it } from 'vitest';
import { parseChat, type ChatItem } from './chat';
import mobileChat from '../ui/mobile/useMobileChat.ts?raw';
import outboxUi from '../ui/mobile/outbox.ts?raw';
import { addOut, applyStatus, beforeTail, CHECK_AFTER, findEarlier, LOST_AFTER, outPending, retryOut, LOOKBACK_PAGES, newOut, dueForCheck, labelCounts, markOut, OUTBOX_TTL, readDraft, readOutbox, settleOut, writeDraft, writeOutbox, type OutMsg } from './mobileOutbox';

/** localStorage 흉내 — 화면을 새로 그려도(참모 바꾸기 = OrchSpace 다시 마운트) 남는 저장소 */
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};
const u = (id: string, ts: string, text: string): ChatItem => ({ kind: 'user', id, ts, text });
const T = Date.parse('2026-10-03T05:20:00Z');

describe('보내는 중 말풍선 — 참모를 바꿨다 와도 남는다(2026-10-03 사용자 "보내는 중이던 말풍선 사라졌네")', () => {
  it('재현: 보낸 뒤 화면을 새로 그려도(저장소에서 다시 읽어도) 보내는 중으로 남는다', () => {
    const s = mem();
    const list = addOut([], { id: 'm1', session: 'orchA', text: '잔뜩 써 논 지시', at: T });
    writeOutbox(s, list);
    // 참모 B 로 갔다가 A 로 돌아옴 = 새로 읽기
    const back = readOutbox(s, T + 60_000);
    // sending·sent 는 화면에선 둘 다 '보내는 중' — 실패만 다시 보내기
    expect(back.map((x) => [x.session, x.text, x.status === 'failed'])).toEqual([['orchA', '잔뜩 써 논 지시', false]]);
  });
  it('보내다 끊긴 채 다시 연 것(sending)은 실패로 바꾸지 않는다 — 서버가 받았을 수 있으니 기록을 기다린다', () => {
    const s = mem();
    writeOutbox(s, [{ id: 'm1', session: 'a', text: 'x', at: T, status: 'sending' }]);
    expect(readOutbox(s, T + 1000)[0]!.status).toBe('sent');
  });
  it('너무 오래된(하루 가까이) 것도 안 버린다 — 전해지지 않음으로 남겨 사람이 고른다, 실패한 건 그대로', () => {
    const s = mem();
    writeOutbox(s, [
      { id: 'old', session: 'a', text: 'x', at: T, status: 'sent' },
      { id: 'bad', session: 'a', text: 'y', at: T, status: 'failed' },
    ]);
    const back = readOutbox(s, T + OUTBOX_TTL + 1);
    expect(back.map((x) => [x.id, x.status])).toEqual([['old', 'failed'], ['bad', 'failed']]);
    expect(back[1]!.lost).toBeUndefined();
  });
  it('저장소가 깨졌거나 없으면 빈 목록(사파리 개인 정보 보호 모드)', () => {
    const s = mem();
    s.setItem('m.outbox', '{깨진');
    expect(readOutbox(s, T)).toEqual([]);
    expect(readOutbox(null, T)).toEqual([]);
    const thrower = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => {} };
    expect(readOutbox(thrower, T)).toEqual([]);
    expect(() => writeOutbox(thrower, [])).not.toThrow();
  });
});

describe('settleOut — 대화 기록에 실제로 들어오면 그때 지운다', () => {
  const base: OutMsg[] = [
    { id: 'm1', session: 'a', text: '첫째', at: T, status: 'sent' },
    { id: 'm2', session: 'b', text: '둘째', at: T, status: 'sent' },
  ];
  it('그 세션 기록에 들어온 것만 빠진다(다른 세션 것은 그대로)', () => {
    const out = settleOut(base, 'a', [u('x', '2026-10-03T05:20:02Z', '첫째')], T + 5000);
    expect(out.map((x) => x.id)).toEqual(['m2']);
  });
  it('방금 들어간 같은 글을 몇 초 뒤 또 보내면 앞 말 기록에 짝지어져 사라지지 않는다 — 이번 말이 들어와야 지운다(2026-10-11 bug-hunt)', () => {
    const before = [u('x', '2026-10-03T05:19:56Z', 'ㄱㄱ')];
    const list = addOut([], newOut({ id: 'm9', session: 'a', text: 'ㄱㄱ' }, before, T));
    expect(settleOut(list, 'a', before, T + 5000).map((x) => x.id)).toEqual(['m9']);
    expect(settleOut(list, 'a', [...before, u('y', '2026-10-03T05:20:01Z', 'ㄱㄱ')], T + 5000)).toEqual([]);
  });
  it('안 들어왔으면 같은 배열을 돌려준다(다시 그리기·저장 안 하게)', () => {
    expect(settleOut(base, 'a', [], T)).toBe(base);
  });
  it('실패로 보였어도 기록에 들어왔으면 지운다(서버 응답만 늦은 경우)', () => {
    const list = markOut(base, 'm1', 'failed', 'HTTP 502');
    expect(settleOut(list, 'a', [u('x', '2026-10-03T05:20:02Z', '첫째')], T + 5000).map((x) => x.id)).toEqual(['m2']);
  });
});

describe('markOut — 다시 보내기', () => {
  it('실패 → 보내는 중. 보낸 때는 그대로 — 같은 말이라 먼저 들어간 기록과도 맞춰져야 한다(응답만 못 받은 경우)', () => {
    const list = markOut([{ id: 'm1', session: 'a', text: 'x', at: T, status: 'failed', error: 'e' }], 'm1', 'sending');
    expect(list[0]).toEqual({ id: 'm1', session: 'a', text: 'x', at: T, status: 'sending' });
  });
});

describe('기록에 안 뜬 말 확인(Load failed 뒤 — 2026-10-03)', () => {
  const sent: OutMsg = { id: 'm1', session: 'a', text: 'x', at: T, status: 'sent' };
  it('보낸 지 15초 지나도 기록에 없으면 맥에 물어본다 — 15초에 한 번', () => {
    expect(dueForCheck(sent, T + 14_000)).toBe(false);
    expect(dueForCheck(sent, T + 16_000)).toBe(true);
    expect(dueForCheck({ ...sent, checked: T + 61_000 }, T + 70_000)).toBe(false);
    expect(dueForCheck({ ...sent, checked: T + 61_000 }, T + 77_000)).toBe(true);
    expect(dueForCheck({ ...sent, status: 'failed' }, T + 99_000)).toBe(false);
  });
  it('맥 답: 쳤거나 치는 중이면 계속 기다림, 실패·모름이면 다시 보내기', () => {
    const list = [sent];
    expect(applyStatus(list, 'm1', 'done', undefined, T + 61_000, true)[0]).toMatchObject({ status: 'sent', checked: T + 61_000 });
    expect(applyStatus(list, 'm1', 'failed', 'attach failed', T + 61_000, true)[0]).toMatchObject({ status: 'failed', error: 'attach failed' });
    expect(applyStatus(list, 'm1', 'unknown', undefined, T + 61_000, true)[0]).toMatchObject({ status: 'failed', error: '전해지지 않았어요' });
  });
  it('맥이 못 들어갔다고 하면(입력칸에 남음·선택 창) 15초 만에 다시 보내기 — 모름은 60초 전엔 기다린다(2026-11-06 12:12 그림 4장 말)', () => {
    const list = [sent];
    expect(applyStatus(list, 'm1', 'failed', '대화창에 들어가지 못했어요', T + 16_000, false)[0]).toMatchObject({ status: 'failed', error: '대화창에 들어가지 못했어요' });
    expect(applyStatus(list, 'm1', 'unknown', undefined, T + 16_000, true)[0]).toMatchObject({ status: 'sent', checked: T + 16_000 });
    expect(applyStatus(list, 'm1', 'done', undefined, T + 16_000, true, T)[0]).toMatchObject({ status: 'sent' });
  });
  it('모름이 와도 대화 기록을 아직 다 못 봤으면(꼬리 앞 찾기 전·채팅을 안 열었음) 실패로 안 바꾸고 기다린다 — 맥이 실패라고 한 것은 바로', () => {
    const list = [sent];
    expect(applyStatus(list, 'm1', 'unknown', undefined, T + 61_000, false)[0]).toMatchObject({ status: 'sent', checked: T + 61_000 });
    expect(applyStatus(list, 'm1', 'failed', 'attach failed', T + 61_000, false)[0]).toMatchObject({ status: 'failed', error: 'attach failed' });
  });
});

describe('맥이 쳤다는데 기록에 없는 말 — 입력칸에 남은 말(2026-11-04 사용자 폰, 10시간 생각 중)', () => {
  const sent: OutMsg = { id: 'm1', session: 'a', text: '아니 그냥 결과 나한테', at: T, status: 'sent' };
  const IDLE = T + 5_000;
  it('재현: 쉬는 세션에서 쳤다(done)는 말이 기록에 끝내 없으면 실패로 — 다시 보내기가 뜨고 생각 중이 꺼진다', () => {
    expect(applyStatus([sent], 'm1', 'done', undefined, IDLE + 61_000, true, IDLE)[0]).toMatchObject({ status: 'failed', error: '전해지지 않았어요', lost: true });
  });
  it('일하는 중(idleSince 없음)이면 줄 서 있을 수 있어 LOST_AFTER 까지 기다린다 — 끼어든 말은 늦게 적힌다', () => {
    expect(applyStatus([sent], 'm1', 'done', undefined, T + LOST_AFTER - 1, true)[0]).toMatchObject({ status: 'sent' });
  });
  it('막 쉬기 시작했거나 기록을 다 못 봤으면 아직 기다린다', () => {
    expect(applyStatus([sent], 'm1', 'done', undefined, IDLE + 59_000, true, IDLE)[0]).toMatchObject({ status: 'sent' });
    expect(applyStatus([sent], 'm1', 'done', undefined, IDLE + 61_000, false, IDLE)[0]).toMatchObject({ status: 'sent' });
  });
  it('입력칸에 남았던 말을 다시 보내면 새 말 id 로 — 맥은 쳤다고 기억한 id 를 다시 안 친다. 보낸 때도 새로', () => {
    const lost = applyStatus([sent], 'm1', 'done', undefined, IDLE + 61_000, true, IDLE);
    const { list, id } = retryOut(lost, 'm1', 'm2', T + 100_000);
    expect(id).toBe('m2');
    expect(list[0]).toMatchObject({ id: 'm2', status: 'sending', at: T + 100_000 });
    expect(list[0]).not.toHaveProperty('lost');
    expect(list[0]).not.toHaveProperty('error');
  });
  it('맥이 실패라 한 말은 같은 id 로 — 맥이 이미 쳤으면 두 번 안 친다', () => {
    const failed = applyStatus([sent], 'm1', 'failed', 'x', T + 61_000, false);
    const { list, id } = retryOut(failed, 'm1', 'm2', T + 100_000);
    expect(id).toBe('m1');
    expect(list[0]).toMatchObject({ id: 'm1', status: 'sending', at: T });
  });
});

describe('쓰던 글 — 참모마다 따로 기억', () => {
  it('재현: 참모 A 에 쓰던 글이 B 로 갔다 와도 남는다', () => {
    const s = mem();
    writeDraft(s, 'A', { text: '반쯤 쓴 글', files: [] });
    writeDraft(s, 'B', { text: '다른 글', files: [] });
    expect(readDraft(s, 'A').text).toBe('반쯤 쓴 글');
    expect(readDraft(s, 'B').text).toBe('다른 글');
  });
  it('붙인 파일(경로·이름표)도 같이 — 비우면 저장소에서 지운다', () => {
    const s = mem();
    const f = { path: '/d/attach/1-phone.png', name: 'a.png', image: true, label: '@img1' };
    writeDraft(s, 'A', { text: '@img1 봐 줘', files: [f] });
    expect(readDraft(s, 'A').files).toEqual([f]);
    writeDraft(s, 'A', { text: ' ', files: [] });
    expect(s.m.size).toBe(0);
  });
  it('말풍선·일·목표 참조(#chat1·#task1)도 같이 — 참조만 남아도 지우지 않는다(2026-10-23 사용자 폰)', () => {
    const s = mem();
    const r = { label: '#task1', who: '일', text: '로그인 (task t1, app, 끝)' };
    writeDraft(s, 'A', { text: '', files: [], refs: [r] });
    expect(readDraft(s, 'A')).toEqual({ text: '', files: [], refs: [r] });
    writeDraft(s, 'A', { text: '', files: [], refs: [] });
    expect(s.m.size).toBe(0);
  });
  it('없거나 깨졌으면 빈 글', () => {
    const s = mem();
    s.setItem('m.draft.A', '[1,2');
    expect(readDraft(s, 'A')).toEqual({ text: '', files: [] });
    expect(readDraft(null, 'A')).toEqual({ text: '', files: [] });
  });
  it('labelCounts — 되살린 파일 이름표 다음 번호부터(@img2 가 있으면 다음은 @img3)', () => {
    expect(labelCounts([{ label: '@img2' }, { label: '@file1' }, { label: '@img1' }])).toEqual({ img: 2, file: 1 });
    // 지금 이름표는 #img1 — @ 만 읽어 되살린 뒤 붙인 그림이 다시 #img1 이 됐다(2026-10-21 리뷰)
    expect(labelCounts([{ label: '#img1' }, { label: '#img2' }, { label: '#file1' }])).toEqual({ img: 2, file: 1 });
    expect(labelCounts([])).toEqual({ img: 0, file: 0 });
  });
});

describe('꼬리 밖으로 밀린 말 — 밤새 일한 뒤 아침에 열면 갔던 말이 "못 받았어요"로 남았다(2026-10-11 사용자 폰)', () => {
  // 진짜 기록 모양: 바쁜 세션에 보낸 말은 queue-operation 으로 줄 섰다가 몇 초 뒤 promptSource queued 사람 말로 적힌다
  const qop = (ts: string, text: string) => JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: ts, sessionId: 's-1', content: text });
  const human = (uuid: string, ts: string, text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text }, uuid, timestamp: ts, origin: { kind: 'human' }, promptSource: 'queued', sessionId: 's-1' });
  const bot = (uuid: string, ts: string, text: string) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, uuid, timestamp: ts, sessionId: 's-1' });
  const SENT = Date.parse('2026-10-10T17:34:05Z');
  const TEXT = '자러 갈게 계속 해 줘';
  // 아침에 연 폰이 읽은 꼬리 — 밤새 쌓인 기록이라 그 말(17:34)은 꼬리(00:00~) 앞에 있다
  const tail = parseChat([bot('t1', '2026-10-11T00:00:01Z', '아침 정리'), bot('t2', '2026-10-11T00:02:00Z', '다 했어')].join('\n'));
  const TAIL_START = 900_000; // 꼬리 첫 줄의 파일 자리(바이트)
  // 꼬리 앞 기록 — 512KB 씩 거슬러 읽는 두 묶음
  const pages: Record<number, { text: string; start: number }> = {
    [TAIL_START]: { text: [bot('p1', '2026-10-10T20:00:00Z', '밤 일 중간'), bot('p2', '2026-10-10T23:00:00Z', '밤 일 끝')].join('\n'), start: 400_000 },
    400_000: { text: [bot('o1', '2026-10-10T17:30:00Z', '하던 일'), qop('2026-10-10T17:34:05.752Z', TEXT), human('o2', '2026-10-10T17:34:10.833Z', TEXT), bot('o3', '2026-10-10T17:35:00Z', '알겠어')].join('\n'), start: 0 },
  };
  const reader = () => {
    const calls: number[] = [];
    return { calls, read: async (before: number) => { calls.push(before); const p = pages[before]; if (!p) throw new Error(`no page ${before}`); return p; } };
  };
  // 보낸 뒤 화면이 꺼져(잠) 기록을 못 봤고, 아침에 맥에 물으니 '모름'(맥 앱이 다시 켜졌거나 10분 기억이 지남) → 실패 카드
  const failed = applyStatus(
    [{ ...newOut({ id: 'm1', session: 'orchA', text: TEXT }, [], SENT), status: 'sent' as const }],
    'm1', 'unknown', undefined, Date.parse('2026-10-11T00:03:00Z'), true, // 옛 판은 기록을 안 보고 바로 실패로 바꿨다
  );
  const MORNING = Date.parse('2026-10-11T00:03:10Z');

  it('재현: 꼬리만 보면 그 말이 안 보여 실패 카드가 그대로 남는다 — 그래서 꼬리 앞을 봐야 한다', () => {
    expect(failed[0]).toMatchObject({ status: 'failed', error: '전해지지 않았어요' });
    expect(settleOut(failed, 'orchA', tail, MORNING)).toBe(failed);
    expect(beforeTail(failed, tail, TAIL_START).map((m) => m.id)).toEqual(['m1']);
  });
  it('꼬리 앞을 거슬러 읽어 그 말이 기록에 있으면 찾는다(두 묶음 앞)', async () => {
    const r = reader();
    expect(await findEarlier(failed, TAIL_START, r.read, MORNING)).toEqual(['m1']);
    expect(r.calls).toEqual([TAIL_START, 400_000]);
  });
  it('정말 안 간 말은 못 찾는다 — 보낸 때보다 앞까지 읽었으면 더 안 읽고 그대로 실패로 둔다', async () => {
    const lost = applyStatus([{ ...newOut({ id: 'm2', session: 'orchA', text: '이건 안 갔어' }, [], SENT), status: 'sent' as const }], 'm2', 'unknown', undefined, MORNING, true);
    const r = reader();
    expect(await findEarlier(lost, TAIL_START, r.read, MORNING)).toEqual([]);
    expect(r.calls).toEqual([TAIL_START, 400_000]);
  });
  it('보내기 전에 같은 글을 보낸 적이 있어도 그 옛 기록과 짝짓지 않는다(since 뒤만)', async () => {
    const later = applyStatus([{ ...newOut({ id: 'm3', session: 'orchA', text: TEXT }, [], Date.parse('2026-10-10T21:00:00Z')), status: 'sent' as const }], 'm3', 'unknown', undefined, MORNING, true);
    const r = reader();
    expect(await findEarlier(later, TAIL_START, r.read, MORNING)).toEqual([]);
    expect(r.calls).toEqual([TAIL_START]); // 첫 묶음(20:00~)이 보낸 때(21:00) 앞까지 닿았다 — 더 안 읽는다
  });
  it('파일 처음(start 0)이면 멈추고, 아무리 길어도 LOOKBACK_PAGES 묶음까지만 읽는다', async () => {
    let n = 0;
    const endless = async (before: number) => { n++; return { text: bot(`e${before}`, '2026-10-10T23:59:00Z', '긴 일'), start: before - 1 }; };
    expect(await findEarlier(failed, 10_000_000, endless, MORNING)).toEqual([]);
    expect(n).toBe(LOOKBACK_PAGES);
    const r = reader();
    expect(await findEarlier(failed, 0, r.read, MORNING)).toEqual([]);
    expect(r.calls).toEqual([]);
  });
  it('beforeTail — 꼬리가 파일 처음부터거나(0) 아직 못 읽었거나(undefined) 꼬리가 보낸 때를 덮으면 거슬러 볼 것 없음', () => {
    expect(beforeTail(failed, tail, 0)).toEqual([]);
    expect(beforeTail(failed, tail, undefined)).toEqual([]);
    const covering = parseChat(bot('c1', '2026-10-10T17:00:00Z', '앞'));
    expect(beforeTail(failed, [...covering, ...tail], TAIL_START)).toEqual([]);
    // 꼬리에 시각 있는 항목이 하나도 없으면 — 덮는지 모르니 거슬러 본다
    expect(beforeTail(failed, [], TAIL_START).map((m) => m.id)).toEqual(['m1']);
  });
});

describe('기록에 끝내 안 뜬 말 — 몇 시간 "생각 중"(11-07 사용자 폰 말, 맥은 쳤다는데 Claude 입력 기록에 없음)', () => {
  const H = 60 * 60 * 1000;
  const sent = (o: Partial<OutMsg> = {}): OutMsg => ({ id: 'm1', session: 'orch', text: '말', at: T, status: 'sent', ...o });

  it('재현: 맥은 쳤다(done)고 하고 세션은 일하는 중 — 7시간 뒤에도 기다리면 안 된다', () => {
    const r = applyStatus([sent()], 'm1', 'done', undefined, T + 7 * H, true, undefined)[0]!;
    expect(r.status).toBe('failed');
    expect(r.lost).toBe(true);
    expect(r.error).toBe('전해지지 않았어요');
  });

  it('경계: 일하는 세션은 LOST_AFTER 까지 기다린다(줄 서 있을 수 있다) — 그 전엔 그대로', () => {
    expect(applyStatus([sent()], 'm1', 'done', undefined, T + LOST_AFTER - 1, true, undefined)[0]!.status).toBe('sent');
    expect(applyStatus([sent()], 'm1', 'done', undefined, T + LOST_AFTER, true, undefined)[0]!.status).toBe('failed');
  });

  it('맥이 계속 치는 중(typing)이라고만 해도 LOST_AFTER 면 전해지지 않은 것', () => {
    expect(applyStatus([sent()], 'm1', 'typing', undefined, T + LOST_AFTER - 1, true, undefined)[0]!.status).toBe('sent');
    const r = applyStatus([sent()], 'm1', 'typing', undefined, T + LOST_AFTER, true, undefined)[0]!;
    expect([r.status, r.lost]).toEqual(['failed', true]);
  });

  it('기록을 아직 다 못 봤으면(looked 아님) 시간이 지나도 실패로 안 바꾼다 — 들어간 말을 "못 받았어요"로 만들지 않게', () => {
    expect(applyStatus([sent()], 'm1', 'done', undefined, T + 7 * H, false, undefined)[0]!.status).toBe('sent');
  });

  it('쉬는 세션은 전처럼 1분 — 빨라진 길을 안 깬다', () => {
    const r = applyStatus([sent()], 'm1', 'done', undefined, T + CHECK_AFTER + 1000, true, T)[0]!;
    expect([r.status, r.lost]).toEqual(['failed', true]);
  });

  it('옛 말풍선: 저장돼 있던 말도 새 판을 받으면 풀린다 — 읽자마자 물어볼 차례, done 이면 전해지지 않음, 다시 보내면 새 id', () => {
    const s = mem();
    writeOutbox(s, [sent()]); // 새 칸(tried) 없는 옛 저장 모양
    const now = T + 7 * H;
    const back = readOutbox(s, now);
    expect(back.map((m) => m.status)).toEqual(['sent']);
    expect(dueForCheck(back[0]!, now)).toBe(true);
    const done = applyStatus(back, 'm1', 'done', undefined, now, true, undefined);
    expect(done[0]!.status).toBe('failed');
    const { id, list } = retryOut(done, 'm1', 'm2', now + 1000);
    expect(id).toBe('m2'); // 맥이 m1 을 '쳤음'으로 기억해 같은 id 면 안 친다
    expect(list[0]).toMatchObject({ id: 'm2', status: 'sending', at: now + 1000 });
  });

  it('늦게 뜬 말: 전해지지 않음으로 바뀐 뒤 기록에 들어오면 말풍선이 빠진다(다시 보내기는 사람이 눌러야 나간다)', () => {
    const lost = applyStatus([sent()], 'm1', 'done', undefined, T + LOST_AFTER, true, undefined);
    const items = [u('a', new Date(T + LOST_AFTER + 5000).toISOString(), '말')];
    expect(settleOut(lost, 'orch', items, T + LOST_AFTER + 6000)).toEqual([]);
  });

  it('다시 보낸 옛 말은 다시 보낸 때부터 잰다 — 보낸 때(at)가 옛날이라 바로 전해지지 않음으로 찍으면 사람이 또 눌러 두 번 나간다', () => {
    const failed = sent({ status: 'failed', error: '못 보냄' });
    const now = T + 7 * H;
    const { list, id } = retryOut([failed], 'm1', 'm2', now);
    expect(id).toBe('m1');
    const typed = markOut(list, 'm1', 'sent');
    expect(typed[0]!.at).toBe(T); // 기록 맞춤용 보낸 때는 그대로
    expect(dueForCheck(typed[0]!, now + 1000)).toBe(false); // 물어보기도 다시 보낸 때부터
    expect(applyStatus(typed, 'm1', 'done', undefined, now + 60_000, true, undefined)[0]!.status).toBe('sent');
    expect(applyStatus(typed, 'm1', 'unknown', undefined, now + 30_000, true, undefined)[0]!.status).toBe('sent');
    expect(applyStatus(typed, 'm1', 'done', undefined, now + 59_000, true, now - 5 * H)[0]!.status).toBe('sent'); // 쉬는 세션 1분도 다시 보낸 때부터
    expect(applyStatus(typed, 'm1', 'done', undefined, now + 60_000, true, now - 5 * H)[0]!.status).toBe('failed');
    expect(applyStatus(typed, 'm1', 'done', undefined, now + LOST_AFTER, true, undefined)[0]!.status).toBe('failed');
  });

  it('응답을 못 받고 매달린 말(sending)도 1분 지나면 맥에 묻는다 — 전엔 앱을 다시 열 때까지 영영 안 물었다', () => {
    const m = sent({ status: 'sending' });
    expect(dueForCheck(m, T + CHECK_AFTER - 1)).toBe(false);
    expect(dueForCheck(m, T + CHECK_AFTER)).toBe(true);
  });

  it('20시간 넘은 말은 조용히 버리지 않고 전해지지 않음으로 남긴다 — 사라지는 게 제일 나쁘다', () => {
    const s = mem();
    writeOutbox(s, [sent()]);
    const [m] = readOutbox(s, T + OUTBOX_TTL + 1);
    expect([m?.status, m?.lost, m?.error]).toEqual(['failed', true, '전해지지 않았어요']);
  });

  it('생각 중은 기다릴 만한 말에만 — 실패·오래된 말은 안 센다', () => {
    expect(outPending(sent(), T + 1000)).toBe(true);
    expect(outPending(sent({ status: 'sending' }), T + 1000)).toBe(true);
    expect(outPending(sent(), T + LOST_AFTER)).toBe(false); // 맥이 안 닿아 답을 못 받아도
    expect(outPending(sent({ status: 'failed' }), T + 1000)).toBe(false);
    expect(outPending(sent({ tried: T + 7 * H }), T + 7 * H + 1000)).toBe(true); // 다시 보낸 건 그때부터
  });

  it('폰 생각 중이 이 판단을 쓴다 — 데스크톱은 안 건드린다', () => {
    expect(mobileChat).toContain('out.mine.filter((m) => outPending(m, now)).length');
  });
  it('말이 사라지면 기록이 안 바뀐다 — 보낼 함이 바뀔 때도 기록을 다시 봐야 looked 가 켜진다(안 그러면 다시 보낸 말이 또 붙는다)', () => {
    expect(outboxUi).toMatch(/\}, \[session, sid, items, ids\]\);/);
  });
});
