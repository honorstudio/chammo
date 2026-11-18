import { describe, expect, it } from 'vitest';
import { compactVerdict, COMPACT_MIN, compactStep, QUIET_MS, typingNow, handoffText, compactText, type Flow } from './chiefCompact';

const now = 1_800_000_000_000;
const base = { used: 55, status: 'idle' as const, lastAt: now - QUIET_MS - 1, now, viewing: false, typing: false, asking: false };

describe('compactVerdict — 언제 정리를 시작하나', () => {
  it('40% 이상 + 10분 조용 + 쉼이면 시작', () => {
    expect(compactVerdict(base)).toBe('go');
    expect(compactVerdict({ ...base, used: COMPACT_MIN })).toBe('go');
    expect(compactVerdict({ ...base, status: 'done' })).toBe('go');
  });
  it('40% 밑이거나 모르면 안 한다', () => {
    expect(compactVerdict({ ...base, used: 39 })).toBe('no');
    expect(compactVerdict({ ...base, used: undefined })).toBe('no');
  });
  it('10분이 안 됐으면 기다린다(마지막 줄 시각을 모르면도)', () => {
    expect(compactVerdict({ ...base, lastAt: now - QUIET_MS + 1000 })).toBe('wait');
    expect(compactVerdict({ ...base, lastAt: undefined })).toBe('wait');
  });
  it('일하는 중·답 기다림·뒤 일 기다림·막힘이면 70% 를 넘어도 끊지 않는다', () => {
    for (const status of ['working', 'asks', 'bgwait', 'blocked', 'login', 'unknown', 'stale'] as const) {
      expect(compactVerdict({ ...base, used: 85, status })).toBe('wait');
    }
  });
  it('카드 대기 중이면 미룬다', () => {
    expect(compactVerdict({ ...base, used: 75, asking: true })).toBe('wait');
  });
  it('사람이 그 채팅을 보거나 치는 중이면 미룬다', () => {
    expect(compactVerdict({ ...base, viewing: true })).toBe('wait');
    expect(compactVerdict({ ...base, typing: true })).toBe('wait');
  });
  it('실패한 뒤 쉬는 동안은 다시 안 한다', () => {
    expect(compactVerdict({ ...base, coolUntil: now + 1 })).toBe('wait');
    expect(compactVerdict({ ...base, coolUntil: now - 1 })).toBe('go');
  });
});

describe('typingNow — 입력칸 글', () => {
  it('빈 칸은 아님, 방금 바뀐 글은 치는 중, 10분 넘게 그대로인 글은 잊은 글', () => {
    expect(typingNow('', now - 1, now)).toBe(false);
    expect(typingNow('안녕', now - 60_000, now)).toBe(true);
    expect(typingNow('안녕', now - QUIET_MS - 1, now)).toBe(false);
  });
});

describe('compactStep — 인계 → /compact → 확인', () => {
  const h: Flow = { phase: 'handoff', at: now, before: 62, mtime0: 100 };
  it('인계 파일이 새로 써지고 턴이 끝나면 /compact', () => {
    expect(compactStep(h, { now: now + 30_000, status: 'idle', mtime: 100, used: 62 })).toEqual({ kind: 'wait' });
    expect(compactStep(h, { now: now + 30_000, status: 'working', mtime: 200, used: 62 })).toEqual({ kind: 'wait' });
    expect(compactStep(h, { now: now + 30_000, status: 'idle', mtime: 200, used: 62 })).toEqual({ kind: 'compact' });
  });
  it('인계가 10분 안에 안 써지면 그만둔다', () => {
    expect(compactStep(h, { now: now + 11 * 60_000, status: 'idle', mtime: 100, used: 62 })).toEqual({ kind: 'fail', why: 'handoff-timeout' });
  });
  const c: Flow = { phase: 'compact', at: now, before: 62, mtime0: 100 };
  it('% 가 실제로 줄고 쉼이면 끝', () => {
    expect(compactStep(c, { now: now + 60_000, status: 'working', used: 12 })).toEqual({ kind: 'wait' });
    expect(compactStep(c, { now: now + 60_000, status: 'idle', used: 62 })).toEqual({ kind: 'wait' });
    expect(compactStep(c, { now: now + 60_000, status: 'idle', used: 12 })).toEqual({ kind: 'done', after: 12 });
  });
  it('압축 요약 줄이 새 턴처럼 보여 상태가 working 이어도, 세션이 실제로 쉬면(agents) 끝 — 11-17 시험 haiku 실측', () => {
    expect(compactStep(c, { now: now + 60_000, status: 'working', idle: true, used: 0 })).toEqual({ kind: 'done', after: 0 });
    expect(compactStep(c, { now: now + 60_000, status: 'working', idle: false, used: 0 })).toEqual({ kind: 'wait' });
  });
  it('15분 지나도 안 줄면 실패로 적는다', () => {
    expect(compactStep(c, { now: now + 16 * 60_000, status: 'idle', used: 61 })).toEqual({ kind: 'fail', why: 'no-drop', after: 61 });
  });
});

describe('보내는 말', () => {
  it('인계 말에 경로와 네 가지가 들어간다', () => {
    const t = handoffText('/d/memory/orch/참모-2/handoff.md');
    expect(t).toContain('/d/memory/orch/참모-2/handoff.md');
    for (const w of ['진행 중인 일', '기다리는 답', '최근 결정', '다음 할 일']) expect(t).toContain(w);
    expect(t).not.toMatch(/\n/);
  });
  it('/compact 지시에 handoff 다시 읽기가 들어간다', () => {
    const t = compactText('/d/memory/orch/참모-2/handoff.md');
    expect(t.startsWith('/compact ')).toBe(true);
    expect(t).toContain('/d/memory/orch/참모-2/handoff.md');
    expect(t).not.toMatch(/\n/);
  });
});
