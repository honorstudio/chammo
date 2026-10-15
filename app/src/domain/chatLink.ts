// 고른 프사 ↔ 채팅 칸 이음 윤곽(2026-10-12 사용자 201.png "창이랑 참모를 연결해서 테두리가 한 컬러로") —
// 탭이 내용에 붙은 모양처럼 고른 프사 칸(위·왼쪽·아래)과 채팅 카드(둥근 사각 전체)를 끊김 없는 선 하나로. 맞닿는 변만 열려 있다.
// 좌표는 바깥 사각(같은 부모 기준), 선은 그 안쪽 반 두께에 그어 바깥으로 안 샌다(창·옆 칸 가장자리에 잘리지 않게)

/** 참모를 바꿀 때 이음 탭이 새 자리로 옮겨 가는 시간 — 스페이스 바꿔 끼우기(domain/switchHold)가 이게 끝나길 기다린다 */
export const LINK_MOVE_MS = 140;

export type Box = { x: number; y: number; w: number; h: number };
export type LinkOpts = { r?: number; rt?: number; ri?: number; sw?: number };
export type LinkGeom = {
  card: { x0: number; y0: number; x1: number; y1: number; r: number };
  /** null = 탭이 카드 위아래 밖(그땐 카드만) */
  tab: { tx0: number; ty0: number; ty1: number; rt: number; rTop: number; fTop: number; rBot: number; fBot: number } | null;
  /** 맞닿는 곳 오목 모서리 안쪽 면 — 띠 경계선을 덮어 탭 면과 카드 면이 한 면으로 보이게 */
  fills: string[];
};

const f = (n: number) => String(Math.round(n * 10) / 10);
const arc = (r: number, sweep: 0 | 1, x: number, y: number) => (r > 0.05 ? ` A ${f(r)} ${f(r)} 0 0 ${sweep} ${f(x)} ${f(y)}` : ` L ${f(x)} ${f(y)}`);

/** 카드 모서리 r(12), 탭 바깥 모서리 rt(12), 맞닿는 곳 오목 ri(8), 선 두께 sw(2) */
export function linkGeom(card: Box, tab: Box | null, o: LinkOpts = {}): LinkGeom {
  const sw = o.sw ?? 2;
  const h = sw / 2;
  const r = o.r ?? 12;
  const ri = o.ri ?? 8;
  const c = { x0: card.x + h, y0: card.y + h, x1: card.x + card.w - h, y1: card.y + card.h - h, r: Math.min(r, (card.w - sw) / 2, (card.h - sw) / 2) };
  if (!tab) return { card: c, tab: null, fills: [] };
  const rt = Math.min(o.rt ?? 12, (tab.h - sw) / 2);
  const ty0 = Math.max(tab.y + h, c.y0);
  const ty1 = Math.min(tab.y + tab.h - h, c.y1);
  if (ty1 - ty0 < rt * 2) return { card: c, tab: null, fills: [] };
  // 탭과 카드 위·아래 끝 사이가 좁으면 카드 모서리·오목을 반씩 나눠 줄인다(꼬이지 않게)
  const split = (gap: number): [number, number] => (gap >= c.r + ri ? [c.r, ri] : [gap / 2, gap / 2]);
  const [rTop, fTop] = split(ty0 - c.y0);
  const [rBot, fBot] = split(c.y1 - ty1);
  const x0 = c.x0;
  const fills = [
    fTop > 0.05 ? `M ${f(x0 - fTop)} ${f(ty0)}${arc(fTop, 0, x0, ty0 - fTop)} L ${f(x0)} ${f(ty0)} Z` : '',
    fBot > 0.05 ? `M ${f(x0)} ${f(ty1 + fBot)}${arc(fBot, 0, x0 - fBot, ty1)} L ${f(x0)} ${f(ty1)} Z` : '',
  ].filter(Boolean);
  return { card: c, tab: { tx0: tab.x + h, ty0, ty1, rt, rTop, fTop, rBot, fBot }, fills };
}

/** 윤곽 한 줄(SVG path d) — 탭 위 → 카드 둘레(시계 방향) → 탭 아래 → 탭 바깥 */
export function linkPath(card: Box, tab: Box | null, o: LinkOpts = {}): string {
  const { card: c, tab: t } = linkGeom(card, tab, o);
  const { x0, y0, x1, y1, r } = c;
  if (!t) {
    return `M ${f(x0 + r)} ${f(y0)} H ${f(x1 - r)}${arc(r, 1, x1, y0 + r)} V ${f(y1 - r)}${arc(r, 1, x1 - r, y1)} H ${f(x0 + r)}${arc(r, 1, x0, y1 - r)} V ${f(y0 + r)}${arc(r, 1, x0 + r, y0)} Z`;
  }
  const { tx0, ty0, ty1, rt, rTop, fTop, rBot, fBot } = t;
  return `M ${f(tx0 + rt)} ${f(ty0)} H ${f(x0 - fTop)}${arc(fTop, 0, x0, ty0 - fTop)} V ${f(y0 + rTop)}${arc(rTop, 1, x0 + rTop, y0)}`
    + ` H ${f(x1 - r)}${arc(r, 1, x1, y0 + r)} V ${f(y1 - r)}${arc(r, 1, x1 - r, y1)}`
    + ` H ${f(x0 + rBot)}${arc(rBot, 1, x0, y1 - rBot)} V ${f(ty1 + fBot)}${arc(fBot, 0, x0 - fBot, ty1)}`
    + ` H ${f(tx0 + rt)}${arc(rt, 1, tx0, ty1 - rt)} V ${f(ty0 + rt)}${arc(rt, 1, tx0 + rt, ty0)} Z`;
}
