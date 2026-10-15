// 고르기 카드 그림(10/12 사용자) — Rust modes_host::card 가 주는 것: {kind: svg, svg}(chammo.json card 의 Svg 글·svg 파일) · {kind: img, src}(png·jpg·webp
// data URL) · {kind: tree, tree}(마지막으로 그려진 칸) · null. Svg 는 여기서 거르고(modeSvg) data: 그림으로만, 트리는 그리기 트리로 고친다. 못 쓰면 null = 자리표시
import { safeSvg } from './modeSvg';
import { normalize, type TNode } from './modeTree';

export type CardView = { kind: 'img'; src: string } | { kind: 'tree'; tree: TNode };

const IMG = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i;

export function cardView(raw: unknown): CardView | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { kind?: unknown; svg?: unknown; src?: unknown; tree?: unknown };
  if (r.kind === 'svg') {
    const s = safeSvg(r.svg);
    return s ? { kind: 'img', src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}` } : null;
  }
  if (r.kind === 'img') return typeof r.src === 'string' && IMG.test(r.src) ? { kind: 'img', src: r.src } : null;
  if (r.kind === 'tree' && r.tree && typeof r.tree === 'object') return { kind: 'tree', tree: normalize(r.tree) };
  return null;
}
