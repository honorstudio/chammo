/**
 * 리더 창 — 디자인 큐레이션(HTML)·PDF·마크다운·그림을 한 창에서 탭으로 본다(사용자 2026-09-28).
 * 참모가 scripts/show 로 넘기거나 창에 끌어다 놓으면 열린다. 파일은 hodoc:// 로 읽는다(Rust reader.rs, 홈 폴더 안만)
 */
export type DocKind = 'html' | 'pdf' | 'md' | 'image' | 'text';

export function kindOf(path: string): DocKind {
  const ext = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  return 'text';
}

const PLAIN = /^(index\.html?|readme\.md)$/i;
/** 탭 이름 — 파일 이름. index.html·README.md 처럼 흔한 이름은 폴더를 앞에 붙인다 */
export function titleOf(path: string): string {
  const parts = path.split('/').filter(Boolean);
  const name = parts[parts.length - 1] ?? path;
  return PLAIN.test(name) && parts.length > 1 ? `${parts[parts.length - 2]}/${name}` : name;
}

export type Surface = { tabs: string[]; active: string | null };

/** 탭을 끌 때 끼울 자리 — 각 탭 가운데보다 왼쪽이면 그 앞. 탭 줄 폭(rects = 각 탭의 [left, right]) */
export function dropIndex(rects: [number, number][], x: number): number {
  const i = rects.findIndex(([l, r]) => x < (l + r) / 2);
  return i < 0 ? rects.length : i;
}

/** 탭 줄 위아래로 조금 벗어나도 줄 안으로 친다(크롬처럼 살짝 흔들려도 안 떨어지게) */
export const inStrip = (strip: { top: number; bottom: number; left: number; right: number }, x: number, y: number, slack = 24) =>
  y >= strip.top - slack && y <= strip.bottom + slack && x >= strip.left && x <= strip.right;

/** 리더 전용 주소 — 경로 조각마다 인코딩(한글·공백), 슬래시는 그대로. 상대 경로(시안의 body/*.js)가 그대로 풀린다 */
export function docUrl(path: string): string {
  return `hodoc://localhost${path.split('/').map(encodeURIComponent).join('/')}`;
}
