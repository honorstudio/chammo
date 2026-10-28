// 진행 칸 접힘(2026-10-28 사용자 "접을 수 있게, 접히면 전체 기준으로 블록을 구분해서") — 한 줄 막대 하나에 목표마다 블록.
// 블록 폭 = 그 목표 칸 수 / 전체 칸 수, 블록 안은 칸 상태별로 끝난 것부터 이어 칠한다(줄 막대와 같은 색 규칙).
// 목표가 많으면(기본 10 넘게) 칸 수가 작은 목표들을 '그 밖 N' 블록 하나로 묶는다.
import { tr } from '../i18n';
import { goalRows, type CellState, type GoalBar } from './goalBar';

/** 블록 안 칠하는 순서 — 끝난 만큼 먼저 차고, 아직 안 보낸 칸이 끝 */
const ORDER: CellState[] = ['done', 'auto', 'run', 'ask', 'wait', 'rest', 'quiet', 'stop', 'todo'];

export type FoldPart = { state: CellState; n: number };
export type FoldBlock = {
  /** 목표 key — '그 밖' 블록은 'etc' */
  key: string;
  /** 말풍선 이름 — 프로젝트 머리줄 밑이면 '프로젝트 · 이름' */
  name: string;
  done: number; total: number;
  /** 전체 칸 중 이 블록 몫(0~1) */
  share: number;
  parts: FoldPart[];
  /** 묶인 목표 key 들(그 밖 블록) — 하나면 자기 key */
  keys: string[];
  /** 봤음 대상 — 끝난 목표의 unit, 이름표 없는 줄은 끝난 칸들의 unit(펼친 줄이 감시하는 것과 같다). 접힌 막대가 이걸 감시한다 */
  units: string[];
};

export const FOLD_MAX = 10;

const partsOf = (states: CellState[]): FoldPart[] =>
  ORDER.map((state) => ({ state, n: states.filter((s) => s === state).length })).filter((p) => p.n > 0);

export function foldBlocks(bar: GoalBar, max = FOLD_MAX): FoldBlock[] {
  const all = bar.goals.reduce((n, g) => n + g.cells.length, 0) || 1;
  // 머리줄은 그 프로젝트 첫 줄에만 온다 — 같은 프로젝트 줄엔 계속 붙인다('프로젝트 밖' 은 안 붙임)
  let head: { p: string; name: string } | undefined;
  const rows = goalRows(bar).map(({ goal, head: h, name }) => {
    if (h !== undefined) head = { p: goal.project ?? '', name: h };
    const under = !!head?.p && head.p === (goal.project ?? '');
    const states = goal.cells.map((c) => c.state);
    const units = goal.finished ? [goal.unit!] : goal.cells.filter((c) => c.unit).map((c) => c.unit!);
    return { key: goal.key, name: under ? `${head!.name} · ${name}` : name, done: goal.done, total: goal.total, states, units };
  });
  const block = (r: (typeof rows)[number]): FoldBlock => ({ key: r.key, name: r.name, done: r.done, total: r.total, share: r.states.length / all, parts: partsOf(r.states), keys: [r.key], units: r.units });
  if (rows.length <= max) return rows.map(block);
  // 칸 수 큰 것부터 max-1 개는 제자리에, 나머지는 끝에 '그 밖 N' 하나로(칸 수가 같으면 먼저 보낸 목표가 남는다)
  const keep = new Set(rows.map((r, i) => ({ i, n: r.states.length })).sort((a, b) => b.n - a.n || a.i - b.i).slice(0, max - 1).map((x) => x.i));
  const rest = rows.filter((_, i) => !keep.has(i));
  const states = rest.flatMap((r) => r.states);
  return [
    ...rows.filter((_, i) => keep.has(i)).map(block),
    {
      key: 'etc', name: tr(`그 밖 ${rest.length}`, `${rest.length} more`),
      done: rest.reduce((n, r) => n + r.done, 0), total: rest.reduce((n, r) => n + r.total, 0),
      share: states.length / all, parts: partsOf(states), keys: rest.map((r) => r.key), units: rest.flatMap((r) => r.units),
    },
  ];
}
