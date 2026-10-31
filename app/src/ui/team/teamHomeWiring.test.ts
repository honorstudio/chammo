// 팀 홈 판(ADR 0018) 배선 — 꾸미기는 팀장만·완료 때 한 판, 폰은 같은 판을 맥으로, 모드 칸은 데스크톱만, 링크는 웹 주소만 밖으로
import { describe, expect, it } from 'vitest';
import board from './HomeBoard.tsx?raw';
import blocks from './HomeBlocks.tsx?raw';
import modeBlock from './HomeModeBlock.tsx?raw';
import home from './TeamHome.tsx?raw';
import teamMode from './useTeamMode.tsx?raw';
import phone from '../mobile/PhoneTeam.tsx?raw';
import web from '../../data/web.ts?raw';
import api from '../../data/teamHomeApi.ts?raw';
import teamCss from './team.css?raw';

describe('팀 홈 판 배선', () => {
  it('꾸미기 아이콘은 팀장에게만, 판이 없으면 팀장만 템플릿 셋(팀원은 글 목록 그대로)', () => {
    expect(board).toContain('board?.owner && saved && <IconButton label={tr(\'홈 꾸미기\'');
    expect(board).toContain('{!home && board?.owner && <Start onBegin={begin} />}');
    expect(board).toContain('{!home && fallback}');
  });
  it('글 칸이 없는 판도 올린 글을 보인다 — 판 아래 글 타일, 고정 칸이 없으면 고정 글도 목록에(공개 이슈 #9)', () => {
    expect(home).toContain('const places = postPlaces(hb?.home ?? null);');
    expect(home).toContain('places.pinInList && h.pinned ? [h.pinned, ...h.list] : h.list');
    expect(home).toContain('below={places.listBelow && list ?');
    expect(board).toContain("{below && <div className=\"hb-b posts full\">{below}</div>}");
  });
  it('완료 때만 올린다 — 바뀐 게 없으면 안 올리고, 올린 뒤 판을 다시 읽는다', () => {
    expect(board).toContain('if (!dirty) return leave();');
    expect(board).toContain('api.save(teamId, draft).then(() => { leave(); onSaved(); }');
    expect(home).toContain('onSaved={() => loadHome(null)}');
  });
  it('끌기는 손잡이에서만(포인터 + 화살표 키), 꾸미는 동안 블록 안은 안 눌린다', () => {
    expect(board).toContain('onPointerDown={(e) => down(e, b.id)}');
    expect(board).toContain('onKeyDown={(e) => key(e, b.id, i)}');
    // 노션식(10-31 사용자 '노션식 ㄱ') — 끄는 동안 판은 그대로(블록을 옮겨 그리지 않음), 잡은 블록 흐리게, 놓일 자리는 굵은 줄, 놓는 순간 옮긴다
    expect(board).toContain('...dropLine(d.rects, d.from, gx, gy, d.gap)');
    expect(board).toContain("${live?.id === b.id ? 'ghost' : ''}");
    expect(board).not.toContain('translate(');
    expect(board).toContain('if (d.live && d.line) blocks((bs) => moveBlock(bs, d.id, d.to));');
  });
  it('판 칸은 스크롤된다 — 같은 칸에 붙은 lk-doc-body(overflow hidden)가 앱 CSS 순서로 뒤에 와도, 끌기 중 가장자리면 저절로', () => {
    // 하네스는 locker.css 를 먼저 불러 스크롤됐고 앱 묶음은 lk-doc-body 가 뒤라 숨김이 이겼다(10-30 사용자 '꾸미는 중 넘치면 스크롤 안 됨')
    expect(teamCss).toContain('.lk-doc-body.tmh { overflow-y: auto; }');
    expect(teamCss).toContain('.tmh > .hb { flex-shrink: 0; }');
    expect(board).toContain('edgeScroll(');
  });
  it('데스크톱은 TeamHomeDesktop(모드 칸) — 폰은 판 길을 맥 폰 서버로, 모드 칸 없이', () => {
    expect(teamMode).toContain('home={<TeamHomeDesktop ');
    expect(phone).toContain('homeApi={homeApi} sources={homeSources} phone\n');
    // 폰 캘린더 칸은 반 폭 목록 하나(폰은 한 줄 쌓기), 머리 아이콘 = 캘린더 칸으로
    expect(phone).toContain("calBlock={(_b, editing) => <CalBlock teamId={view.teamId} wide={false} editing={editing} api={api.cal} onOpen={() => setSeg('cal')} />}");
    expect(phone).not.toContain('HomeModeBlock');
    expect(web).toContain("home: (team, rev) => getJson(`/api/team-home?team=${encodeURIComponent(team)}&rev=${rev}`)");
    expect(web).toContain("homeSave: (team, home) => post('/api/team-home-save', { team, home })");
    expect(api).toContain("invoke('team_home_save', { team, home })");
  });
  it('링크는 웹뷰가 따라가지 않고 열기 길로(데스크톱 = 기본 브라우저)', () => {
    expect(blocks).toContain('onClick={(e) => { e.preventDefault(); d.openUrl(l.url); }}');
    expect(api).toContain("openUrl: (url) => void openTarget('url', url)");
  });
  it('모드 칸 — 가벼운 모드만, 켜기는 사람이 누른 뒤, 대시보드 자리 team:<팀 id> 로', () => {
    expect(modeBlock).toContain("st === 'heavy'");
    expect(modeBlock).toContain("if (st !== 'start' || asked.current === mode) return;");
    expect(modeBlock).toContain("place: 'dash', dash: `team:${teamId}`");
  });
});

describe('팀 홈 글 먼저 그리기(10-31)', () => {
  it('받는 중인 글(loading)이 있으면 다음 3초 폴링은 판 번호와 상관없이 새로 읽는다', () => {
    expect(home).toMatch(/partial\.current = !!n\.loading/);
    expect(home).toMatch(/load\(partial\.current \? null : rev\.current\)/);
  });
});
