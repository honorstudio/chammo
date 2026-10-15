// 홈 모드 칸 배치(홈·모드 v1 정할 것 2·3, 사용자 10/11) — 홈 가운데 = 모드 칸(아래 세션 줄만 뺀 전부).
// 1 넓게 · 2 반반 · 3+ 하나 크게 + 옆 쌓기(셋까지, 넘치면 알약 +N). '크게'를 누르면 그 모드가 큰 자리로(순서는 화면이 기억)
export type ModeLayout =
  | { kind: 'none' }
  | { kind: 'one'; big: string }
  | { kind: 'two'; items: [string, string] }
  | { kind: 'big'; big: string; side: string[]; more: string[] };

export const SIDE_MAX = 3;

export function modeLayout(names: string[], big?: string | null): ModeLayout {
  if (!names.length) return { kind: 'none' };
  const first = big && names.includes(big) ? big : names[0]!;
  const rest = names.filter((n) => n !== first);
  if (names.length === 1) return { kind: 'one', big: first };
  if (names.length === 2) return { kind: 'two', items: [first, rest[0]!] };
  return { kind: 'big', big: first, side: rest.slice(0, SIDE_MAX), more: rest.slice(SIDE_MAX) };
}

/** 모드 여럿 켜기 — 하나씩 차례로(한꺼번에 쏘면 기억 쓰기가 겹쳐 하나만 켜졌다, 10/12). 실패는 삼키지 않고 이름·까닭으로 돌려준다 */
export async function openInTurn(names: readonly string[], open: (name: string) => Promise<unknown>): Promise<{ name: string; error: string }[]> {
  const failed: { name: string; error: string }[] = [];
  for (const name of names) {
    try {
      await open(name);
    } catch (e) {
      failed.push({ name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return failed;
}

// ── 모드 고르기(10/12 사용자 "내가 만든 것도 여기서, 여러 개 골라 켜기") — 데스크톱 시트·빈 칸, 폰 시트가 같이 쓴다 ──

/** 홈 맛보기 예시 이름(Rust modes::HOME_TRY 와 같다) — 이 넷만 고르기 목록에 낸다 */
export const HOME_TRY_NAMES = ['home-calendar', 'home-board', 'home-todo', 'team-status'] as const;

type PickRow = { name: string; title: string; source: string; on: boolean; where: string; dash?: string | null; /** 숨긴 기본 모드 — 고르기엔 안 낸다 */ hidden?: boolean };
export type PickItem = { name: string; title: string; example: boolean; /** 이 홈에 켜졌나 */ here: boolean;
  /** 다른 자리에 켜졌으면 그 자리 — 고르면 이리로 옮겨 온다(모드 하나 = 자리 하나). dash 면 그 대시보드 이름 */
  elsewhere: { where: string; dash: string | null } | null };

/** 고르기 목록 — 위 '내가 만든 것'(folder·added·plugin, 이름 순), 아래 '예시'(맛보기 넷, 정한 순서). 목록을 아직 못 읽었으면 예시는 이름만으로. 숨긴 것은 뺀다 */
export function pickGroups(rows: readonly PickRow[], keys: readonly string[], exampleTitle: (name: string) => string): { own: PickItem[]; examples: PickItem[] } {
  const ks = new Set(keys.filter(Boolean));
  const item = (r: PickRow, example: boolean): PickItem => {
    const here = r.on && r.where === 'dash' && !!r.dash && ks.has(r.dash);
    return { name: r.name, title: r.title || r.name, example, here, elsewhere: r.on && !here ? { where: r.where, dash: r.where === 'dash' ? r.dash ?? null : null } : null };
  };
  const own = rows.filter((r) => r.source !== 'example' && !r.hidden).map((r) => item(r, false)).sort((a, b) => a.title.localeCompare(b.title));
  const hid = new Set(rows.filter((r) => r.hidden).map((r) => r.name));
  const examples = HOME_TRY_NAMES.filter((n) => !hid.has(n)).map((n) => {
    const r = rows.find((x) => x.name === n && x.source === 'example');
    return r ? { ...item(r, true), title: exampleTitle(n) } : { name: n, title: exampleTitle(n), example: true, here: false, elsewhere: null };
  });
  return { own, examples };
}

/** 고른 것과 지금 이 홈에 켜진 것의 차이 — 켤 것(고른 순서)·끌 것 */
export function pickDiff(here: readonly string[], chosen: readonly string[]): { open: string[]; close: string[] } {
  return { open: chosen.filter((n) => !here.includes(n)), close: here.filter((n) => !chosen.includes(n)) };
}
