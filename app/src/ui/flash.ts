// 짚어 보여 주기 — 문서 속 한 곳으로 스크롤하고 몇 초 반짝인다(scripts/show --line/--find, 2026-09-30 사용자).
// 글자는 CSS Custom Highlight 로 칠해 편집기 문서를 안 건드리고, 그 줄 둘레에 잠깐 빛나는 테두리를 띄운다
import { locate } from '../domain/findText';
import { lineNeedle, type ShowAt } from '../domain/showAt';

type HL = new (...r: Range[]) => unknown;
const Highlight = (globalThis as unknown as { Highlight?: HL }).Highlight;
const highlights = () => (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;

function textNodes(root: HTMLElement): Text[] {
  const out: Text[] = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue) out.push(n as Text);
  return out;
}

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let e = el; e; e = e.parentElement) {
    const o = getComputedStyle(e).overflowY;
    if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight) return e;
  }
  return null;
}

/** 찾을 글 — --find 가 우선, 없으면 원본 줄 번호를 화면 글로 */
function needles(at: ShowAt, src: string | undefined, raw: boolean) {
  if (at.find) return { a: { needle: at.find, nth: 0 }, b: null };
  if (!at.line || src == null) return null;
  const a = lineNeedle(src, at.line, raw);
  const b = at.lineEnd && at.lineEnd > at.line ? lineNeedle(src, at.lineEnd, raw) : null;
  return a ? { a, b } : null;
}

let stop: (() => void) | null = null;

/** root 안에서 at 이 가리키는 곳을 찾아 가운데로 스크롤하고 반짝인다. 못 찾으면 false(아직 안 그려졌으면 다시 부르면 된다) */
export function flashAt(root: HTMLElement, at: ShowAt, src?: string, raw = false): boolean {
  const n = needles(at, src, raw);
  if (!n) return false;
  const nodes = textNodes(root);
  const parts = nodes.map((t) => t.nodeValue ?? '');
  const s = locate(parts, n.a.needle, n.a.nth);
  if (!s) return false;
  const e = (n.b && locate(parts, n.b.needle, n.b.nth)) || s;
  const range = document.createRange();
  range.setStart(nodes[s.start[0]]!, s.start[1]);
  range.setEnd(nodes[e.end[0]]!, e.end[1]);
  stop?.();

  const el = nodes[s.start[0]]!.parentElement!;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });

  // 글자 칠하기 — 몇 번 깜빡이고 옅게 남았다가 사라진다
  const hs = Highlight ? highlights() : undefined;
  let blink = 0;
  hs?.set('cv-flash', new Highlight!(range));
  const tick = hs ? window.setInterval(() => {
    blink++;
    if (blink < 6) {
      if (blink % 2) hs.delete('cv-flash');
      else hs.set('cv-flash', new Highlight!(range));
      return;
    }
    hs.delete('cv-flash');
    hs.set('cv-flash-soft', new Highlight!(range));
    window.clearInterval(tick);
  }, 320) : 0;

  // 줄 둘레 빛나는 테두리 — 스크롤 칸 안에 붙여 같이 움직인다
  const box = scrollParent(el) ?? root;
  if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
  const r = range.getBoundingClientRect();
  const block = (el.closest('tr, li, [data-node-type="blockContainer"], p, h1, h2, h3, h4, h5, h6, pre, td') as HTMLElement | null) ?? el;
  const br = block.getBoundingClientRect();
  const bb = box.getBoundingClientRect();
  const top = Math.min(r.top, br.top), bottom = Math.max(r.bottom, br.bottom);
  const ring = document.createElement('div');
  ring.className = 'cv-flash-ring';
  Object.assign(ring.style, { top: `${top - bb.top + box.scrollTop - 4}px`, left: `${Math.min(br.left, r.left) - bb.left + box.scrollLeft - 6}px`, width: `${Math.max(br.width, r.width) + 12}px`, height: `${bottom - top + 8}px` });
  box.appendChild(ring);

  const soft = window.setTimeout(() => { stop?.(); }, 6000);
  stop = () => { window.clearInterval(tick); window.clearTimeout(soft); hs?.delete('cv-flash'); hs?.delete('cv-flash-soft'); ring.remove(); stop = null; };
  return true;
}

/** 그려질 때까지 몇 번 다시 해 본다(편집기·PDF 는 늦게 그려진다) */
export function flashWhenReady(root: () => HTMLElement | null, at: ShowAt, src?: string, raw = false, tries = 12): () => void {
  let k = 0;
  let t = 0;
  const go = () => {
    const r = root();
    if (r && flashAt(r, at, src, raw)) return;
    if (++k < tries) t = window.setTimeout(go, 200);
  };
  t = window.setTimeout(go, 120);
  return () => window.clearTimeout(t);
}
