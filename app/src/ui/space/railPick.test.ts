// 띠 고른 표시 한 규칙(2026-10-29 사용자 398·399·400) — 참모를 누르면 생기던 흰 면(이음 면 lk-join)을 걷고, 참모·팀 모두 그림 둘레 색 테두리 하나.
// 팀 칸 테두리는 팀 홈에서 고른 팀 색(없으면 이름 색), 참모는 그 참모 색. DOM 없이 소스로 지킨다(앱 테스트엔 jsdom 이 없다)
import { describe, expect, it } from 'vitest';
import orchRail from './OrchRail.tsx?raw';
import css from './locker.css?raw';
import teamRail from '../team/TeamRail.tsx?raw';
import teamCss from '../team/team.css?raw';
import mode from '../team/useTeamMode.tsx?raw';
import home from '../team/TeamHome.tsx?raw';
import tint from '../team/useTeamColor.ts?raw';
import homeApi from '../../data/teamHomeApi.ts?raw';

describe('띠 고른 표시 = 그림 둘레 색 테두리 하나', () => {
  it('흰 면(이음 면 lk-join)을 안 그린다', () => {
    expect(orchRail).not.toMatch(/lk-join/);
    expect(orchRail).not.toMatch(/setJoin/);
    expect(css).not.toMatch(/\.lk-join/);
  });
  it('고른 칸 = 그림 칸 둘레 2px 틈(투명) + 2px 색 — 칸 색(--rail-on)이 있으면 그 색, 없으면 참모 색', () => {
    expect(css).toMatch(/\.lk-strip \.lk-av\.on \.lk-av-pic \{[^}]*outline: 2px solid var\(--rail-on, var\(--orch-solid, var\(--accent\)\)\); outline-offset: 2px;/);
  });
  it('홈·팀 그림 칸도 참모 칸(32)과 같은 크기 — 테두리 크기가 같다', () => {
    expect(css).toMatch(/\.lk-strip \.lk-av\.rail-home \.lk-av-pic \{ width: 32px; height: 32px; \}/);
    expect(teamCss).toMatch(/\.lk-strip \.tmx-rail-team \.lk-av-pic \{[^}]*width: 32px; height: 32px;/);
  });
  it('고른 칸에 면(바탕)·칸 네모 테두리를 따로 안 깐다 — 펼친 띠·이어진 띠에서도', () => {
    for (const m of css.matchAll(/([^{}]*\.lk-av\.on[^{}]*)\{([^}]*)\}/g)) {
      const [, sel = '', body = ''] = m;
      if (sel.includes('.lk-av-pic') || sel.includes('st-speak')) continue;
      expect(body, sel).not.toMatch(/background|box-shadow/);
    }
  });
  it('왼쪽 색 띠 없음', () => expect(css).not.toMatch(/\.lk-av\.on[^{]*\{[^}]*border-left/));
});

describe('팀 칸 테두리 = 팀 홈 팀 색', () => {
  it('팀 칸은 고른 표시 색(--rail-on)만 주고, 팀 표 자체 고리(TeamMarkIcon on)는 안 겹친다', () => {
    expect(teamRail).toMatch(/style=\{\{ '--rail-on': color \?\? teamMark\(team\)\.color \} as React\.CSSProperties\}/);
    expect(teamRail).not.toMatch(/<TeamMarkIcon[^>]*\bon=/);
  });
  it('팀 모드가 팀 홈 판 색을 띠에 넘긴다 — 프로필판과 같은 판 번호가 오르면 다시 읽는다', () => {
    expect(mode).toContain('const tint = useTeamColor(teamId, profiles.board?.rev ?? 0);');
    expect(mode).toMatch(/<TeamRail [^>]*color=\{tint\}/);
  });
  it('팀 홈과 띠가 같은 기억(homeMemo)을 쓴다 — 이 창에서 저장하면 띠가 바로 따라간다', () => {
    expect(homeApi).toContain('export const homeMemo = teamViewMemo<HomeBoard>();');
    expect(home).not.toMatch(/const homeMemo = /);
    expect(home).toContain('homeMemo.put(teamId, n);');
    expect(tint).toMatch(/homeMemo\.on\(/);
    expect(tint).toMatch(/if \(m && m\.v\.rev >= rev\) return;/); // 기억이 그 판 이상이면 망을 안 부른다
    expect(tint).toContain('homeColor(');
  });
});
