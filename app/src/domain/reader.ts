/**
 * 리더 창 — 디자인 큐레이션(HTML)·PDF·마크다운·그림·영상을 한 창에서 탭으로 본다(사용자 2026-09-28).
 * 참모가 scripts/show 로 넘기거나 창에 끌어다 놓으면 열린다. 파일은 hodoc:// 로 읽는다(Rust reader.rs, 홈 폴더 안만)
 */
export type DocKind = 'html' | 'pdf' | 'md' | 'image' | 'video' | 'audio' | 'office' | 'text' | 'other';

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico', 'tif', 'tiff', 'heic', 'heif'];
const VIDEO = ['mp4', 'm4v', 'mov', 'webm'];
const AUDIO = ['mp3', 'm4a', 'wav', 'aac', 'ogg', 'oga', 'flac', 'aif', 'aiff', 'caf'];
/** macOS textutil 이 HTML 로 바꿔 주는 문서 */
const OFFICE = ['doc', 'docx', 'rtf', 'rtfd', 'odt', 'wordml', 'webarchive'];
/** 글로 읽어도 되는 것 — 이 밖의 확장자는 바이너리로 보고 QuickLook 미리보기 그림 + 기본 앱으로 */
const TEXT = ['txt', 'log', 'json', 'jsonl', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'scss', 'less', 'py', 'rb', 'go', 'rs', 'swift', 'kt', 'kts',
  'java', 'c', 'h', 'cc', 'cpp', 'hpp', 'm', 'mm', 'cs', 'php', 'sh', 'zsh', 'bash', 'fish', 'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg', 'env',
  'xml', 'csv', 'tsv', 'sql', 'graphql', 'gql', 'vue', 'svelte', 'astro', 'lock', 'plist', 'gradle', 'properties', 'tex', 'srt', 'vtt', 'diff',
  'patch', 'prisma', 'dart', 'lua', 'r', 'pl', 'ex', 'exs', 'erl', 'hs', 'scala', 'clj', 'zig', 'nim', 'proto', 'mdx', 'rst', 'adoc', 'org'];

/** macOS QuickLook 이 슬라이드·페이지로 나눠 보여 주는 문서 — 번호·글로 짚어 보여 줄 수 있다(2026-09-30) */
const PAGE_DOC = [...OFFICE, 'ppt', 'pptx', 'pps', 'ppsx', 'odp', 'key', 'xls', 'xlsx', 'ods', 'numbers', 'pages'];
export const pageDoc = (path: string) => PAGE_DOC.includes(path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '');

export function kindOf(path: string): DocKind {
  const name = path.toLowerCase().split('/').pop() ?? '';
  const ext = name.match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (IMAGE.includes(ext)) return 'image';
  if (VIDEO.includes(ext)) return 'video';
  if (AUDIO.includes(ext)) return 'audio';
  if (OFFICE.includes(ext)) return 'office';
  // 확장자 없는 파일(Makefile·Dockerfile)·점으로 시작하는 설정(.gitignore)은 글
  if (!ext || name.startsWith('.') || TEXT.includes(ext)) return 'text';
  return 'other';
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
export function docUrl(path: string, win = IS_WIN): string {
  // 윈도우: 역슬래시 → 슬래시, "C:/…" 앞에 "/" — WebView2 는 사용자 주소를 http://hodoc.localhost 로 받는다(윈도우판 2단계)
  const p = path.replace(/\\/g, '/');
  const enc = (p.startsWith('/') ? p : `/${p}`).split('/').map(encodeURIComponent).join('/');
  return win ? `http://hodoc.localhost${enc}` : `hodoc://localhost${enc}`;
}

/** 이 앱의 파일 주소인가 — 맥 hodoc://, 윈도우 http://hodoc.localhost */
export const isDocUrl = (u: URL) => u.protocol === 'hodoc:' || (u.protocol === 'http:' && u.hostname === 'hodoc.localhost');

/** 앱 파일 주소 → 파일 경로(아니면 null). 편집기 다운로드 버튼이 window.open 으로 이 주소를 연다 — 기본 앱으로 넘긴다(2026-10-01 사용자) */
export function pathOfDocUrl(url: string, win = IS_WIN): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!isDocUrl(u)) return null;
  const p = decodeURIComponent(u.pathname);
  return win && /^\/[A-Za-z]:\//.test(p) ? p.slice(1).replace(/\//g, '\\') : p;
}

/** 윈도우에서 도나 — 주소 모양·경로 처리가 갈린다 */
export const IS_WIN = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
