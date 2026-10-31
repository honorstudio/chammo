// 팀 홈 글판 계산(시안 team-space H) — Rust team_post::Board 를 고정 한 칸 + 목록 + 안 읽은 글로. 화면(ui/team/TeamHome)과 따로 시험한다
import { tr } from '../i18n';

export type Post = { id: string; file: string; title: string; body: string; by: string; created: number; edited: number; mine: boolean };
/** loading = 아직 받는 중인 글 수(받아 둔 글부터 먼저 그렸다 — 곧 다시 읽는다) */
export type PostBoard = { team: string; rev: number; posts: Post[]; pinned: string; owner: boolean; loading?: number };
/** 팀 홈 글 길 — 데스크톱(Tauri 명령)·폰(맥 폰 서버)이 같은 TeamHome 을 쓴다.
 *  board: seen = 본 판(null = 꼭 새로) — 그대로면 {same}. write: 글 id(pin = 폰은 올리며 고정, 데스크톱은 pin 으로 따로).
 *  edit·pin·remove 가 없으면 그 단추를 안 그린다(폰 — 고치기·고정 바꾸기·지우기는 데스크톱에서) */
export type PostApi = {
  board: (team: string, seen: number | null) => Promise<PostBoard | { same: true }>;
  write: (team: string, title: string, body: string, origin: string | undefined, pin: boolean) => Promise<string>;
  edit: boolean;
  pin?: (team: string, post: string) => Promise<void>;
  remove?: (team: string, post: string) => Promise<void>;
};

export function homeOf(b: PostBoard, seen: Set<string>): { pinned: Post | null; list: Post[]; unread: Set<string> } {
  const pinned = b.posts.find((x) => x.id === b.pinned) ?? null;
  return {
    pinned,
    list: b.posts.filter((x) => x !== pinned),
    unread: new Set(b.posts.filter((x) => !x.mine && !seen.has(x.id)).map((x) => x.id)),
  };
}

/** '대화로' — 팀챗 입력칸에 넣을 첫 줄 */
export const quoteOf = (p: Post) => `${tr('[팀 홈 글]', '[Team post]')} ${p.title} — `;

/** 폰 글쓰기 — 글은 올라갔고 고정만 안 됐다(Rust pinError 에 web 이 'pin: ' 머리를 붙인다). 그 까닭, 아니면 null */
export const pinFailed = (raw: string): string | null => /(?:^|Error: )pin: (.*)$/s.exec(raw)?.[1] ?? null;

/** 글 읽기·쓰기 실패 문구 — 중계가 아직 글(kind post)을 모르면(bad_kind, 마이그 0013 전) 곧 열린다고, 나머지는 무엇이 안 됐는지 앞에 */
export function postErr(what: 'read' | 'write', raw: string): string {
  if (raw.includes('bad_kind')) return tr('서버가 아직 글을 못 받아요 — 곧 열려요', "The server can't take posts yet — coming soon");
  const pin = pinFailed(raw);
  if (pin !== null) return tr(`글은 올렸는데 고정 공지로는 못 했어요 — ${pin}`, `Posted, but couldn't pin it — ${pin}`);
  return what === 'write' ? tr(`글을 못 올렸어요 — ${raw}`, `Couldn't post — ${raw}`) : tr(`글을 못 읽었어요 — ${raw}`, `Couldn't load posts — ${raw}`);
}
