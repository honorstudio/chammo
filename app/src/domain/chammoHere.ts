// 이 컴퓨터·다른 기기의 Chammo 데이터 폴더별 로그인 계정(Rust chammo_here, /api/env chammoAccounts) — 화면 판단만.
// 10-26: 아이맥 시험판이 남의 계정에 붙어 있었는데 본판 화면에도 다른 기기에도 안 보였다
export type HereAccount = { folder: string; current: boolean; email: string; name: string };
export type HereRow = { folder: string; who: string; other: boolean };

const whoOf = (a: HereAccount) => (a.email && a.name ? `${a.email} (${a.name})` : a.email || a.name);
const isOther = (a: HereAccount, mine: string) => !!mine && !!a.email && a.email.toLowerCase() !== mine.toLowerCase();

/** 지금 앱이 아닌 데이터 폴더들 — other = 내 계정(mine 이메일)과 다른 계정 */
export function hereOthers(list: HereAccount[], mine: string): HereRow[] {
  return list.filter((a) => !a.current).map((a) => ({ folder: a.folder, who: whoOf(a), other: isOther(a, mine) }));
}

/** 다른 기기 줄 — 그 기기 앱 계정(main)과 그 기기의 다른 데이터 폴더. 옛 판(칸 없음)이면 null */
export function peerAccount(list: HereAccount[] | undefined, mine: string): { main: { who: string; other: boolean; signedIn: boolean } | null; others: HereRow[] } | null {
  if (!list || list.length === 0) return null;
  const cur = list.find((a) => a.current);
  const main = cur ? { who: whoOf(cur), other: isOther(cur, mine), signedIn: !!(cur.email || cur.name) } : null;
  return { main, others: hereOthers(list, mine) };
}
