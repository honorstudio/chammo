import { describe, expect, it } from 'vitest';
import type { InboxItem } from './inbox';
import { ARM_MS, armed, closesOnOutside, directRank, itemRank, keepIndex, orderPages, whenText, type DeckPage } from './inboxDeck';

const item = (over: Partial<InboxItem> = {}): InboxItem => ({ key: 'a', kind: 'ask', project: '참모', where: '', text: '?', ts: '2026-11-05T03:00:00Z', ...over });
const page = (key: string, rank: 0 | 1 | 2): DeckPage => ({ key, rank });

describe('급한 정도 — 기록된 종류로만 가른다(낱말 찾기 없음)', () => {
  it('참모가 답 끝에 물은 것·확인창은 그냥 물음', () => {
    expect(itemRank(item({ text: '승인되면 바로 운영에 올릴게' }))).toBe(2);
    expect(itemRank(item({ kind: 'blocked' }))).toBe(2);
  });
  it('참모가 올린 결정(task ask)·보내기 관문은 운영 줄', () => {
    expect(itemRank(item({ kind: 'decide' }))).toBe(1);
    expect(itemRank(item({ gate: true }))).toBe(1);
  });
  it('직접 카드 — 결제·삭제가 맨 앞, 나머지 승인 카드는 운영 줄', () => {
    expect(directRank('pay')).toBe(0);
    expect(directRank('delete')).toBe(0);
    expect(directRank('ops')).toBe(1);
    expect(directRank('send')).toBe(1);
    expect(directRank('other')).toBe(1);
  });
  it('급한 것부터, 같은 줄 안에선 들어온 차례 그대로', () => {
    expect(orderPages([page('q1', 2), page('ops', 1), page('pay', 0), page('q2', 2), page('d', 1)]).map((p) => p.key)).toEqual(['pay', 'ops', 'd', 'q1', 'q2']);
  });
});

describe('바깥 클릭·Esc 로 닫히나 — 결제·운영 카드가 하나라도 있으면 종으로만 닫는다', () => {
  it('그냥 물음만 있으면 닫힌다', () => expect(closesOnOutside([page('q', 2), page('r', 2)])).toBe(true));
  it('결제 카드가 있으면 안 닫힌다(그냥 물음 장을 보고 있어도)', () => expect(closesOnOutside([page('pay', 0), page('q', 2)])).toBe(false));
  it('운영 카드가 있으면 안 닫힌다', () => expect(closesOnOutside([page('ops', 1)])).toBe(false));
  it('비었으면 닫힌다', () => expect(closesOnOutside([])).toBe(true));
});

describe('keepIndex — 목록이 바뀌어도 보던 카드에 머문다', () => {
  it('보던 카드가 남아 있으면 그 카드 자리로', () => expect(keepIndex(['a', 'b', 'c'], 1, ['x', 'a', 'b', 'c'])).toBe(2));
  it('보던 카드가 답해서 빠지면 같은 자리(다음 카드)', () => expect(keepIndex(['a', 'b', 'c'], 1, ['a', 'c'])).toBe(1));
  it('마지막 카드가 빠지면 앞 카드', () => expect(keepIndex(['a', 'b'], 1, ['a'])).toBe(0));
  it('다 빠지면 0', () => expect(keepIndex(['a'], 0, [])).toBe(0));
});

describe('armed — 카드가 바뀐 직후엔 누름을 안 받는다(넘기다 다음 결제 카드 승인을 잘못 누르지 않게)', () => {
  it('바뀐 직후는 막힘', () => expect(armed(1000, 1000 + ARM_MS - 1)).toBe(false));
  it('잠깐 뒤엔 받음', () => expect(armed(1000, 1000 + ARM_MS)).toBe(true));
  it('넉넉히 길지 않다(사람이 읽는 시간보다 짧게)', () => expect(ARM_MS).toBeLessThanOrEqual(600));
  it('따닥 두 번째 누름(약 250ms)은 막을 만큼 길다', () => expect(ARM_MS).toBeGreaterThanOrEqual(350));
});

describe('whenText — 날짜 없는 시각 대신 어제·날짜(새벽 5시 기준 하루)', () => {
  const now = new Date(2026, 10, 5, 12, 36).getTime();
  it('오늘이면 시각', () => expect(whenText(new Date(2026, 10, 5, 6, 3).toISOString(), now)).toMatch(/06:03|6:03/));
  it('어제 저녁이면 어제', () => expect(whenText(new Date(2026, 10, 4, 18, 3).toISOString(), now)).toBe('어제'));
  it('오늘 새벽 1시도 아직 어제 하루', () => expect(whenText(new Date(2026, 10, 5, 1, 0).toISOString(), now)).toBe('어제'));
  it('더 전이면 월/일', () => expect(whenText(new Date(2026, 10, 2, 18).toISOString(), now)).toBe('11/2'));
  it('못 읽으면 빈 글', () => expect(whenText('x', now)).toBe(''));
});
