import { describe, expect, it } from 'vitest';
import type { ChatItem } from './chat';
import { addOut, applyStatus, dueForCheck, labelCounts, markOut, OUTBOX_TTL, readDraft, readOutbox, settleOut, writeDraft, writeOutbox, type OutMsg } from './mobileOutbox';

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
  it('너무 오래된(하루 가까이) 것은 버린다 — 실패한 건 남긴다(다시 보내기)', () => {
    const s = mem();
    writeOutbox(s, [
      { id: 'old', session: 'a', text: 'x', at: T, status: 'sent' },
      { id: 'bad', session: 'a', text: 'y', at: T, status: 'failed' },
    ]);
    expect(readOutbox(s, T + OUTBOX_TTL + 1).map((x) => x.id)).toEqual(['bad']);
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
  it('보낸 지 60초 지나도 기록에 없으면 맥에 물어본다 — 15초에 한 번', () => {
    expect(dueForCheck(sent, T + 59_000)).toBe(false);
    expect(dueForCheck(sent, T + 61_000)).toBe(true);
    expect(dueForCheck({ ...sent, checked: T + 61_000 }, T + 70_000)).toBe(false);
    expect(dueForCheck({ ...sent, checked: T + 61_000 }, T + 77_000)).toBe(true);
    expect(dueForCheck({ ...sent, status: 'failed' }, T + 99_000)).toBe(false);
  });
  it('맥 답: 쳤거나 치는 중이면 계속 기다림, 실패·모름이면 다시 보내기', () => {
    const list = [sent];
    expect(applyStatus(list, 'm1', 'done', undefined, T + 61_000)[0]).toMatchObject({ status: 'sent', checked: T + 61_000 });
    expect(applyStatus(list, 'm1', 'failed', 'attach failed', T + 61_000)[0]).toMatchObject({ status: 'failed', error: 'attach failed' });
    expect(applyStatus(list, 'm1', 'unknown', undefined, T + 61_000)[0]).toMatchObject({ status: 'failed', error: '맥이 이 말을 못 받았어요' });
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
  it('없거나 깨졌으면 빈 글', () => {
    const s = mem();
    s.setItem('m.draft.A', '[1,2');
    expect(readDraft(s, 'A')).toEqual({ text: '', files: [] });
    expect(readDraft(null, 'A')).toEqual({ text: '', files: [] });
  });
  it('labelCounts — 되살린 파일 이름표 다음 번호부터(@img2 가 있으면 다음은 @img3)', () => {
    expect(labelCounts([{ label: '@img2' }, { label: '@file1' }, { label: '@img1' }])).toEqual({ img: 2, file: 1 });
    expect(labelCounts([])).toEqual({ img: 0, file: 0 });
  });
});
