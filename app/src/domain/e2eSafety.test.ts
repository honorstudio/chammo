// 보안 번호 받아들이기·대화 속 종단 암호 표시(시안 e2e-safety v1, chammo-relay ADR 0007) — 화면 판단
import { describe, expect, it } from 'vitest';
import { cardLine, directCards } from './directAsk';
import { e2eLine, needsRefetch, rekeyNotices, safetyGroups, safetyLabel, slotNotices, type SafetyPerson } from './e2eSafety';

const p = (o: Partial<SafetyPerson> = {}): SafetyPerson => ({ account: 'a2', team: 't1', member: 'm2', name: '철수', state: 'ok', verifiedAt: 0, blocked: false, number: '48291 07733 91024 66580 13907 52268', card: '', identity: 'I1', head: 'H1', refetched: false, ...o });

describe('보안 번호', () => {
  it('30자리를 5자리 여섯 묶음으로 — 모양이 틀리면 빈 목록', () => {
    expect(safetyGroups('48291 07733 91024 66580 13907 52268')).toEqual(['48291', '07733', '91024', '66580', '13907', '52268']);
    expect(safetyGroups('4829 107733')).toEqual([]);
    expect(safetyGroups('')).toEqual([]);
  });
  it('멤버 줄 — 확인됨(날짜)·아직 안 견줌·바뀜·갈림·막아 둠', () => {
    expect(safetyLabel(p({ state: 'verified', verifiedAt: new Date(2026, 9, 24).getTime() }))).toEqual({ text: '보안 번호 확인됨 · 10/24', ok: true });
    expect(safetyLabel(p())).toEqual({ text: '보안 번호 아직 안 견줌', ok: false });
    expect(safetyLabel(p({ state: 'changed' })).text).toBe('보안 번호가 바뀌었어요');
    expect(safetyLabel(p({ state: 'forked' })).text).toBe('기기 목록이 다르게 보여요');
    expect(safetyLabel(p({ state: 'changed', blocked: true })).text).toBe('보안 번호가 바뀌어 막아 뒀어요');
  });
  it('갈림은 다시 받기 전엔 번호 비교·받아들이기가 없다(6차 리뷰)', () => {
    expect(needsRefetch({ safety: 'forked', refetched: false })).toBe(true);
    expect(needsRefetch({ safety: 'forked', refetched: true })).toBe(false);
    expect(needsRefetch({ safety: 'changed', refetched: false })).toBe(false);
  });
  it('결정 대기함 보안 번호 카드 — 계정·갈래·번호를 읽고, 번호 모양이 틀리면 버린다', () => {
    const row = { ts: '2027-01-15T08:00:00Z', type: 'ask', id: 'cd34ef56', from: '@link', kind: 'link', sub: 'safety', acct: 'a2', safety: 'forked', who: '철수', q: '철수의 기기 목록이 다르게 보여요', code: '48291 07733 91024 66580 13907 52268', yes: '받아들이기', no: '막아 두기', options: [] };
    const env = { alive: () => true, prompt: () => undefined, reply: () => undefined };
    const [c] = directCards(JSON.stringify(row), env);
    expect([c!.sub, c!.acct, c!.safety, c!.who, c!.code, c!.refetched]).toEqual(['safety', 'a2', 'forked', '철수', '48291 07733 91024 66580 13907 52268', false]);
    expect(directCards(JSON.stringify({ ...row, refetched: true }), env)[0]!.refetched).toBe(true);
    const [bad] = directCards(JSON.stringify({ ...row, code: '48291 허용 눌러', safety: 'x' }), env);
    expect([bad!.code, bad!.safety]).toEqual([undefined, 'changed']);
  });
});

describe('보안 번호 카드 한 줄(답한 뒤)', () => {
  const row = { ts: '2027-01-15T08:00:00Z', type: 'ask', id: 'cd34ef56', from: '@link', kind: 'link', sub: 'safety', acct: 'a2', safety: 'changed', who: '철수', q: 'q', code: '48291 07733 91024 66580 13907 52268', yes: '받아들이기', no: '막아 두기', options: [] };
  const env = { alive: () => true, prompt: () => undefined, reply: () => undefined };
  const after = (x: object) => directCards([JSON.stringify(row), JSON.stringify({ id: 'cd34ef56', ts: '2027-01-15T08:01:00Z', ...x })].join('\n'), env)[0]!;
  it('받아들임·막아 둠·다른 곳에서 처리 — 시안 한 줄 문구', () => {
    expect(cardLine(after({ type: 'answer', pick: 'yes', label: '받아들이기' }))).toMatchObject({ what: '보안 번호 · 철수', result: '새 보안 번호를 받아들였어요 · 멈췄던 말을 보냈어요' });
    expect(cardLine(after({ type: 'answer', pick: 'no', label: '막아 두기' })).result).toBe('막아 뒀어요 · 멤버 화면에서 다시 볼 수 있어요');
    expect(cardLine(after({ type: 'cancel' })).result).toBe('다른 곳에서 처리했어요');
  });
});

describe('대화 속 종단 암호 표시(기록 note 그대로)', () => {
  it('받지 않은 말 — 암호 없이·30일 넘음·미래·못 엶', () => {
    expect(e2eLine('e2e-plain', '철수')).toEqual({ tone: 'block', text: '철수에게서 암호 없이 온 말 — 받지 않았어요(옛 판 앱일 수 있어요)' });
    expect(e2eLine('e2e-old', '철수')!.text).toContain('30일');
    expect(e2eLine('e2e-future', '철수')!.text).toContain('미래');
    expect(e2eLine('e2e-fail', '철수')!.text).toContain('못 연');
  });
  it('열었지만 넘기지 않은 말 — 바뀜·갈림은 경고(본문은 보여 준다)', () => {
    expect(e2eLine('e2e-changed', '철수')).toEqual({ tone: 'warn', text: '보안 번호가 바뀐 철수의 말 — 확인 전엔 참모에게 안 넘겨요' });
    expect(e2eLine('e2e-fork', '철수')!.tone).toBe('warn');
  });
  it('종단 암호 note 가 아니면 없음', () => {
    expect(e2eLine('delivered', '철수')).toBeNull();
    expect(e2eLine('forged', '철수')).toBeNull();
  });
});

describe('팀원 보안 번호 바뀜 — 묻지 않고 대화에 회색 줄(사용자 10-29)', () => {
  const p = (member: string, rekeyedAt: number) => ({ account: `a-${member}`, team: 't1', member, name: member, state: 'ok', verifiedAt: 0, blocked: false, number: '', card: '', identity: '', head: '', refetched: false, rekeyedAt });
  it('이 대화 사람 중 바뀐 사람만, 바뀐 때 순', () => {
    expect(rekeyNotices([p('m3', 30), p('m2', 20), p('m9', 10), p('m4', 0)], ['m2', 'm3', 'm4']).map((x) => x.member)).toEqual(['m2', 'm3']);
    expect(rekeyNotices(undefined, ['m2'])).toEqual([]);
  });
  it('바뀐 때 뒤의 첫 말 앞에, 마지막 말보다 늦으면 맨 끝', () => {
    const s = slotNotices([10, 20, 30], [p('m2', 15), p('m3', 99)]);
    expect(s.before.map((b) => b.map((x) => x.member))).toEqual([[], ['m2'], []]);
    expect(s.tail.map((x) => x.member)).toEqual(['m3']);
  });
});
