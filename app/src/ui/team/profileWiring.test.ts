// 팀 설정·내 프로필 연결(시안 team-settings v1) — DOM 없이 소스로 지키는 규칙(앱 테스트엔 jsdom 이 없다)
import { describe, expect, it } from 'vitest';
import locker from './TeamLocker.tsx?raw';
import settings from './TeamSettings.tsx?raw';
import profile from './MyProfile.tsx?raw';
import rail from './TeamRail.tsx?raw';
import mode from './useTeamMode.tsx?raw';
import messenger from './MessengerApp.tsx?raw';
import convo from './TeamConvo.tsx?raw';
import list from './TeamList.tsx?raw';
import space from './TeamSpace.tsx?raw';

describe('팀 설정·내 프로필 연결', () => {
  it('팀 설정은 팀 스페이스 탭 줄 끝 톱니 하나 — 보관함 머리 끝 자리는 비우고, 고리 단추(284.png)·따라가기 스위치는 없다(시안 team-space A)', () => {
    expect(locker).toContain('room ? null : tail ?? '); // 보관함 머리 끝 자리(team-locker 가 연 칸)
    expect(mode).toContain('tail={<></>}');
    expect(space).toContain("label={tr('팀 설정', 'Team settings')}");
    expect(mode).not.toContain('follow={{');
  });
  it('초대 링크는 사람 칸 머리 이름표 단추, 팀 아이콘 바꾸기는 팀장만', () => {
    expect(settings).toContain("{owner && <button className=\"tmx-btn tmx-sm\" aria-expanded={showInvite}");
    expect(settings).toContain('disabled={!owner || busy} onClick={pickIcon.open}');
  });
  it('프로필 저장은 data/teamProfileApi 로만 — 화면이 invoke 를 직접 부르지 않는다', () => {
    expect(profile).not.toMatch(/invoke\(/);
    expect(profile).toContain('teamProfileSet(c)');
  });
  it('띠 DM 얼굴은 멤버 id 로 프로필판(사진·상태)을 찾는다, 프로필판은 창마다 하나', () => {
    expect(rail).not.toContain('PersonOf'); // 띠엔 팀 표 하나 — DM 얼굴은 팀 모드 목록(TeamList)에
    expect(mode.match(/useProfiles\(/g)?.length).toBe(1);
    expect(messenger).not.toMatch(/useProfiles\(/); // 따로 창도 useTeamMode 안의 하나
    expect(mode).not.toMatch(/const P = /); // 렌더마다 새 컴포넌트를 만들면 대화 칸이 매번 다시 그려진다
  });
  it('대화 칸·목록 얼굴도 멤버 id 로(사진·상태), DM 머리 둘째 줄은 상태 줄, 방해 금지면 입력칸 위 한 줄', () => {
    expect(convo).toContain('<PersonOf member={convo.peer}');
    expect(convo).toContain('<PersonOf member={it.member}');
    expect(convo).toContain("lookOf(board, member, roster).name"); // 말 위 보낸 사람 이름도 프로필 별명(목록·머리와 같게, 10-26 Karina)
    expect(convo).toContain('lineOf(it, myName, group ? \'\' : convo.name, nameOf,');
    expect(convo).not.toMatch(/<Person /);
    expect(list).not.toMatch(/<Person /);
    expect(convo).toContain('{dnd && <div className="tmp-dnd"');
    expect(convo.indexOf('useContext(ProfilesCtx)')).toBeLessThan(convo.indexOf('let prevAt')); // 훅은 조건 밖
  });
});
