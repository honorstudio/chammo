// 내 메모(시안 docs/design-drafts/memo-panel C) — 맥 패널·따로 창·폰 탭이 같이 쓰는 판단. 저장은 Rust notes.rs
/** skin·shown·win 은 Rust notes/.meta.json(맥·폰 같은 목록) — win = 따로 창에 떠 있음(패널엔 안 쌓는다) */
export type NoteRow = { name: string; path: string; title: string; preview: string; at: number; skin: NoteSkin; shown: boolean; win: boolean };

/** 스킨 4종(시안 v2 K) — 메모지·줄 노트·어두운 종이·터미널. 앱이 어두운 판이어도 스킨 색은 그대로 */
export const SKINS = ['paper', 'lined', 'dark', 'term'] as const;
export type NoteSkin = (typeof SKINS)[number];
export const skinOf = (s: string | undefined): NoteSkin => ((SKINS as readonly string[]).includes(s ?? '') ? (s as NoteSkin) : 'paper');

/** 패널에 쌓을 것(띄움·창 아님, 만든 순 새 것 위) / 따로 창 / 목록 두 칸(띄운 = 쌓기 + 창, 안 띄운 = 최근 고친 순) */
export function splitNotes(rows: NoteRow[]) {
  const byMade = (a: NoteRow, b: NoteRow) => b.name.localeCompare(a.name, 'en', { numeric: true });
  const stack = rows.filter((r) => r.shown && !r.win).sort(byMade);
  const windows = rows.filter((r) => r.shown && r.win).sort(byMade);
  return { stack, windows, shown: [...stack, ...windows], hidden: rows.filter((r) => !r.shown).sort((a, b) => b.at - a.at) };
}

/** 폰 메모 탭이 기억해 두는 카드(ui/mobile/memo) — 마지막으로 맥과 맞춘 글과 그때 목록의 고친 시각. 탭을 다시 열면 이걸 바로 그린다 */
export type NoteSeen = { text: string; at: number };
/** 카드 글을 다시 받아야 하나 — 기억이 없거나, 목록의 고친 시각이 기억과 다르거나(맥·다른 기기가 고침), 시각을 모르면(0) */
export const noteStale = (seen: NoteSeen | undefined, at: number): boolean => !seen || !at || seen.at !== at;
/** 맥에서 새로 받은 글을 글 칸에 갈까. local = 글 칸, known = 맥과 마지막으로 맞춘 글(저장 base, 아직 없으면 null).
 *  쓰는 중(local ≠ known)이면 안 간다(keep) — 친 글·커서를 지키고, 저장은 옛 base 로 가 맥에서 막힌다(CHANGED_OUTSIDE, 맥 글을 안 덮는다) */
export function noteFresh(local: string | null, known: string | null, fresh: string): 'same' | 'take' | 'keep' {
  if (local === fresh) return 'same';
  if (known === null || local === known) return 'take';
  return 'keep';
}

/** 패널 폭 — 끌지 않으면 300, 왼쪽 경계를 끌어 260~640(11-05 사용자) */
/** 따로 창이 메타를 바꾸면(내리기·패널로) 메인 창 window 에 — 패널이 목록을 다시 읽는다 */
export const NOTES_CHANGED = 'notes-changed';
export const NOTE_PANEL_W = 300;
export const NOTE_W_MIN = 260;
export const NOTE_W_MAX = 640;
/** 스페이스 내용이 이보다 좁아지면 패널을 나란히 두지 않고 덮개로 띄운다(11-05 사용자) */
const CONTENT_MIN = 360;

/** avail = 패널을 나란히 뒀다 치고 스페이스 내용 + 패널이 쓰는 폭 — 패널 상태에 따라 안 변하는 값이라 나란히↔덮개가 왔다 갔다 하지 않는다 */
export const noteOverlay = (avail: number, w = NOTE_PANEL_W) => avail - w < CONTENT_MIN;

/** 기억한 폭(localStorage 글) — 없거나 망가졌으면 기본, 있으면 최소·최대 안으로 */
export function noteW(saved: string | null): number {
  const n = Number(saved);
  if (!saved || !Number.isFinite(n)) return NOTE_PANEL_W;
  return Math.min(NOTE_W_MAX, Math.max(NOTE_W_MIN, Math.round(n)));
}

/** 보내기 아이콘 — 입력칸에 넣을 메모 글(앞뒤 빈 줄 걷음). 비었으면 null */
export function notePaste(md: string): string | null {
  const t = md.replace(/^\s*\n/, '').trimEnd();
  return t.trim() ? t : null;
}

// 데스크톱 메모는 블록 편집기(문단마다 빈 줄로 md 저장)라 폰 글 칸엔 문단 = 한 줄로 보인다 — 같은 종류가 아니어도 목록 줄끼리는 한 줄(편집기가 그렇게 쓴다)
const LIST_LINE = /^\s*(?:[-*+]|\d{1,9}[.)])\s/;
/** 저장 md → 폰 글 칸(문단 사이 빈 줄 걷음, 끝 줄바꿈 하나 걷음) */
export const noteLines = (md: string) => md.replace(/\r\n/g, '\n').replace(/\n$/, '').replace(/\n\n/g, '\n');
/** 폰 글 칸 → 저장 md. 안 고쳤으면 원래 글 그대로(저장 글을 바꾸지 않는다), 고쳤으면 줄마다 문단 · 끝 줄바꿈·CRLF 는 원래대로 */
export function noteMd(view: string, base: string): string {
  if (noteLines(base) === view) return base;
  const ls = view.split('\n');
  let out = ls[0] ?? '';
  for (let i = 1; i < ls.length; i++) out += (LIST_LINE.test(ls[i - 1]!) && LIST_LINE.test(ls[i]!) ? '\n' : '\n\n') + ls[i];
  if (/\n$/.test(base)) out += '\n';
  return base.includes('\r\n') ? out.replace(/\n/g, '\r\n') : out;
}

/** 입력칸에 쓰던 글 뒤에 메모 글 — 쓰던 글이 있으면 줄을 바꿔서 */
export const withPlain = (draft: string, text: string) => (draft.trim() ? `${draft.trimEnd()}\n${text}` : text);

/** 열 메모 — 마지막에 본 것, 없어졌으면 맨 위(최근에 고친 것) */
export const pickNote = (rows: NoteRow[], last: string | null): NoteRow | null => rows.find((r) => r.name === last) ?? rows[0] ?? null;

export const noteTitle = (r: NoteRow, untitled: string) => r.title || untitled;

/** 머리줄 아이콘·⌘⇧M 을 눌렀을 때 — 터미널 뷰엔 스페이스가 없어 늘 창. 채팅 뷰는 창이 떠 있으면 그 창을 앞으로, 아니면 패널 여닫기 */
export function notesToggle(chatView: boolean, panel: boolean, win: boolean): 'window' | 'panel' | 'closed' {
  if (!chatView || win) return 'window';
  return panel ? 'closed' : 'panel';
}

/** 목록 오른쪽 날짜 — 오늘은 시각, 그 전은 월/일 */
export function noteWhen(at: number, now: number): string {
  if (!at) return '';
  const d = new Date(at);
  const n = new Date(now);
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
