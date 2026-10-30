// 글 목록 칸 없는 판에서도 올린 글이 보인다(공개 이슈 #9) — 앱 테스트엔 DOM 이 없어서 renderToStaticMarkup 으로 판 한 장을 그려 본다
import { describe, expect, it } from 'vitest';
import { createElement as h, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fromTemplate, type HomeApi, type HomeBoard as Board } from '../../domain/teamHome';
import { HomeBoard } from './HomeBoard';

const api: HomeApi = { board: async () => ({ same: true }), save: async () => ({}), content: async () => ({}) };
const board = (owner: boolean, ks: Parameters<typeof fromTemplate>[0] = 'ops'): Board => {
  let n = 0;
  const home = fromTemplate(ks, () => `b${n++}`);
  // 운영팀 판이 글 목록 칸 없이 저장돼 있던 팀(이슈 재현 — 지금 프리셋엔 글 목록이 있다)
  return { team: 't1', rev: 3, home: { ...home, blocks: home.blocks.filter((b) => b.k !== 'posts'), at: 1 }, by: 'm1', content: {}, cover: '', owner, me: 'm2' };
};
const draw = (b: Board, below: ReactNode) => renderToStaticMarkup(h(HomeBoard, {
  teamId: 't1', team: '시험 팀', people: 3, board: b, api, nameOf: () => '사람', onWrite: () => {}, onSaved: () => {},
  Dialog: ({ children }) => h('div', null, children), renderBlock: (x) => h('span', null, x.k), fallback: h('p', null, '판 없음'), below,
}));

describe('판 아래 글 타일', () => {
  it('팀원 화면 — 판에 글 칸이 없어도 올린 글이 판 끝 글 타일에 보인다', () => {
    const html = draw(board(false), h('b', null, '시험 글 하나'));
    expect(html).toContain('<div class="hb-b posts full"><b>시험 글 하나</b></div>');
    expect(html.indexOf('시험 글 하나')).toBeGreaterThan(html.indexOf('>links<'));
    expect(html).not.toContain('판 없음');
  });
  it('보일 글이 없으면 빈 타일을 안 그린다', () => {
    expect(draw(board(true), null)).not.toContain('hb-b posts');
  });
});
