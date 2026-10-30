import { describe, expect, it } from 'vitest';
import {
  BLOCKS_MAX, addBlock, blankContent, canAdd, changedLine, dropAt, fromTemplate, goalFix, homeColor, homeSame, linkProblem, moveBlock, postPlaces, removeBlock, setWidth, teamColor, TEMPLATES, TEAM_COLORS,
  type Home, type HomeBlock,
} from './teamHome';

const b = (id: string, k: HomeBlock['k'], w: HomeBlock['w'] = 'half'): HomeBlock => ({ id, k, w });
const home = (blocks: HomeBlock[]): Home => ({ t: 'home', color: 0, blurb: '', cover: '', blocks, at: 0 });

describe('팀 홈 템플릿 셋(ADR 0018 9)', () => {
  it('기본·프로젝트팀·운영팀 — 시안 T 구성에 셋 다 글 목록(운영팀은 빠져 있어서 올린 글이 안 보였다, 공개 이슈 #9)', () => {
    const ks = (key: string) => fromTemplate(key as never, () => 'x').blocks.map((x) => x.k);
    expect(TEMPLATES.map((t) => t.key)).toEqual(['basic', 'project', 'ops']);
    // 팀 캘린더 블록(relay ADR 0011 · 10-30 다시 맞춤) — 기본·프로젝트팀에 기본으로
    expect(ks('basic')).toEqual(['pin', 'cal', 'members', 'files', 'posts']);
    expect(ks('project')).toEqual(['cal', 'goals', 'files', 'agents', 'links', 'posts']);
    expect(ks('ops')).toEqual(['pin', 'mode', 'members', 'agents', 'links', 'posts']);
    for (const t of TEMPLATES) expect(t.ks).toContain('posts');
  });
  it('블록 id 는 판 안에서 겹치지 않는다', () => {
    let n = 0;
    const h = fromTemplate('ops', () => `b${n++}`);
    expect(new Set(h.blocks.map((x) => x.id)).size).toBe(h.blocks.length);
    expect(h.blocks.find((x) => x.k === 'mode')).toMatchObject({ w: 'full', mode: '' });
  });
});

describe('글이 보일 자리 — 칸 구성과 상관없이 올린 글은 어딘가에 보인다(공개 이슈 #9)', () => {
  it('판이 없으면 글 목록 판 그대로(따로 그릴 것 없음)', () => {
    expect(postPlaces(null)).toEqual({ pinInList: false, listBelow: false });
  });
  it('글 목록·고정 공지 칸이 다 있으면 따로 그릴 것 없음', () => {
    expect(postPlaces(home([b('a', 'pin', 'full'), b('d', 'posts', 'full')]))).toEqual({ pinInList: false, listBelow: false });
  });
  it('글 목록 칸이 없으면 판 아래에 글 — 팀원이 올린 글이 어디에도 안 보였다', () => {
    expect(postPlaces(home([b('a', 'pin', 'full'), b('m', 'mode', 'full'), b('b', 'members'), b('f', 'files'), b('l', 'links')]))).toEqual({ pinInList: false, listBelow: true });
  });
  it('고정 공지 칸이 없으면 고정한 글도 글 목록 맨 앞에 — 프로젝트팀 판은 고정해도 안 보였다', () => {
    expect(postPlaces(fromTemplate('project'))).toEqual({ pinInList: true, listBelow: false });
    expect(postPlaces(home([b('b', 'members')]))).toEqual({ pinInList: true, listBelow: true });
    expect(postPlaces(home([]))).toEqual({ pinInList: true, listBelow: true });
  });
});

describe('꾸미기 동작', () => {
  const h = home([b('a', 'pin', 'full'), b('b', 'members'), b('c', 'files'), b('d', 'posts', 'full')]);
  it('옮기기 — 끌어 놓은 자리로(뒤로 가면 빠진 자리만큼 당겨진다)', () => {
    expect(moveBlock(h.blocks, 'a', 3).map((x) => x.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveBlock(h.blocks, 'd', 0).map((x) => x.id)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveBlock(h.blocks, 'b', 1).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']); // 제자리
    expect(moveBlock(h.blocks, 'zz', 0)).toBe(h.blocks);
  });
  it('폭 바꾸기·빼기', () => {
    expect(setWidth(h.blocks, 'b', 'full').find((x) => x.id === 'b')?.w).toBe('full');
    expect(removeBlock(h.blocks, 'c').map((x) => x.id)).toEqual(['a', 'b', 'd']);
  });
  it('더하기는 맨 아래, 폭은 블록 기본 — 한 판에 하나뿐인 블록은 또 못 더한다', () => {
    const more = addBlock(h.blocks, 'links', 'n1');
    expect(more.at(-1)).toEqual({ id: 'n1', k: 'links', w: 'half' });
    expect(addBlock(h.blocks, 'mode', 'n2').at(-1)).toEqual({ id: 'n2', k: 'mode', w: 'full', mode: '' });
    expect(canAdd(h.blocks, 'pin')).toBe(false);
    expect(canAdd(h.blocks, 'agents')).toBe(true);
    expect(canAdd(h.blocks, 'links')).toBe(true);
    const full = Array.from({ length: BLOCKS_MAX }, (_, i) => b(`x${i}`, 'links'));
    expect(canAdd(full, 'note')).toBe(false);
  });
  it('완료 전후 같은 판인가 — 시각은 안 본다', () => {
    expect(homeSame(h, { ...h, at: 99 })).toBe(true);
    expect(homeSame(h, { ...h, blurb: '새 소개' })).toBe(false);
    expect(homeSame(h, { ...h, blocks: setWidth(h.blocks, 'b', 'full') })).toBe(false);
  });
});

describe('끌어 놓을 자리 — 2열 격자에서 읽는 순서(위→아래, 왼→오)', () => {
  // [a 전체] / [b 반][c 반] / [d 전체]
  const rects = [
    { x: 0, y: 0, w: 600, h: 100 },
    { x: 0, y: 120, w: 290, h: 100 },
    { x: 310, y: 120, w: 290, h: 100 },
    { x: 0, y: 240, w: 600, h: 100 },
  ];
  it('블록 가운데보다 앞이면 그 앞, 뒤면 다음 자리', () => {
    expect(dropAt(rects, 300, 10)).toBe(0);
    expect(dropAt(rects, 300, 90)).toBe(1);
    expect(dropAt(rects, 100, 170)).toBe(1); // b 왼쪽 위
    expect(dropAt(rects, 200, 170)).toBe(2); // b 가운데 지나 — c 앞
    expect(dropAt(rects, 500, 170)).toBe(3); // c 가운데 지나
    expect(dropAt(rects, 300, 400)).toBe(4); // 맨 아래 밖
    expect(dropAt([], 0, 0)).toBe(0);
  });
});

describe('블록 내용 검사', () => {
  it('링크는 http·https 만 — 누르는 사람 기기에서 열린다', () => {
    expect(linkProblem({ name: '견적표', url: 'https://docs.example/a' })).toBe('');
    expect(linkProblem({ name: '견적표', url: 'javascript:alert(1)' })).not.toBe('');
    expect(linkProblem({ name: '', url: 'https://a.example' })).not.toBe('');
    expect(linkProblem({ name: 'a', url: 'https://a b' })).not.toBe('');
  });
  it('진행 막대 — 끝낸 칸은 전체를 못 넘고 전체는 1~99', () => {
    expect(goalFix({ name: '봄', done: 12, total: 9 })).toEqual({ name: '봄', done: 9, total: 9 });
    expect(goalFix({ name: '봄', done: -1, total: 0 })).toEqual({ name: '봄', done: 0, total: 1 });
    expect(goalFix({ name: '봄', done: 1, total: 500 }).total).toBe(99);
  });
  it('빈 내용', () => {
    expect(blankContent()).toEqual({ links: [], note: { title: '', body: '' }, goals: [], by: '', at: 0 });
  });
});

describe('머리', () => {
  it('팀 색은 정한 팔레트 안에서, 모르는 번호는 첫 색', () => {
    expect(TEAM_COLORS.length).toBe(8);
    expect(teamColor(3)).toBe(TEAM_COLORS[3]);
    expect(teamColor(42)).toBe(TEAM_COLORS[0]);
  });
  it('누가 언제 바꿨나 한 줄', () => {
    expect(changedLine('하린', new Date(2026, 9, 28, 10, 15).getTime(), new Date(2026, 9, 28, 12, 0).getTime())).toBe('하린이 10:15 에 바꿈');
    expect(changedLine('서아', new Date(2026, 9, 27, 9, 5).getTime(), new Date(2026, 9, 28, 12, 0).getTime())).toBe('서아가 어제 바꿈');
    expect(changedLine('', 0, 0)).toBe('');
  });
});

import { recentFiles } from './teamHome';
describe('최근 파일 블록', () => {
  const f = (id: string, at: number, o: Partial<{ kind: string; room: string; state: 'live' | 'trash'; dir: boolean; why: string }> = {}) =>
    ({ id, name: `${id}.pdf`, size: 1, cipher: 1, at, state: 'live' as const, kind: 'file', room: '', folder: '', by: '', byMember: 'm1', mine: false, why: '', deletedAt: null, ...o });
  it('사람이 올린 팀 파일만 새것 먼저 — 대화 파일·앱 안쪽 줄(post·avatar)·휴지통·폴더 줄·못 여는 파일은 뺀다', () => {
    const items = [f('a', 1), f('b', 5), f('c', 3, { room: 'r1' }), f('d', 9, { kind: 'post' }), f('e', 8, { state: 'trash' }), f('g', 7, { dir: true }), f('h', 6, { why: '열쇠 없음' }), f('i', 4)];
    expect(recentFiles(items, 2).map((x) => x.id)).toEqual(['b', 'i']);
    expect(recentFiles(items, 9).map((x) => x.id)).toEqual(['b', 'i', 'a']);
  });
});

import { lightModes, modeBlockState, modeOkKey } from './teamHome';
describe('모드 칸(ADR 0018 7) — 보는 기기에서 각자, 가벼운 모드만, 켜기 한 번', () => {
  const row = (o: Partial<{ light: boolean; on: boolean; hidden: boolean; name: string }> = {}) => ({ name: 'board', light: true, on: true, ...o });
  it('상태 차례 — 빈 칸 → 없는 모드 → 무거운 모드 → 켜기 묻기 → 켜는 중 → 그림', () => {
    expect(modeBlockState('', row(), true)).toBe('empty');
    expect(modeBlockState('board', undefined, true)).toBe('missing');
    expect(modeBlockState('board', row({ light: false }), true)).toBe('heavy');
    expect(modeBlockState('board', row(), false)).toBe('ask');
    expect(modeBlockState('board', row({ on: false }), true)).toBe('start');
    expect(modeBlockState('board', row(), true)).toBe('show');
  });
  it('켜기 기억은 팀·블록·모드마다 — 꽂은 모드를 바꾸면 다시 묻는다', () => {
    expect(modeOkKey('t1', 'b1', 'board')).not.toBe(modeOkKey('t1', 'b1', 'cal'));
    expect(modeOkKey('t1', 'b1', 'board')).not.toBe(modeOkKey('t2', 'b1', 'board'));
  });
  it('고를 수 있는 모드 = 이 기기의 가벼운 모드(숨긴 것 빼고)', () => {
    expect(lightModes([row({ name: 'a' }), row({ name: 'b', light: false }), row({ name: 'c', hidden: true })]).map((r) => r.name)).toEqual(['a']);
  });
});

import { coverCrop } from './teamHome';
describe('커버 사진 자르기 — 가운데 3:1', () => {
  it('넓은 사진은 양옆, 높은 사진은 위아래를 자른다', () => {
    expect(coverCrop(3000, 600)).toEqual({ sx: 600, sy: 0, sw: 1800, sh: 600 });
    expect(coverCrop(1200, 1200)).toEqual({ sx: 0, sy: 400, sw: 1200, sh: 400 });
  });
});

describe('팀 색 — 팀 홈 판에서 팀장이 고른 색(띠 팀 칸 고른 테두리가 따라간다, 10-29 사용자)', () => {
  const board = (home: { color: number } | null) => ({ team: 't1', rev: 1, home: home && { t: 'home' as const, color: home.color, blurb: '', cover: '', blocks: [], at: 1 }, by: '', content: {}, cover: '', owner: true, me: '' });
  it('판이 있으면 그 색', () => {
    expect(homeColor(board({ color: 6 }))).toBe(TEAM_COLORS[6]);
    expect(homeColor(board({ color: 0 }))).toBe(TEAM_COLORS[0]);
  });
  it('판이 없거나 아직 못 읽었으면 없음 — 띠는 지금 색(이름 색)을 쓴다', () => {
    expect(homeColor(board(null))).toBeUndefined();
    expect(homeColor(null)).toBeUndefined();
    expect(homeColor(undefined)).toBeUndefined();
  });
  it('모르는 번호는 첫 색(팀 홈 머리와 같은 규칙)', () => expect(homeColor(board({ color: 42 }))).toBe(TEAM_COLORS[0]));
});
