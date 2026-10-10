import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../../i18n';
import { addDiary, renderDiary, summarizeDay, type DiaryDay } from './diary';
import { hatch, type TamaEvent } from './pet';
import { EMPTY_FILE, type TamaFile } from './store';

// 2026-11-03(화) — 하루는 새벽 5시에 바뀐다
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const who = (id: string) => (id === 'o-1' ? 'chief' : null);
const ev = (t: number, e: Partial<TamaEvent>) => ({ t, ...e }) as TamaEvent;
const DAY3: TamaEvent[] = [
  ev(at(3, 10), { type: 'commit', lines: 20, hasTest: true }),
  ev(at(3, 11), { type: 'task', label: '로그인 고치기', proj: 'todo-api', by: 'o-1' }),
  ev(at(3, 12), { type: 'task', label: '버튼 색', proj: 'todo-api', by: 'o-1' }),
  ev(at(3, 13), { type: 'pr' }),
  ev(at(3, 23), { type: 'ci', pass: false, label: 'acme-shop' }),
  ev(at(4, 1), { type: 'talk', by: 'o-1' }),
  ev(at(3, 14), { type: 'talk', by: 'o-1', echo: true }),
  ev(at(3, 15), { type: 'work', minutes: 30 }),
  ev(at(4, 6), { type: 'commit', lines: 5, hasTest: false }), // 다음 날
];

describe('summarizeDay — 그날(새벽 5시~다음 5시) 먹은 것을 일기 재료로', () => {
  it('먹은 수·종류·자주 본 프로젝트·제일 많이 먹여 준 참모·빨간불', () => {
    const d = summarizeDay({ events: DAY3, start: at(3, 5), writer: { egg: 'fire', slot: 'r1', gen: 2 }, who })!;
    expect(d).toMatchObject({
      day: '2026-11-03', egg: 'fire', slot: 'r1', gen: 2, fed: 5,
      kinds: { commit: 1, task: 2, pr: 1, talk: 1 },
      top: ['todo-api', 2], keeper: 'chief', ciFail: 1, ciLate: 23, quiet: 'acme-shop', first: 10, last: 1,
    });
  });

  it('메아리·일한 시간은 먹은 게 아니다, 아무 일도 없던 날은 null', () => {
    expect(summarizeDay({ events: [ev(at(5, 10), { type: 'work', minutes: 60 })], start: at(5, 5), writer: { egg: 'fire', slot: 'r1', gen: 1 }, who })).toBeNull();
  });

  it('그날 잡은 몬스터·나타난 몬스터·은퇴도 적는다', () => {
    const d = summarizeDay({
      events: [], start: at(3, 5), writer: { egg: 'fire', slot: 'm1', gen: 1 }, who,
      monsters: { live: [{ id: 'g', kind: 'golem', where: 'x #1', since: 0, lv: 1, at: at(3, 9) }], log: [{ id: 's', kind: 'slime', where: 'y', lv: 2, at: at(3, 8), end: at(3, 16) }, { id: 'f', kind: 'ghost', where: 'z', lv: 1, at: at(3, 8), end: at(3, 9), fled: true }] },
      retiredAt: at(3, 20),
    })!;
    expect(d).toMatchObject({ slain: ['slime'], met: ['golem', 'ghost'], retired: true }); // 도망간 유령도 그날 만난 몬스터
  });
});

describe('renderDiary — 모델 호출 없이 틀 + 낱말 조합', () => {
  afterEach(() => setLang('ko'));
  const d: DiaryDay = { day: '2026-11-03', egg: 'fire', slot: 'r1', gen: 2, fed: 14, kinds: { pr: 2, task: 3 }, top: ['todo-api', 3], keeper: 'chief', ciFail: 2, ciLate: 23, quiet: 'acme-shop', slain: ['slime'], met: [], first: 8, last: 23 };

  it('날짜·날씨와 문장 여러 줄, 같은 날은 언제 그려도 같은 글', () => {
    setLang('ko');
    const p = renderDiary(d);
    expect(p.date).toBe('11월 3일 (화)');
    expect(p.weather).toBe('비 온 뒤 갬');
    expect(p.lines.length).toBeGreaterThanOrEqual(4);
    expect(p.lines.join(' ')).toContain('14');
    expect(p.lines.join(' ')).toContain('todo-api');
    expect(p.lines.join(' ')).toContain('빨간 슬라임');
    expect(p.lines[p.lines.length - 1]).toContain('acme-shop');
    expect(renderDiary(d)).toEqual(p);
    expect(renderDiary({ ...d, day: '2026-11-04', slain: [], quiet: undefined }).lines.join(' ')).toMatch(/밤 11시쯤 빨간불이 2번|빨간불\(CI\)이 2번/);
  });

  it('날짜가 다르면 문장틀이 섞여 매일 같은 글이 아니다', () => {
    setLang('ko');
    const texts = new Set(Array.from({ length: 8 }, (_, i) => renderDiary({ ...d, day: `2026-11-${10 + i}` }).lines.join('|')));
    expect(texts.size).toBeGreaterThan(2);
  });

  it('영어로도 쓴다', () => {
    setLang('en');
    const p = renderDiary(d);
    expect(p.date).toMatch(/Nov/);
    expect(p.lines.join(' ')).toMatch(/14/);
  });
});

describe('addDiary — 새벽 5시가 지나면 어제 한 장', () => {
  const f: TamaFile = { ...EMPTY_FILE, pet: hatch('fire', at(1, 9), 0.3) };
  it('5시 전엔 안 쓰고, 지나면 어제 것을 쓴다 — 두 번 쓰지 않는다', () => {
    expect(addDiary(f, DAY3, at(4, 4, 59), who).diary ?? []).toEqual([]);
    const g = addDiary(f, DAY3, at(4, 5), who);
    expect(g.diary?.map((x) => x.day)).toEqual(['2026-11-03']);
    expect(addDiary(g, DAY3, at(4, 18), who)).toBe(g);
  });

  it('앱이 꺼져 있었으면 빠진 날을 7일까지 채운다(빈 날은 건너뜀)', () => {
    const g = { ...f, diary: [{ day: '2026-11-01' } as DiaryDay] };
    const evs = [ev(at(2, 10), { type: 'task' }), ev(at(3, 10), { type: 'task' })];
    expect(addDiary(g, evs, at(6, 9), who).diary?.map((x) => x.day)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
  });

  it('펫이 없으면 마지막 은퇴한 애가 쓴다, 아무도 없으면 안 쓴다', () => {
    const anc = { egg: 'wave' as const, slot: 'm2' as const, bornAt: at(1, 9), retiredAt: at(3, 20), quirk: 'tester' as const, inherited: [] };
    const g = addDiary({ ...EMPTY_FILE, lineage: [anc] }, DAY3, at(4, 9), who);
    expect(g.diary?.[0]).toMatchObject({ egg: 'wave', slot: 'm2', gen: 1, retired: true });
    expect(addDiary(EMPTY_FILE, DAY3, at(4, 9), who).diary).toBeUndefined();
  });
});
