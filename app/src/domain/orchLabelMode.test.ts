import { describe, expect, it } from 'vitest';
import { displayName } from './orchLabel';
import { pickChammos } from '../../mode-examples/team-status/hooks/model';

// 기본 모드 '참모 상태'(mode-examples/team-status)는 앱 코드를 못 불러와 이름표 규칙을 따로 갖고 있다 — 두 쪽이 같은 이름을 내는지(공개 이슈 #3)
describe('참모 상태 이름표 = 앱 displayName', () => {
  const HQ = '/hq';
  const cases: { name: string; label?: string }[][] = [
    [{ name: '참모' }, { name: '참모-2 · 감독' }, { name: '참모-3' }, { name: '참모-4 · 감독' }],
    [{ name: '참모-2', label: '디자인' }, { name: '참모-3 · 옛 이름', label: '운영' }, { name: '참모-5 · 디자인' }],
    [{ name: 'Chammo-2 · Ops' }, { name: 'Chammo-3 · ops' }, { name: 'Chammo-30' }, { name: 'Chammo' }],
  ];
  it.each(cases.map((c, i) => [i, c] as const))('경우 %i', (_i, roster) => {
    const live = roster.map((r, k) => ({ sessionId: `s${k}`, name: r.name, cwd: HQ, busy: false, startedAt: 1, ...(r.label ? { label: r.label } : {}) }));
    const got = pickChammos(live, { hqDir: HQ, assistants: ['참모', '참모', 'Chammo'], order: live.map((x) => x.sessionId) }).map((c) => c.name);
    expect(got).toEqual(roster.map((r) => displayName(r.name, r.label, roster)));
  });
});
