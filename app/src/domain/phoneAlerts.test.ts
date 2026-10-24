import { describe, expect, it } from 'vitest';
import { alertCount, recentAlerts } from './phoneAlerts';
import type { TaskEvent } from './tasks';

// 폰 종 = 알림 보기(시안 docs/design-drafts/phone-nav v1 N, 2026-10-24 사용자 "알림은 껐다 켜는 거라서 잘못됐고")
// '최근' 칸 — 폰엔 알림 기록이 따로 없어서 이 참모가 맡긴 일의 끝남·물음을 작업 기록에서 만든다
const NOW = Date.parse('2026-10-24T03:00:00Z');
const at = (min: number) => new Date(NOW - min * 60_000).toISOString();
const ev: TaskEvent[] = [
  { ts: at(90), type: 'send', task: 't1', target: 'acme-shop', from: 'me', title: '장바구니 색 바꾸기' },
  { ts: at(80), type: 'send', task: 't2', target: 'notes-app', from: 'me', title: '노트 시험 고치기' },
  { ts: at(70), type: 'send', task: 't3', target: 'other-app', from: 'you', title: '남의 일' },
  { ts: at(60), type: 'done', task: 't2', note: 'PR #41 머지 대기' },
  { ts: at(50), type: 'done', task: 't3', note: '남의 끝' },
  { ts: at(3), type: 'ask', task: 't1', note: '빨강이랑 파랑 중 어느 쪽?' },
  { ts: at(2), type: 'reply', task: 't1', note: '답 받음' },
];

describe('recentAlerts — 종 시트 "최근"', () => {
  it('이 참모가 맡긴 일의 끝남·물음만, 새것이 위', () => {
    const r = recentAlerts(ev, 'me', NOW);
    expect(r.map((x) => [x.kind, x.target, x.line])).toEqual([
      ['ask', 'acme-shop', '빨강이랑 파랑 중 어느 쪽?'],
      ['done', 'notes-app', '노트 시험 고치기 끝남 — PR #41 머지 대기'],
    ]);
    expect(r[0]!.at).toBe(NOW - 3 * 60_000);
  });
  it('물음에 글이 없으면 맡긴 일 제목', () => {
    const r = recentAlerts([...ev, { ts: at(1), type: 'ask', task: 't2' }], 'me', NOW);
    expect(r[0]!.line).toBe('노트 시험 고치기');
  });
  it('끝남에 글이 없으면 제목 + 끝남만', () => {
    const r = recentAlerts([ev[0]!, { ts: at(5), type: 'done', task: 't1' }], 'me', NOW);
    expect(r[0]!.line).toBe('장바구니 색 바꾸기 끝남');
  });
  it('3일 지난 건 뺀다', () => {
    const old = [{ ...ev[1]!, ts: at(5 * 1440) }, { ts: at(4 * 1440), type: 'done' as const, task: 't2' }];
    expect(recentAlerts(old, 'me', NOW)).toEqual([]);
  });
  it('많아도 여덟 줄까지', () => {
    const many: TaskEvent[] = Array.from({ length: 12 }, (_, i) => [
      { ts: at(100 + i), type: 'send' as const, task: `m${i}`, target: 'x', from: 'me', title: `일${i}` },
      { ts: at(20 + i), type: 'done' as const, task: `m${i}` },
    ]).flat();
    expect(recentAlerts(many, 'me', NOW)).toHaveLength(8);
  });
  it('보낸 기록이 없는 일(남이 맡긴 것)은 안 나온다', () => {
    expect(recentAlerts([{ ts: at(1), type: 'done', task: 'zz' }], 'me', NOW)).toEqual([]);
  });
});

describe('alertCount — 종 숫자', () => {
  it('답 기다림 + 답할 카드', () => expect(alertCount(2, 1)).toBe(3));
  it('없으면 0(숫자 안 붙음)', () => expect(alertCount(0, 0)).toBe(0));
});
