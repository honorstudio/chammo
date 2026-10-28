// 세션 브라우저 칸 주소창(2026-10-28 사용자) — 친 글이 주소면 그 주소로, 아니면 기본 검색(설정 '기본 검색', 구글·네이버).
// 갈 수 있는 건 http·https 만 — javascript:·file:·chrome: 같은 건 검색어로 본다
export type SearchEngine = 'google' | 'naver';

export const SEARCH_ENGINES: SearchEngine[] = ['google', 'naver'];

export function searchUrl(q: string, engine: string): string {
  const e = encodeURIComponent(q);
  return engine === 'naver' ? `https://search.naver.com/search.naver?query=${e}` : `https://www.google.com/search?q=${e}`;
}

const LOCAL = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?(\/|$)/i;
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?(\/|$)/i;

/** 친 글 → 갈 주소. 비었으면 null */
export function addressTarget(text: string, engine: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const web = (u: string) => { try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null; } catch { return null; } };
  if (/^https?:\/\//i.test(t)) return web(t) ?? searchUrl(t, engine);
  if (!/\s/.test(t)) {
    if (LOCAL.test(t)) return web(`http://${t}`) ?? searchUrl(t, engine);
    if (HOST.test(t)) return web(`https://${t}`) ?? searchUrl(t, engine);
  }
  return searchUrl(t, engine);
}

/** 주소창에 보일 글 — 빈 탭(about:blank)은 비우고, %EC… 는 크롬처럼 한글로 풀어 보인다(못 풀면 그대로). 고쳐 Enter 하면 다시 주소로(new URL) */
export function shownAddress(url: string | undefined): string {
  if (!url || url === 'about:blank') return '';
  try { return decodeURI(url); } catch { return url; }
}
