// 폰 팀 여러 개(11-02, 시안 team-add v1 B2 — 머리 팀 줄 +) 연결과 팀 바꿀 때 섞임 막기 — DOM 없이 소스로 지킨다
import { describe, expect, it } from 'vitest';
import phone from './PhoneTeam.tsx?raw';
import phoneLocker from './PhoneTeamLocker.tsx?raw';
import phoneAdd from './PhoneTeamAdd.tsx?raw';
import web from '../../data/web.ts?raw';

describe('폰 — 머리 팀 줄 + (B2)', () => {
  it('머리에 teamStack 줄과 끝에 +, 누르면 팀 바꾸기(api.use)', () => {
    expect(phone).toContain('teamStack(view)');
    expect(phone).toContain('api.use(');
    expect(phone).toContain('<PhoneTeamStrip stack={stack}');
    expect(phoneAdd).toMatch(/className="m-team-add" aria-label=\{tr\('팀 추가', 'Add a team'\)\}/);
  });
  it('+ 시트 두 줄 → 만들기·들어가기 칸(내 이름 포함)', () => {
    expect(phone).toContain('<TeamAddSheet api={api}');
    expect(phoneAdd).toContain('api.create(name, me)');
    expect(phoneAdd).toContain('api.join(code, me)');
    expect(phoneAdd).toContain('sameTeamName(name, view?.teams)');
  });
  it('폰 API — team-use·team-join·만들기 me', () => {
    expect(web).toContain("use: (team) => post('/api/team-use', { team })");
    expect(web).toContain("join: (code, me) => post('/api/team-join', { code, me })");
    expect(web).toContain("create: (team, me) => post('/api/team-create', { team, me })");
  });
});

describe('팀 바꿀 때 섞이지 않게 — 늦게 온 앞 팀 응답', () => {
  it('폰 팀 보관함: 읽는 사이 팀이 바뀌었으면 앞 팀 목록·판 번호를 새 팀 화면에 안 앉힌다', () => {
    expect(phoneLocker).toContain('const cur = useRef(teamId);');
    expect(phoneLocker).toContain('cur.current = teamId;');
    expect(phoneLocker).toMatch(/if \(cur\.current !== teamId\) return;/);
    // 읽는 중 표시도 팀마다 — 앞 팀을 읽는 동안 새 팀 읽기가 4초 밀리지 않고, 앞 팀 끝이 새 팀 읽기를 풀지 않는다
    expect(phoneLocker).toContain("if (busy.current === teamId) {");
    expect(phoneLocker).toContain('if (busy.current !== teamId) return;');
  });
});

describe('팀 바꿀 때 섞이지 않게(폰) — 프로필판·팀 홈', () => {
  it('폰 프로필판도 지금 팀이 아니면 버린다', () => {
    expect(phone).toMatch(/if \(cur\.current !== teamId\) return;\s*const n = keepBoard/);
  });
  it('폰 팀 홈·보관함은 팀마다 새로 그린다(key)', () => {
    expect(phone).toContain('<TeamHome key={view.teamId}');
    expect(phone).toContain('<PhoneTeamLocker key={view.teamId}');
  });
});
