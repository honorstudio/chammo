// 참모 모드 Svg 칸 — 모드가 준 SVG 글을 거른 뒤 data: <img> 로만 그린다(docs/research/2026-10-05-chammo-mod.md ④ 보안).
// <img> 로 그린 SVG 는 브라우저가 스크립트·바깥 불러오기를 원래 막는다 — 거름은 그 위에 한 겹 더(허용 목록: 고쳐 쓰지 않고 수상하면 통째로 버린다).
// 버리면 '못 그림' 칸(alt). DOM 없이 글로만 본다(앱 테스트엔 DOM 이 없다)

/** 엔진과 같은 한도(2.1.296: Svg source 128 KiB) */
export const SVG_MAX = 128 * 1024;

// 앞머리: <?xml …?>·주석·공백 뒤 바로 <svg
const HEAD = /^(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>/]/i;
// 그 자체로 위험한 것 — 스크립트·끼운 HTML·이벤트 속성·애니메이션으로 속성 바꾸기·DOCTYPE/ENTITY·바깥 CSS
const BAD = [
  /<\s*\/?\s*(?:script|foreignobject|iframe|embed|object|handler|listener|set|animate|animatemotion|animatetransform|discard)\b/i,
  /[\s/"']on[a-z]+\s*=/i,
  /<!(?:doctype|entity)/i,
  /@import/i,
  /\bsrc\s*=/i,
];
// 주소 칸(href·xlink:href)과 url(…) — 안쪽(#id)·data 그림(png·jpeg·gif·webp)만. 날 글 그대로 본다(엔티티로 숨긴 건 '#'·'data:' 로 안 시작해서 버려진다)
const HREF = /\b(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const URL_FN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
const OK_REF = /^(?:#[\w.:-]*|data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]*)$/i;

function refsOk(svg: string, re: RegExp): boolean {
  for (const m of svg.matchAll(re)) {
    const v = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!OK_REF.test(v)) return false;
  }
  return true;
}

/** 그려도 되는 SVG 글이면 그 글(앞뒤 공백만 뗀다), 아니면 null */
export function safeSvg(source: unknown): string | null {
  if (typeof source !== 'string') return null;
  const s = source.trim();
  if (!s || s.length > SVG_MAX || !HEAD.test(s)) return null;
  if (BAD.some((re) => re.test(s))) return null;
  if (!refsOk(s, HREF) || !refsOk(s, URL_FN)) return null;
  return s;
}

/** <img src> — 거른 SVG 의 data: 주소, 걸러지면 null */
export function svgSrc(source: unknown): string | null {
  const s = safeSvg(source);
  return s === null ? null : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
}
