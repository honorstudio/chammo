// 폰 '주고받은 파일' 보기 — 종류 가르기·웹 주소 카드·CSV 표·JSON 들여쓰기·md 속 그림 경로. 화면·통신 없음
// (전략 표 3·5번, docs/plans/2026-10-03-phone-files.md)

export type PhoneKind = 'image' | 'pdf' | 'md' | 'html' | 'json' | 'csv' | 'code' | 'text' | 'web' | 'office' | 'video';

const CODE = /\.(ts|tsx|js|jsx|mjs|py|rs|sh|swift|kt|css|sql|yaml|yml|toml)$/i;

export function fileKind(path: string): PhoneKind {
  if (/^https?:\/\//i.test(path)) return 'web';
  if (/\.(png|jpe?g|gif|webp|heic|heif)$/i.test(path)) return 'image';
  if (/\.pdf$/i.test(path)) return 'pdf';
  if (/\.(md|markdown)$/i.test(path)) return 'md';
  if (/\.html?$/i.test(path)) return 'html';
  if (/\.json$/i.test(path)) return 'json';
  if (/\.(csv|tsv)$/i.test(path)) return 'csv';
  if (CODE.test(path)) return 'code';
  if (/\.(pptx?|key|docx?|pages|xlsx?|numbers)$/i.test(path)) return 'office';
  if (/\.(mp4|mov|m4v)$/i.test(path)) return 'video';
  return 'text';
}

/** 파일을 못 열었을 때 한 줄 — 없는 파일(404, 워크트리를 닫아 본 폴더에서도 못 찾은 것 등)은 오류가 아니라 지워졌다고 */
export function fileError(m: string, why: Record<string, string> = {}): { text: string; gone: boolean } {
  if (m === 'not found') return { text: '지워졌어요', gone: true };
  return { text: why[m] ?? `못 열었어요: ${m}`, gone: false };
}

/** 웹 주소 카드 — 도메인(www. 뺌)과 그 뒤. 주소가 아니면 null */
export function webParts(url: string): { host: string; rest: string } | null {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    const rest = `${u.pathname === '/' ? '' : u.pathname}${u.search}`;
    return { host: u.host.replace(/^www\./, ''), rest };
  } catch {
    return null;
  }
}

/** CSV·TSV 를 줄·칸으로 — 따옴표 안 구분자·줄바꿈·"" 를 지킨다. 너무 길면 앞 max 줄만 */
export function csvRows(text: string, sep: string, max = 1000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length && rows.length < max; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if ((cell !== '' || row.length) && rows.length < max) { row.push(cell); rows.push(row); }
  return rows;
}

/** JSON 들여쓰기 — 못 읽으면 null(글 그대로 보인다) */
export function prettyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

/** md 속 그림 상대 경로 → 맥 절대 경로(서버 mobile_files::md_images 와 같은 규칙). 웹 주소·절대 경로·data: 는 null */
export function resolveRel(doc: string, rel: string): string | null {
  if (!rel || /^[a-z][a-z0-9+.-]*:/i.test(rel) || rel.startsWith('/') || rel.startsWith('#') || rel.startsWith('~')) return null;
  let dec: string;
  try { dec = decodeURIComponent(rel); } catch { return null; }
  const parts = doc.split('/').slice(0, -1);
  for (const p of dec.split('/')) {
    if (p === '..') parts.pop();
    else if (p && p !== '.') parts.push(p);
  }
  return parts.join('/') || null;
}

/** 카드 썸네일 앞부분 — 글은 한 덩어리(머리표·강조 뺌) 220자, 코드는 줄 모양 그대로 앞 12줄(탭은 두 칸) */
export function textHead(text: string, code: boolean): string {
  if (code) return text.split('\n').slice(0, 12).map((l) => l.replace(/\t/g, '  ').slice(0, 80)).join('\n');
  return text.replace(/^#+\s*/gm, '').replace(/[*_`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 220);
}

/** 폰 문서 속 그림 주소를 남길까 — 상대 경로만(서버가 그 문서 덕에 열어 준다). 웹 그림은 폰 주소가 남에게 새서 지운다 */
export const docImgSrcOk = (src: string) => !!src && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith('/');

/** 영상 — 20MB 넘으면 재생 전에 묻는다(LTE 데이터) */
export const askBeforePlay = (size: number) => size > 20 * 1024 * 1024;

/** 크기 글 — 1KB 아래는 1KB, 10MB 아래는 소수 한 자리 */
export function sizeLabel(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))}KB`;
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)}MB`;
}

/** 워드(글로 바꿔 보여 줄 수 있는 오피스) */
export const wordDoc = (path: string) => /\.docx?$/i.test(path);
