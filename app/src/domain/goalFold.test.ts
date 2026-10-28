import { describe, expect, it } from 'vitest';
import type { Cell, CellState, Goal, GoalBar } from './goalBar';
import { foldBlocks } from './goalFold';
import { foldGet, foldSet } from '../ui/goalFold';

// 사용자 10-28: 진행 칸을 접으면 한 줄 막대 하나에 목표마다 블록 — 폭은 전체 칸 중 그 목표 몫, 많으면 작은 것들은 '그 밖 N'
const cell = (state: CellState, i: number): Cell => ({ task: `t${i}`, title: '', target: '', state });
const goal = (key: string, states: CellState[], o: Partial<Goal> = {}): Goal => ({
  key, name: key, cells: states.map(cell), done: states.filter((s) => s === 'done' || s === 'auto').length, total: states.length,
  finished: false, waiting: false, lastAt: 0, ...o,
});
const bar = (goals: Goal[], byProject = false): GoalBar => ({ goals, byProject, done: goals.reduce((n, g) => n + g.done, 0), total: goals.reduce((n, g) => n + g.total, 0) });

describe('foldBlocks — 블록 비율', () => {
  it('블록 폭은 전체 칸 중 그 목표 칸 몫 — 캡처의 1/3 · 7/8 · 0/2', () => {
    const b = foldBlocks(bar([
      goal('팀 앱', ['wait', 'wait', 'done']),
      goal('인앱 브라우저', ['done', 'done', 'done', 'done', 'done', 'done', 'done', 'run']),
      goal('honor', ['run', 'run']),
    ]));
    expect(b.map((x) => [x.name, x.done, x.total])).toEqual([['팀 앱', 1, 3], ['인앱 브라우저', 7, 8], ['honor', 0, 2]]);
    expect(b.map((x) => x.share)).toEqual([3 / 13, 8 / 13, 2 / 13]);
    expect(b.reduce((n, x) => n + x.share, 0)).toBeCloseTo(1);
  });
  it('블록 안은 끝난 칸부터 이어 칠하고 안 보낸 칸이 끝 — 같은 상태는 한 덩어리', () => {
    const [b] = foldBlocks(bar([goal('a', ['todo', 'wait', 'run', 'done', 'ask', 'auto', 'done'])]));
    expect(b!.parts).toEqual([
      { state: 'done', n: 2 }, { state: 'auto', n: 1 }, { state: 'run', n: 1 }, { state: 'ask', n: 1 }, { state: 'wait', n: 1 }, { state: 'todo', n: 1 },
    ]);
  });
  it('프로젝트로 묶이면 말풍선 이름에 프로젝트를 붙인다 — 머리줄 밑 이어진 줄까지, 프로젝트 밖은 안 붙임', () => {
    const b = foldBlocks(bar([
      goal('k0', ['run'], { name: '팀 앱', project: '' }),
      goal('k1', ['run'], { name: '출시', project: 'shop' }),
      goal('k2', ['run'], { name: '', project: 'shop', label: 'shop' }),
      goal('k3', ['run'], { name: '', project: 'blog', label: 'blog' }),
    ], true));
    expect(b.map((x) => x.name)).toEqual(['팀 앱', 'shop · 출시', 'shop · 그 밖의 일', 'blog']);
  });
});

// 사용자 10-28: 접힌 채로도 끝난 목표가 알아서 빠진다 — '봤음' 대상(unit)을 블록이 들고 있어야 접힌 막대가 그걸 감시한다
describe('foldBlocks — 봤음 대상(units)', () => {
  it('끝난 목표 블록은 그 목표의 unit, 안 끝난 이름표 목표는 없음, 기타 줄은 끝난 칸들의 unit', () => {
    const b = foldBlocks(bar([
      goal('fin', ['done', 'done'], { finished: true, unit: 'fin|100' }),
      goal('run', ['done', 'run']),
      goal('etc1', ['done', 'run', 'auto'], { name: '' }),
    ].map((g) => (g.name === '' ? { ...g, cells: g.cells.map((c, i) => (c.state === 'run' ? c : { ...c, unit: `t|${i}` })) } : g))));
    expect(b.map((x) => x.units)).toEqual([['fin|100'], [], ['t|0', 't|2']]);
  });
  it('그 밖 N 블록은 묶인 목표들의 unit 을 다 든다', () => {
    const gs = Array.from({ length: 12 }, (_, i) => goal(`g${i}`, ['done'], i >= 10 ? { finished: true, unit: `g${i}|1` } : {}));
    const etc = foldBlocks(bar(gs)).at(-1)!;
    expect(etc.key).toBe('etc');
    expect(etc.units).toEqual(['g10|1', 'g11|1']);
  });
});

describe('foldBlocks — 그 밖 묶기', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => goal(`g${i}`, Array<CellState>(i === 3 ? 5 : i === 7 ? 4 : 1).fill(i % 2 ? 'done' : 'run')));
  it('10개까지는 그대로', () => {
    expect(foldBlocks(bar(many(10))).map((b) => b.key)).toEqual(many(10).map((g) => g.key));
  });
  it('10개 넘으면 칸 수 큰 9개는 제자리, 나머지는 끝에 \'그 밖 N\' 하나 — 칸·끝 수는 합친다', () => {
    const b = foldBlocks(bar(many(13)));
    expect(b).toHaveLength(10);
    // 큰 두 목표(g3 5칸·g7 4칸) + 칸 수가 같은 1칸짜리 중 먼저 보낸 7개
    expect(b.slice(0, 9).map((x) => x.key)).toEqual(['g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8']);
    const etc = b[9]!;
    expect([etc.key, etc.name, etc.keys]).toEqual(['etc', '그 밖 4', ['g9', 'g10', 'g11', 'g12']]);
    expect([etc.done, etc.total, etc.share]).toEqual([2, 4, 4 / 20]);
    expect(etc.parts).toEqual([{ state: 'done', n: 2 }, { state: 'run', n: 2 }]);
  });
  it('작은 목표가 앞에 있어도 큰 목표가 남는다', () => {
    const gs = [...Array.from({ length: 10 }, (_, i) => goal(`s${i}`, ['run'])), goal('big', ['run', 'run', 'run'])];
    const b = foldBlocks(bar(gs));
    expect(b.map((x) => x.key)).toContain('big');
    expect(b.at(-1)!.keys).toEqual(['s8', 's9']); // 11개 → 큰 것 포함 9개 + 그 밖 2
  });
});

describe('접힘 기억 — 참모마다·자리마다', () => {
  it('처음은 펼침, 접으면 그 자리만 접힌다', () => {
    expect(foldGet(null, 'home:a')).toBe(false);
    const raw = foldSet(null, 'home:a', true);
    expect(foldGet(raw, 'home:a')).toBe(true);
    expect(foldGet(raw, 'home:b')).toBe(false);
    expect(foldGet(raw, 'dash:a')).toBe(false);
  });
  it('펼치면 지운다 — 다른 자리 기억은 남는다', () => {
    const raw = foldSet(foldSet(null, 'home:a', true), 'dash:a', true);
    const back = foldSet(raw, 'home:a', false);
    expect(JSON.parse(back)).toEqual({ 'dash:a': 1 });
  });
  it('깨진 값이면 펼침', () => {
    expect(foldGet('{', 'home:a')).toBe(false);
    expect(foldGet('[1]', 'home:a')).toBe(false);
    expect(JSON.parse(foldSet('nope', 'home:a', true))).toEqual({ 'home:a': 1 });
  });
});
