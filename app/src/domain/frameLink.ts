// 시안 칸(html 미리보기) 안 웹 링크(2026-11-05 사용자) — 칸의 링크 다리(reader.rs LINK_BRIDGE)가 넘긴 {hodoc:'link'} 를 다시 거르고,
// 그 참모·프로젝트 브라우저 탭으로 연다. 칸은 남의 html 이라 넘긴 말을 믿지 않는다(Rust agent_open_tab 도 web_url 로 한 번 더)

/** 칸이 넘긴 링크 → 열어도 되는 웹 주소(http·https, 4096자 안, 공백·제어 문자 없음, 앱 파일 주소 아님). 아니면 null. 주소는 안 바꾼다 */
export function frameLink(data: unknown): string | null {
  const d = data as { hodoc?: unknown; url?: unknown } | null;
  if (!d || typeof d !== 'object' || d.hodoc !== 'link' || typeof d.url !== 'string') return null;
  const u = d.url;
  if (u.length > 4096 || /[\s\p{Cc}]/u.test(u) || !/^https?:\/\/[^/?#]/i.test(u)) return null;
  try { if (new URL(u).hostname === 'hodoc.localhost') return null; } catch { return null; }
  return u;
}

const fwd = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');

/** 프로젝트 뿌리 — devRoot 아래면 devRoot/<첫 폴더>(워크트리도 그 프로젝트), 밖이면 그 폴더 그대로 */
function rootOf(p: string, devRoot: string): string {
  const d = fwd(devRoot);
  const f = fwd(p);
  if (d && f.startsWith(`${d}/`)) return `${d}/${f.slice(d.length + 1).split('/')[0]}`;
  return f;
}

/** 링크를 열 브라우저 — 그 문서 프로젝트를 맡은 세션(이 참모가 맡긴 것) 중 브라우저가 떠 있는 것, 없으면 'hq'(지금 보는 참모의 참모 브라우저 — 없으면 띄운다) */
export function linkBrowser(doc: string, held: { cwd: string; live?: { profile: string } }[], devRoot: string): { profile: string } | 'hq' {
  const f = fwd(doc);
  const hit = held.find((s) => s.live && s.cwd && f.startsWith(`${rootOf(s.cwd, devRoot)}/`));
  return hit?.live ? { profile: hit.live.profile } : 'hq';
}

/** 칸 지킴이(2026-11-05 참모 업데이트 — 칸이 바깥 사이트로 넘어가 하얘졌다). 칸이 문서를 띄울 때마다(load) 링크 다리가 here 를 보낸다 —
 *  잠깐 기다려도 here 가 load 보다 적으면 다리 없는 남의 페이지가 뜬 것이라 원래 문서로 되돌린다(leave 는 떠나는 순간을 일찍 알릴 뿐 — 크롬은 떠나는 문서의 말이 안 닿을 때가 있다).
 *  here 가 한 번도 없던 칸(다리가 안 도는 시안)은 안 건드리고, 30초 안 3번까지(문서가 안 열려 되돌림이 도는 고리 막기) — 넘으면 gone(다시 불러오기 아이콘만) */
export type Guard = { loads: number; heres: number; resets: number[] };
export const GUARD0: Guard = { loads: 0, heres: 0, resets: [] };
export const GUARD_WAIT_MS = 1500;
const RESET_WINDOW_MS = 30_000;
const RESET_MAX = 3;

export function guardStep(g: Guard, ev: 'here' | 'leave' | 'load' | 'check', now: number): { g: Guard; wait?: true; reset?: true; gone?: true } {
  if (ev === 'here') return { g: { ...g, heres: g.heres + 1 } };
  if (ev === 'leave') return { g, wait: true };
  if (ev === 'load') return { g: { ...g, loads: g.loads + 1 }, wait: true };
  if (g.heres === 0 || g.heres >= g.loads) return { g };
  const resets = g.resets.filter((t) => now - t < RESET_WINDOW_MS);
  if (resets.length >= RESET_MAX) return { g: { ...g, resets }, gone: true };
  // 남의 페이지 load 는 here 가 영영 안 온다 — 셈을 맞춰 두고 되돌린다(되돌린 문서의 load·here 가 짝이 된다)
  return { g: { ...g, heres: g.loads, resets: [...resets, now] }, reset: true };
}

/** 다리가 보낸 칸 신호 — here·leave 만 */
export function guardMsg(data: unknown): 'here' | 'leave' | null {
  const h = (data as { hodoc?: unknown } | null)?.hodoc;
  return h === 'here' || h === 'leave' ? h : null;
}
