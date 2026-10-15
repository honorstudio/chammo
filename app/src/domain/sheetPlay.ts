/**
 * 스페이스 엑셀 — 참모가 scripts/sheet set 으로 보낸 칸들을 열린 표에서 '보여 주며' 넣는 순서·속도.
 * 칸마다 프사 커서가 가서(이동) → 테두리 하이라이트 → 값이 타자 치듯 들어간다. 많으면 빨리 감고, 안 보이면 바로 넣는다
 */
import { cellName } from './sheetBook';

export interface Put { sheet?: string | null; r: number; c: number; v?: string | number | boolean | null; f?: string | null }
export interface Step { put: Put; label: string; text: string; move: number; type: number; hold: number }

/** 전체 몇 초 안에 끝낼지 — 칸이 많아도 이 안에서(빨리 감기) */
const BUDGET_MS = 6000;

/** 칸에 들어갈 글(표에 넣는 값과 같게 — 수식이면 =식) */
export const inputOf = (p: Put): string | number | boolean | null => (p.f ? `=${p.f}` : p.v ?? null);

/** 재생 계획 — hidden(창이 안 보임)이면 움직임 없이 바로 넣는다 */
export function plan(puts: Put[], firstSheet: string, hidden: boolean): Step[] {
  const per = hidden ? 0 : Math.max(120, Math.min(600, Math.round(BUDGET_MS / Math.max(1, puts.length))));
  return puts.map((put) => {
    const text = String(inputOf(put) ?? '');
    return {
      put,
      label: `${put.sheet ?? firstSheet}!${cellName(put.r, put.c)}`,
      text,
      move: Math.round(per * 0.35),
      // 타자는 글자 수만큼이되 칸 몫을 넘지 않게(긴 수식도 한 칸 몫 안에)
      type: Math.round(per * 0.45),
      hold: Math.round(per * 0.2),
    };
  });
}

/** 타자 치는 모양 — t(0~1) 만큼 앞에서부터 */
export const typed = (text: string, t: number) => [...text].slice(0, Math.ceil([...text].length * Math.max(0, Math.min(1, t)))).join('');

/** 건너뛸 칸 — 사용자가 아직 안 저장한 고침이 있거나 지금 편집기로 고치는 칸(사용자 것을 덮지 않는다) */
export function skipOf(steps: Step[], keyOf: (p: Put) => string, mine: Set<string>, editing: string | null): Set<string> {
  return new Set(steps.filter((s) => { const k = keyOf(s.put); return mine.has(k) || k === editing; }).map((s) => s.label));
}

export interface Change { sheet: number; r: number; c: number; v: string | number | boolean | null; f: string | null }
type Known = { v?: unknown; f?: string | null };

/**
 * 밖이 고친 판(next) — 지금 표(model, 시트 순서!행!열 → 값·수식)와 칸끼리 비교해 바뀐 칸만. 수식 칸은 수식이 같으면 같다(값은 표가 다시 계산).
 * 시트 이름·수가 다르거나 바뀐 칸이 너무 많으면(행을 끼웠을 수 있다) whole — 그땐 통째로 다시 읽는다. 서식만 바뀐 건 안 본다
 */
export function cellChanges(model: Map<string, Known>, modelSheets: string[], next: { sheets: { name: string; cells: { r: number; c: number; v?: unknown; f?: string }[] }[] }, max = 200): { whole: boolean; changes: Change[] } {
  if (next.sheets.length !== modelSheets.length || next.sheets.some((s, i) => s.name !== modelSheets[i])) return { whole: true, changes: [] };
  const num = (a: unknown, b: unknown) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
  const changes: Change[] = [];
  const seen = new Set<string>();
  next.sheets.forEach((s, i) => {
    for (const x of s.cells) {
      const k = `${i}!${x.r}!${x.c}`;
      seen.add(k);
      const m = model.get(k);
      const f = x.f ?? null, mf = m?.f ?? null;
      const same = f || mf ? f === mf : (x.v ?? null) === (m?.v ?? null) || num(x.v, m?.v);
      if (!same) changes.push({ sheet: i, r: x.r, c: x.c, v: (x.v ?? null) as Change['v'], f });
    }
  });
  // 밖에서 비운 칸
  for (const [k, m] of model) {
    if (seen.has(k) || ((m.v ?? null) === null && !m.f)) continue;
    const [i, r, c] = k.split('!').map(Number) as [number, number, number];
    changes.push({ sheet: i, r, c, v: null, f: null });
  }
  return changes.length > max ? { whole: true, changes: [] } : { whole: false, changes };
}
