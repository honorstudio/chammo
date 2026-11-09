// 폰 팀 여러 개(11-02, 시안 team-add v1 B2 — 머리 팀 줄 +) 연결과 팀 바꿀 때 섞임 막기 — DOM 없이 소스로 지킨다
import { describe, expect, it } from 'vitest';
import phone from './PhoneTeam.tsx?raw';
import phoneLocker from './PhoneTeamLocker.tsx?raw';
import phoneAdd from './PhoneTeamAdd.tsx?raw';
import web from '../../data/web.ts?raw';

describe('폰 — 머리 팀 줄 · 팀 추가는 팀 시트에(11-06)', () => {
  it('머리에 teamStack 줄, 누르면 팀 바꾸기(api.use) — 머리 + 는 자리를 차지해 뺐다', () => {
    expect(phone).toContain('teamStack(view)');
    expect(phone).toContain('api.use(');
    expect(phone).toContain('<PhoneTeamStrip stack={stack}');
    expect(phoneAdd).not.toContain('m-team-add');
    expect(phone).not.toContain('onAdd={() => setAdding(true)}');
  });
  it('팀 이름 꺾쇠 시트에 \'팀 추가\' 줄 → + 시트, 팀이 없어도 꺾쇠로 연다', () => {
    expect(phone).toMatch(/className="m-ts-act" onClick=\{onAdd\}>\{tr\('팀 추가', 'Add a team'\)\}/);
    expect(phone).toContain('onAdd={() => { setSheet(false); setAdding(true); }}');
    expect(phone).not.toContain("<b className=\"m-team-none\">");
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

describe('폰 팀 보관함 + = 폰 기본 첨부 창(11-06 사용자)', () => {
  it('+ 는 우리 모달 없이 바로 파일 고르기(여러 개) — iOS 가 사진 보관함·사진 찍기·파일 선택을 띄운다', () => {
    expect(phoneLocker).not.toContain('function AddSheet');
    expect(phoneLocker).toMatch(/<input ref=\{pick\} type="file" multiple hidden/);
    expect(phoneLocker).toMatch(/label=\{tr\('올리기', 'Upload'\)\} onClick=\{\(\) => pick\.current\?\.click\(\)\}><IconPlus \/>/);
  });
  it('새 폴더는 + 옆 아이콘', () => {
    expect(phoneLocker).toMatch(/label=\{tr\('새 폴더', 'New folder'\)\} onClick=\{\(\) => setAsk\(\{ kind: 'name', what: 'mkdir' \}\)\}><IconFolderPlus \/>/);
  });
});
