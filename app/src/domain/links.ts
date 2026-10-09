// 터미널에서 ⌘+클릭한 링크 판정. iTerm 처럼 웹 주소는 브라우저로, 파일 경로는 기본 앱으로 연다.
// 상대 경로는 그 세션의 폴더 기준 — 같은 "src/app.ts" 도 세션마다 다른 파일이다.

export type Opened = { kind: 'url'; target: string } | { kind: 'file'; target: string; line?: number };

function normalize(path: string): string {
  // 윈도우 드라이브(C:)는 앞에 / 를 안 붙인다
  const drive = /^[A-Za-z]:(?=\/|$)/.exec(path)?.[0] ?? '';
  const out: string[] = [];
  for (const part of path.slice(drive.length).split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return drive + '/' + out.join('/');
}

export function resolveLink(raw: string, base: string, home: string): Opened | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return { kind: 'url', target: text };
  let path: string;
  if (/^file:\/\//i.test(text)) {
    try {
      path = decodeURIComponent(text.replace(/^file:\/\/(localhost)?/i, ''));
    } catch {
      return null;
    }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[a-z]:[\\/]/i.test(text)) {
    return null; // javascript:, ssh: 등 — 파일·웹이 아닌 스킴은 열지 않는다
  } else {
    path = text;
  }
  let line: number | undefined;
  const m = path.match(/^(.*?):(\d+)(?::\d+)?$/);
  if (m?.[1]) {
    path = m[1];
    line = Number(m[2]);
  }
  if (/^[a-z]:[\\/]/i.test(path)) path = path.replace(/\\/g, '/'); // 윈도우 절대 경로
  else if (path.startsWith('~/')) path = home + path.slice(1);
  else if (!path.startsWith('/')) path = base + '/' + path;
  const target = normalize(path);
  return line == null ? { kind: 'file', target } : { kind: 'file', target, line };
}

// 경로 후보: ~/ · / · 상대 경로이면서 슬래시가 하나 이상 있거나 확장자가 있는 것. 뒤에 :줄(:칸) 허용.
// 이름 글자는 유니코드 글자·숫자 — \w 는 영문만이라 한글 폴더에서 끊겼다(2026-09-28 사용자: ~/Desktop/ 까지만 잡힘)
// 맨 앞은 윈도우 드라이브 경로(C:\\… · C:/…) — 드라이브 글자부터 잡아야 뒤의 /… 만 떼어 잡지 않는다
const PATH_RE = /[A-Za-z]:[\\/](?:[\p{L}\p{N}_.@-]+[\\/])*[\p{L}\p{N}_.@-]+(?::\d+(?::\d+)?)?|(?:~\/|\/)?(?:[\p{L}\p{N}_.@-]+\/)+[\p{L}\p{N}_.@-]+\.[A-Za-z0-9]{1,8}(?::\d+(?::\d+)?)?|(?:~\/|\/)(?:[\p{L}\p{N}_.@-]+\/)*[\p{L}\p{N}_.@-]+(?::\d+)?/gu;
const URL_RE = /https?:\/\/\S+/g;
// 링크로 쓸 웹 주소 — 끝의 문장부호·닫는 괄호·따옴표는 뗀다
const WEB_RE = /https?:\/\/[^\s<>"'`]+/g;

/** 한 줄에서 웹 주소를 찾는다 */
export function findUrls(line: string): { text: string; start: number }[] {
  return [...line.matchAll(WEB_RE)].map((m) => ({ text: m[0].replace(/[.,:;!?)\]}>]+$/, ''), start: m.index! })).filter((m) => m.text.length > 'https://'.length);
}

/** 한 줄에서 링크로 안 찍힌 파일 경로를 찾는다. URL 안쪽은 건너뛴다 */
export function findPaths(line: string): { text: string; start: number }[] {
  const urls: [number, number][] = [];
  for (const u of line.matchAll(URL_RE)) urls.push([u.index!, u.index! + u[0].length]);
  const out: { text: string; start: number }[] = [];
  for (const m of line.matchAll(PATH_RE)) {
    const start = m.index!;
    if (urls.some(([a, b]) => start >= a && start < b)) continue;
    let text = m[0].replace(/[.,:;]+$/, '');
    if (!/[\\/]/.test(text)) continue;
    out.push({ text, start });
  }
  return out;
}

export type Cell = { row: number; col: number };
export type WrappedPath = { text: string; from: Cell; to: Cell };

const EDGE = 4; // 앞 줄이 오른쪽 끝에서 이만큼 안이면 "꽉 찼다"(Claude 화면은 테두리·여백만큼 덜 찬다)
const PATHY = /[\p{L}\p{N}_.@/\\~:?=&%#+-]/u; // 경로·웹 주소에 들어가는 글자
const MAX_ROWS = 3; // 경로 하나가 이보다 많은 줄에 걸치는 일은 드물다

/**
 * 두 줄 이상으로 접힌 경로를 한 링크로. 터미널이 접은 줄(wrapped(i) = i 번째 줄이 앞 줄에 이어짐)은 그대로 잇고,
 * Claude 화면이 직접 줄을 바꾼 경우(표시 없음, 다음 줄에 들여쓰기)는 앞 줄이 끝까지 찼고 경로 글자로 끝나며
 * 다음 줄이 경로 글자로 시작할 때만 들여쓰기를 건너뛰고 잇는다. used = 그 줄이 차지한 화면 칸(한글은 두 칸) — 없으면 글자 수. at 줄에 걸친 링크만 돌려준다(칸은 0부터, to 는 마지막 글자)
 */
export function findPathsWrapped(line: (i: number) => string | null, wrapped: (i: number) => boolean, at: number, cols: number, used?: (i: number) => number): WrappedPath[] {
  const joins = (i: number): boolean => {
    if (wrapped(i)) return true;
    const prev = line(i - 1), cur = line(i);
    if (prev == null || cur == null) return false;
    const p = prev.trimEnd(), c = cur.trimStart();
    return (used ? used(i - 1) : p.length) >= cols - EDGE && PATHY.test(p.slice(-1)) && c.length > 0 && PATHY.test(c[0]!);
  };
  let s = at, e = at;
  while (s > at - MAX_ROWS && s > 0 && joins(s)) s--;
  while (e < at + MAX_ROWS && line(e + 1) != null && joins(e + 1)) e++;
  let joined = '';
  const map: Cell[] = [];
  for (let r = s; r <= e; r++) {
    let text = line(r) ?? '';
    let lead = 0;
    if (r > s && !wrapped(r)) { lead = text.length - text.trimStart().length; text = text.slice(lead); }
    if (r < e && !wrapped(r + 1)) text = text.trimEnd();
    for (let k = 0; k < text.length; k++) map.push({ row: r, col: lead + k });
    joined += text;
  }
  // 웹 주소도 같이 — xterm 기본 링크(WebLinksAddon)는 Claude 화면이 직접 바꾼 줄을 못 이어 윗줄 조각만 잡았다(2026-09-28)
  return [...findUrls(joined), ...findPaths(joined)]
    .map((m) => ({ text: m.text, from: map[m.start]!, to: map[m.start + m.text.length - 1]! }))
    .filter((m) => m.from.row <= at && m.to.row >= at);
}

/** 링크를 어디서 열까 — 웹은 기본 브라우저, 문서(리더가 그리는 것)는 리더, 나머지(코드·폴더)는 기본 앱 */
const READER_EXT = /\.(md|markdown|html?|pdf|png|jpe?g|gif|webp|svg|txt|mp4|m4v|mov|webm)$/i;
export function routeOf(o: Opened): 'browser' | 'reader' | 'app' {
  if (o.kind === 'url') return 'browser';
  return READER_EXT.test(o.target) ? 'reader' : 'app';
}

/**
 * 리더 문서 속 경로 글자를 ⌘클릭했을 때 찾아볼 자리들 — 문서 폴더부터 홈까지 부모로 올라가며.
 * 문서에 적힌 경로는 보통 저장소 루트 기준이라(docs/starter.md 같은) 문서 폴더만 보면 못 찾는다
 */
/** 경로 글자 다듬기 — 따옴표·괄호·끝 구두점·줄 번호를 뗀다. 경로처럼 안 생겼으면 '' */
export function cleanPathText(raw: string): string {
  const text = raw.trim().replace(/^[`'"(<\[]+|[`'")>\],.;:]+$/g, '').replace(/:\d+(?::\d+)?$/, '');
  return !text || /\s/.test(text) || !/[/.]/.test(text) ? '' : text;
}

export function pathCandidates(raw: string, docDir: string, home: string): string[] {
  const text = cleanPathText(raw);
  if (!text) return [];
  if (text.startsWith('~/')) return [normalize(home + text.slice(1))];
  if (text.startsWith('/')) return [normalize(text)];
  const out: string[] = [];
  let dir = normalize(docDir);
  for (;;) {
    out.push(normalize(dir + '/' + text));
    if (dir === normalize(home) || dir === '/') break;
    dir = dir.replace(/\/[^/]+$/, '') || '/';
  }
  return out;
}

/** 다른 프로젝트 기준 경로를 찾을 때 볼 프로젝트 순서 — 같은 문단에 이름이 나온 것부터(나온 순서), 나머지는 그대로 */
export function projectOrder(projects: string[], context: string): string[] {
  const named = projects.filter((p) => context.includes(p)).sort((a, b) => context.indexOf(a) - context.indexOf(b));
  return [...named, ...projects.filter((p) => !named.includes(p))];
}

/**
 * 문서 속 상대 경로를 프로젝트 폴더들 안에서 찾을 후보 — devRoot 아래 프로젝트 + 따로 추가한 폴더(extras, 그 폴더 그대로).
 * 같은 문단에 나온 이름 먼저. 이름이 겹치면 추가 폴더 쪽 하나만(projectDir 와 같은 규칙)
 */
export function projectRelCandidates(raw: string, devProjects: string[], extras: string[], devRoot: string, context: string): string[] {
  const rel = cleanPathText(raw);
  if (!rel || rel.startsWith('/') || rel.startsWith('~')) return [];
  const dirs = new Map<string, string>();
  if (devRoot) for (const p of devProjects) dirs.set(p, `${devRoot.replace(/\/+$/, '')}/${p}`);
  for (const x of extras) {
    const dir = x.replace(/\/+$/, '');
    const name = dir.replace(/^.*\//, '');
    if (name) { dirs.delete(name); dirs.set(name, dir); }
  }
  return projectOrder([...dirs.keys()], context).map((p) => normalize(`${dirs.get(p)!}/${rel}`));
}
