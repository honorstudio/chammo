import { describe, expect, it } from 'vitest';
import { compactVerdict, QUIET_MS } from './chiefCompact';
import { heldAtGate, PROJECT_MIN, projectCompactText, projectHandoffText, projectNoticeText } from './projectCompact';
import type { Activity } from './activity';

const now = 1_800_000_000_000;
const base = { used: 55, status: 'idle' as const, lastAt: now - QUIET_MS - 1, now, viewing: false, typing: false, asking: false, min: PROJECT_MIN };

describe('프로젝트 세션 — 50% 부터', () => {
  it('50% 이상 + 10분 조용 + 쉼이면 시작, 40%대는 참모만', () => {
    expect(compactVerdict(base)).toBe('go');
    expect(compactVerdict({ ...base, used: 50 })).toBe('go');
    expect(compactVerdict({ ...base, used: 45 })).toBe('no');
    expect(compactVerdict({ ...base, used: 45, min: undefined })).toBe('go');
  });
  it('일하는 중·답 기다림·선택지 창·카드·보는 중·치는 중이면 미룬다', () => {
    for (const status of ['working', 'asks', 'bgwait', 'blocked', 'login'] as const) expect(compactVerdict({ ...base, used: 90, status })).toBe('wait');
    expect(compactVerdict({ ...base, asking: true })).toBe('wait');
    expect(compactVerdict({ ...base, viewing: true })).toBe('wait');
    expect(compactVerdict({ ...base, typing: true })).toBe('wait');
    expect(compactVerdict({ ...base, lastAt: now - 60_000 })).toBe('wait');
  });
});

describe('heldAtGate — 결제·운영 직전에 참모 답을 기다리며 쉬는 세션', () => {
  const t = (s: number) => new Date(now + s * 1000).toISOString();
  const a = (o: Partial<Activity>): Activity => ({ prompt: { ts: t(0), text: '고쳐' }, reply: { ts: t(30), text: '운영 DB 마이그 적용 직전이라 멈췄어 — 참모에게 물었어' }, messaged: t(20), ...o } as Activity);
  it('이번 턴에 참모에게 묻고 돈·운영 얘기로 끝났으면 건드리지 않는다', () => {
    expect(heldAtGate(a({}))).toBe(true);
    expect(heldAtGate(a({ reply: { ts: t(30), text: '결제 테스트 전에 확인 받을게' } as Activity['reply'] }))).toBe(true);
  });
  it('SendMessage 가 없거나 옛 턴이거나, 그냥 끝 보고면 정리해도 된다', () => {
    expect(heldAtGate(a({ messaged: undefined }))).toBe(false);
    expect(heldAtGate(a({ messaged: t(-100) }))).toBe(false);
    expect(heldAtGate(a({ reply: { ts: t(30), text: 'PR #12 올렸어, 시험 다 통과' } as Activity['reply'] }))).toBe(false);
    expect(heldAtGate(undefined)).toBe(false);
  });
  it('참모 답(peer)이 묻고 난 뒤 왔으면 그 턴은 새 턴이다', () => {
    expect(heldAtGate(a({ peer: { ts: t(40), text: '진행해' } as Activity['peer'] }))).toBe(false);
  });
});

describe('보내는 말', () => {
  it('인계 말 — starter 경로·지금 하던 일 칸·조건, 깃이면 커밋 금지, 한 줄', () => {
    const g = projectHandoffText('/dev/shop/docs/starter.md', true, '/d/compact/ab12.md');
    expect(g).toContain('/dev/shop/docs/starter.md');
    expect(g).toContain('지금 하던 일');
    expect(g).toContain('머지 금지');
    expect(g).toContain('커밋은 하지 말고');
    expect(g).toContain('/d/compact/ab12.md');
    expect(projectHandoffText('/x/docs/starter.md', false, '/d/compact/ab12.md')).not.toContain('커밋');
    expect(g).not.toMatch(/\n/);
  });
  it('/compact 지시 — starter 다시 읽기와 조건 지키기', () => {
    const c = projectCompactText('/dev/shop/docs/starter.md', '/d/compact/ab12.md');
    expect(c.startsWith('/compact ')).toBe(true);
    expect(c).toContain('/dev/shop/docs/starter.md');
    expect(c).toContain('조건을 지키면서');
    expect(c).toContain('/d/compact/ab12.md');
    expect(c).not.toMatch(/\n/);
  });
  it('참모 알림 — 전후 % 와 마지막 맡긴 일', () => {
    const n = projectNoticeText('shop', 'ab12', 62, 9, '/d/compact/ab12.md', { id: 't-1', title: '로그인 고치기' });
    expect(n.startsWith('[앱] ')).toBe(true);
    for (const w of ['shop', 'ab12', '/d/compact/ab12.md', '62%', '9%', 't-1', '로그인 고치기', '다시 보내']) expect(n).toContain(w);
    expect(projectNoticeText('shop', 'ab12', 62, 9, '/d/compact/ab12.md')).not.toContain('다시 보내');
  });
});
