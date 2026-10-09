// 먹이 = 끝낸 일 한 통 (시안 docs/design-drafts/tama-v2 v1 F, 2026-10-03 사용자 확정) — 개발 안 해도 똑같이 키운다
import { describe, expect, it } from 'vitest';
import { advance, fullness, hatch, type TamaEvent } from './pet';
import { evolve, ZERO } from './tree';
import { parseTamaFile } from './store';
import { balanceFeed } from './sources';

// 날짜 숫자는 9월 기준(9/28 = 월)으로 쓰고 5주 뒤로 옮긴다 — 2026 추석 주를 피해 공휴일 없는 10/26~11/6 에서
const at = (d: number, h: number, m = 0) => new Date(2026, 8, d + 35, h, m).getTime();
const H = 3_600_000;

describe('개발 안 하는 먹이', () => {
  it('시킨 일 끝 = 밥(+1) · 결과물 = 특식(+2) · 대화 = 간식(+1) · 예약 보고 = 끼니(+1)', () => {
    const p = hatch('wave', at(28, 9), 0.3);
    const evs: TamaEvent[] = [{ t: at(28, 10), type: 'task' }];
    expect(fullness(advance(p, evs, at(28, 10, 1)))).toBe(1);
    expect(fullness(advance(p, [{ t: at(28, 10), type: 'show' }], at(28, 10, 1)))).toBe(2);
    expect(fullness(advance(p, [{ t: at(28, 10), type: 'talk' }], at(28, 10, 1)))).toBe(1);
    expect(fullness(advance(p, [{ t: at(28, 10), type: 'routine', pass: true }], at(28, 10, 1)))).toBe(1);
  });

  it('하루 내내 커밋 없이 시킨 일·대화만 해도 굶지 않는다(돌봄 실수 0)', () => {
    const p = hatch('wave', at(28, 9), 0.3);
    const evs: TamaEvent[] = [10, 13, 16, 19].map((h) => ({ t: at(28, h), type: 'talk' }));
    expect(advance(p, evs, at(28, 22)).c.mistakes).toBe(0);
  });

  it('예약 보고 = 배틀 한 판(성공이면 승)', () => {
    const p = advance(hatch('leaf', at(28, 9), 0.3), [{ t: at(28, 10), type: 'routine', pass: true }, { t: at(28, 11), type: 'routine', pass: false }], at(28, 12));
    expect([p.c.battles, p.c.wins, p.c.routines, p.c.routineWins]).toEqual([2, 1, 2, 1]);
  });

  it('문서 고침 = 목욕 — 똥 하나를 바로 치운다', () => {
    const p = hatch('fire', at(28, 9), 0.3);
    const dirty = advance(p, [{ t: at(28, 10), type: 'commit', lines: 400, hasTest: false }], at(28, 10, 30));
    expect(dirty.poops).toBe(1);
    const bath = advance(dirty, [{ t: at(28, 11), type: 'doc' }], at(28, 11, 1));
    expect(bath.poops).toBe(0);
    expect(bath.c.docs).toBe(1);
  });

  it('시안 검토 = 놀아주기(plays) — 배는 안 찬다', () => {
    const p = advance(hatch('fire', at(28, 9), 0.3), [{ t: at(28, 10), type: 'review' }], at(28, 10, 1));
    expect(p.c.plays).toBe(1);
    expect(fullness(p)).toBe(0);
  });

  it('약 = 아무 먹이 3번 — 커밋 없이 시킨 일·대화·결과물로 낫는다', () => {
    const alive = [{ t: at(23, 11), type: 'task' } as TamaEvent];
    const sick = advance(hatch('wave', at(23, 10), 0.3), alive, at(26, 5));
    expect(sick.sick).toBe(true);
    const cured = advance(sick, [...alive, { t: at(26, 10), type: 'task' }, { t: at(26, 11), type: 'talk' }, { t: at(26, 12), type: 'show' }], at(26, 13));
    expect(cured.sick).toBe(false);
  });
});

describe('궁극체 조건 = 일 종류', () => {
  const c = (o: Partial<typeof ZERO>) => ({ ...ZERO, ...o });
  it('불씨 = 마무리 5번 — PR 머지와 결과물을 합쳐 센다', () => {
    expect(evolve('fire', 'p1', c({ prMerges: 2, shows: 2 }))).toBeNull();
    expect(evolve('fire', 'p1', c({ prMerges: 2, shows: 3 }))).toBe('m1');
    expect(evolve('fire', 'p1', c({ shows: 5 }))).toBe('m1');
  });
  it('잎사귀 = 검사 비율 절반 — 테스트 커밋·예약 성공·시안 검토 / 커밋·예약·검토', () => {
    expect(evolve('leaf', 'p1', c({ routines: 4, routineWins: 2 }))).toBe('m1');
    expect(evolve('leaf', 'p1', c({ routines: 4, routineWins: 1 }))).toBeNull();
    expect(evolve('leaf', 'p1', c({ commits: 4, testCommits: 1, plays: 2 }))).toBe('m1');
    expect(evolve('leaf', 'p1', c({ commits: 4, testCommits: 2 }))).toBe('m1');
  });
});

describe('옛 tama.json 이행', () => {
  it('새 기록 칸이 없는 옛 펫은 0 으로 채우고, 배부름·돌봄 기록은 그대로', () => {
    const old = { pet: { ...hatch('fire', at(28, 9), 0.3), fedFull: 3, fedCare: 1000, c: { mistakes: 1, training: 4, commits: 7 } }, work: [], dex: [], graves: [], box: [] };
    delete (old.pet.c as Record<string, unknown>).shows;
    const f = parseTamaFile(JSON.stringify(old));
    expect(f.pet!.c.shows).toBe(0);
    expect(f.pet!.c.talks).toBe(0);
    expect(f.pet!.c.mistakes).toBe(1);
    expect(f.pet!.fedFull).toBe(3);
    expect(fullness(f.pet!)).toBe(3);
  });

  it('옛 펫을 새 규칙으로 1분 돌려도 실수·배부름이 튀지 않는다', () => {
    const p = advance(hatch('fire', at(28, 9), 0.3), [{ t: at(28, 10), type: 'commit', lines: 10, hasTest: false }], at(28, 11));
    const f = parseTamaFile(JSON.stringify({ pet: p, work: [], dex: [], graves: [], box: [] }));
    const next = advance(f.pet!, [], at(28, 11) + 60_000);
    expect(next.c.mistakes).toBe(p.c.mistakes);
    expect(fullness(next)).toBe(fullness(p));
  });
});

describe('균형 — 개발자가 두 갈래로 먹여도 넘치지 않게 (balanceFeed)', () => {
  const extras = (evs: TamaEvent[]) => balanceFeed(evs).filter((e) => !e.echo);
  it('결과물은 하루(새벽 5시~) 3개까지 — 넷째부터 메아리', () => {
    const evs: TamaEvent[] = [10, 11, 12, 13].map((h) => ({ t: at(28, h), type: 'show' }));
    expect(extras(evs)).toHaveLength(3);
    expect(extras([...evs, { t: at(29, 10), type: 'show' }])).toHaveLength(4);
  });
  it('같은 결과물을 하루에 두 번 띄워도 한 번', () => {
    const evs: TamaEvent[] = [{ t: at(28, 10), type: 'show', label: 'a.md' }, { t: at(28, 11), type: 'show', label: 'a.md' }, { t: at(28, 12), type: 'show', label: 'b.md' }];
    expect(extras(evs).map((e) => e.label)).toEqual(['a.md', 'b.md']);
  });
  it('대화·문서 고침은 한 시간에 1번', () => {
    const evs: TamaEvent[] = [0, 10, 59, 61].map((m) => ({ t: at(28, 10) + m * 60_000, type: 'talk' }));
    expect(extras(evs).map((e) => e.t)).toEqual([at(28, 10), at(28, 11, 1)]);
  });
  it('커밋·PR 30분 안의 시킨 일·결과물은 같은 일 — 배·코인은 한 번(시킨 일 횟수는 센다)', () => {
    const evs: TamaEvent[] = [{ t: at(28, 10), type: 'commit', lines: 10, hasTest: false }, { t: at(28, 10, 20), type: 'task' }, { t: at(28, 10, 25), type: 'show' }, { t: at(28, 12), type: 'task' }];
    const b = balanceFeed(evs);
    expect(b.map((e) => !!e.echo)).toEqual([false, true, true, false]);
    const p = advance(hatch('wave', at(28, 9), 0.3), b, at(28, 12, 1));
    expect(p.c.tasksDone).toBe(2);
    expect(p.c.shows).toBe(0);
  });
  it('끝낸 일 먹이(커밋·PR 빼고)는 하루 합쳐 10번까지', () => {
    const evs: TamaEvent[] = Array.from({ length: 14 }, (_, i) => ({ t: at(28, 6) + i * 61 * 60_000, type: i % 2 ? 'talk' : 'task' }));
    expect(extras(evs)).toHaveLength(10);
  });
  it('메아리는 먹이지 않고 살아 있다는 표시만 — 배 0, 마지막 활동은 갱신', () => {
    const p = advance(hatch('wave', at(28, 9), 0.3), [{ t: at(28, 10), type: 'talk', echo: true }], at(28, 10, 1));
    expect(fullness(p)).toBe(0);
    expect(p.lastActive).toBe(at(28, 10));
  });
  it('커밋·PR 은 손대지 않는다', () => {
    const evs: TamaEvent[] = Array.from({ length: 30 }, (_, i) => ({ t: at(28, 10, i), type: 'commit', lines: 5, hasTest: false }));
    expect(extras(evs)).toHaveLength(30);
  });
});
