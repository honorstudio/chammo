// 팀 홈 글판 계산(시안 team-space H) — Rust team_post::Board 를 고정 한 칸 + 목록 + 안 읽은 글로. 화면(ui/team/TeamHome)과 따로 시험한다
import { tr } from '../i18n';

export type Post = { id: string; file: string; title: string; body: string; by: string; created: number; edited: number; mine: boolean };
export type PostBoard = { team: string; rev: number; posts: Post[]; pinned: string; owner: boolean };

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

/** 글 읽기·쓰기 실패 문구 — 중계가 아직 글(kind post)을 모르면(bad_kind, 마이그 0013 전) 곧 열린다고, 나머지는 무엇이 안 됐는지 앞에 */
export function postErr(what: 'read' | 'write', raw: string): string {
  if (raw.includes('bad_kind')) return tr('서버가 아직 글을 못 받아요 — 곧 열려요', "The server can't take posts yet — coming soon");
  return what === 'write' ? tr(`글을 못 올렸어요 — ${raw}`, `Couldn't post — ${raw}`) : tr(`글을 못 읽었어요 — ${raw}`, `Couldn't load posts — ${raw}`);
}
