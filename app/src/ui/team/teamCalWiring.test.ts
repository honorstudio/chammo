// 팀 캘린더(chammo-relay ADR 0011) 배선 — 스페이스 고정 탭·홈 블록·첫 그림은 캐시·1초 poll·쓰기는 사람 명령·Rust 명령 등록
import { describe, expect, it } from 'vitest';
import space from './TeamSpace.tsx?raw';
import teamMode from './useTeamMode.tsx?raw';
import home from './TeamHome.tsx?raw';
import hook from './useTeamCal.ts?raw';
import cal from './TeamCal.tsx?raw';
import block from './CalBlock.tsx?raw';
import css from './teamCal.css?raw';
import api from '../../data/teamCalApi.ts?raw';
import main from '../../../src-tauri/src/main.rs?raw';
import cmd from '../../../src-tauri/src/team_app_cmd.rs?raw';
import ws from '../../../src-tauri/src/team_relay_ws.rs?raw';
import phone from '../mobile/PhoneTeam.tsx?raw';
import web from '../../data/web.ts?raw';

describe('팀 캘린더 배선', () => {
  it('팀 스페이스 탭 줄 — 홈·보관함 옆 고정 캘린더 탭(닫기 없음), 탭이 고르면 캘린더 화면', () => {
    expect(space).toContain("onClick={() => onPick('cal')} aria-label={tr('팀 캘린더', 'Team calendar')}");
    expect(space).toContain("cur === 'cal' && cal ?");
    expect(teamMode).toContain('cal={<TeamCal key={view.teamId} teamId={view.teamId} members={view.members} />}');
  });
  it('팀 홈 블록 — 반 폭 다가오는 일정, 전체 폭 이번 주(사용자 10-30 ①), 머리 아이콘이 캘린더 탭으로', () => {
    expect(teamMode).toContain("calBlock={(b, editing) => <CalBlock key={view.teamId} teamId={view.teamId} wide={b.w === 'full'} editing={editing} onOpen={() => setTabs((t) => pickTeamTab(t, 'cal'))} />}");
    expect(home).toContain("if (x.k === 'cal') return calBlock ? calBlock(x, editing)");
    expect(block).toContain('upcoming(snap.items, today, 14, 7)');
    expect(block).toContain('weekDays(today)');
  });
  it('첫 그림은 창 기억·기기 캐시(망 안 씀) 다음 따라잡기, 남의 고침은 1초 poll 번호로 — 다시 받기 없음', () => {
    expect(hook).toContain('const memo = new Map<string, CalSnap>();');
    expect(hook).toContain('const c = await api.cached(team)');
    expect(hook).toContain('}, 1000);');
    expect(hook).toContain('if (p.stale) void sync();');
  });
  it('따라잡기는 팀마다 하나·실패하면 물러서기 — 데스크톱·폰(같은 훅, /api/team-cal?fresh=1) 둘 다(0.4.5 리뷰 3)', () => {
    expect(hook).toContain('const gate = syncGate<CalSnap>();');
    expect(hook).toContain('gate(team, () => api.sync(team))');
    expect(hook).not.toMatch(/api\.sync\(team\)\.then/);
    expect(phone).toContain('<TeamCal ');
  });
  it('팀을 바꾸면 앞 팀 기록장·열린 창을 안 쓴다 — 화면은 key 로 새로, 쓰기는 calPutOk 로 거절(0.4.5 리뷰 4)', () => {
    expect(teamMode).toContain('cal={<TeamCal key={view.teamId} teamId={view.teamId}');
    expect(teamMode).toContain('<CalBlock key={view.teamId} teamId={view.teamId}');
    expect(phone).toContain('<TeamCal key={view.teamId} teamId={view.teamId}');
    expect(hook).toContain('const snap = st && (!team || st.team === team) ? st : memo.get(team) ?? null;');
    expect(hook).toContain('if (!calPutOk(before, team, it))');
  });
  it('쓰기는 누른 즉시 옅게(pending), 실패면 되돌림 · 같은 칸 덮음·남이 지움은 한 줄', () => {
    expect(hook).toContain('pending: true');
    expect(hook).toContain('if (before) setSnap(before);');
    expect(cal).toContain('lostLine(r.lost, nameOf(r.by))');
    expect(cal).toContain("tr('다시 살리기', 'Restore')");
  });
  it('Rust 명령 넷 등록 · 쓰기는 사람 명령(human_job) · 소켓 {t:"app"} 은 기록장으로', () => {
    for (const c of ['team_cal_cached', 'team_cal,', 'team_cal_poll', 'team_cal_put']) expect(main).toContain(`team_app_cmd::${c}`);
    expect(cmd).toContain('human_job(move |d, kc, h| store::write(');
    expect(ws).toContain('"app" => crate::team_app_store::push(&self.dir, v),');
    expect(api).toContain("invoke<CalWrite>('team_cal_put'");
  });
  it('폰 — 팀 탭 캘린더 칸(시트 겹창·주 띠 + 목록), 길은 맥 폰 서버(/api/team-cal·poll·put)', () => {
    expect(phone).toContain("seg === 'cal' ? <div className=\"m-team-cal\"><TeamCal key={view.teamId} teamId={view.teamId} members={view.members} api={api.cal} Dialog={HomeSheet} phone /></div>");
    expect(web).toContain('/api/team-cal?team=${encodeURIComponent(team)}&fresh=1');
    expect(web).toContain("post('/api/team-cal-put', { team, id, base, before, data, restore: !!restore })");
  });
  it('왼쪽 색 띠 없음 — 색은 옅은 면 + 점', () => {
    expect(css).toContain('.l-blue');
    // 칸 나눔 1px 선은 괜찮다 — 굵은 강조 띠(2px 이상)·안쪽 그림자 띠만 막는다
    expect(css).not.toMatch(/border-left:\s*[2-9]px/);
    expect(css).not.toMatch(/inset\s+[2-9]px\s+0/);
  });
});
