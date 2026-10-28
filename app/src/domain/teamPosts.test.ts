import { describe, expect, it } from 'vitest';
import { homeOf, quoteOf, type PostBoard } from './teamPosts';

const p = (id: string, mine = false, created = 1) => ({ id, file: id, title: `글 ${id}`, body: `${id} 본문\n둘째 줄`, by: mine ? 'me' : 'm2', created, edited: 0, mine });
const board = (pinned = ''): PostBoard => ({ team: 't', rev: 1, owner: false, pinned, posts: [p('c', false, 3), p('b', true, 2), p('a', false, 1)] });

describe('팀 홈 글판(시안 team-space H)', () => {
  it('고정 글은 맨 위 한 칸으로 빼고 목록엔 안 겹친다', () => {
    const h = homeOf(board('b'), new Set());
    expect(h.pinned?.id).toBe('b');
    expect(h.list.map((x) => x.id)).toEqual(['c', 'a']);
  });
  it('고정이 없으면 목록 그대로(새 글이 위)', () => {
    const h = homeOf(board(), new Set());
    expect(h.pinned).toBeNull();
    expect(h.list.map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });
  it('안 읽은 글 = 이 기기가 아직 안 본 남의 글(내 글은 늘 읽음)', () => {
    const h = homeOf(board('b'), new Set(['a']));
    expect([...h.unread].sort()).toEqual(['c']);
  });
  it("'대화로' 첫 줄 — 글 제목을 인용", () => {
    expect(quoteOf(p('a'))).toBe('[팀 홈 글] 글 a — ');
  });
});

import { pinFailed, postErr } from './teamPosts';
describe('팀 홈 글 오류 문구', () => {
  it('중계가 아직 kind post 를 모르면(bad_kind) 사람 말로 — 곧 열린다', () => {
    expect(postErr('write', 'relay 400: {"error":"bad_kind"}')).toBe('서버가 아직 글을 못 받아요 — 곧 열려요');
    expect(postErr('read', 'bad_kind')).toBe('서버가 아직 글을 못 받아요 — 곧 열려요');
  });
  it('쓰기 실패는 "못 올렸어요", 읽기 실패는 "못 읽었어요" — 무엇이 안 됐는지 앞에', () => {
    expect(postErr('write', '끊김')).toBe('글을 못 올렸어요 — 끊김');
    expect(postErr('read', '끊김')).toBe('글을 못 읽었어요 — 끊김');
  });
});

describe('폰 글쓰기 — 고정만 실패', () => {
  it('글은 올라갔는데 고정을 못 했으면(pin: 머리) 못 올렸다고 하지 않는다', () => {
    expect(postErr('write', 'Error: pin: 고정 공지는 팀장만')).toBe('글은 올렸는데 고정 공지로는 못 했어요 — 고정 공지는 팀장만');
    expect(postErr('write', 'pin: x')).toBe('글은 올렸는데 고정 공지로는 못 했어요 — x');
  });
});
describe('pinFailed', () => {
  it("'pin: ' 머리만 — 다른 실패는 null(창을 그대로 둬 다시 보낼 수 있게)", () => {
    expect(pinFailed('Error: pin: 팀장만')).toBe('팀장만');
    expect(pinFailed('relay 502: spin: x')).toBeNull();
    expect(pinFailed('글을 못 올렸어')).toBeNull();
  });
});
