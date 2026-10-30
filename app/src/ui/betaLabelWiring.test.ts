import { describe, expect, it } from 'vitest';
import teamMode from './team/useTeamMode.tsx?raw';
import teamLocker from './team/TeamLocker.tsx?raw';
import devices from './DevicesSection.tsx?raw';
import phoneTeam from './mobile/PhoneTeam.tsx?raw';

// 2026-10-29 사용자: 유료 예정 기능(메신저·팀 보관함·기기 연결)에 '베타 · 지금은 무료' — 지금 쓰는 사람에게도 보이게.
// 들어가는 자리마다 하나씩: 팀 모드 머리(팀 이름 아래)·팀 보관함 머리(대화 파일 보기엔 안)·설정 내 기기·테일스케일로 직접 잇기(폰 QR·다른 기기 참모)·폰 팀 탭 머리
const count = (src: string) => (src.match(/<BetaTag\b/g) ?? []).length;

describe('베타 표시 자리', () => {
  it('팀 모드 머리 — 팀 이름 옆 칸에 하나', () => {
    expect(count(teamMode)).toBe(1);
    expect(teamMode).toMatch(/tmx-list-h[\s\S]{0,200}<b>\{team\}<\/b><BetaTag/);
  });
  it('팀 보관함 머리 — 팀 보관함일 때만(대화 파일 보기엔 안 붙임)', () => {
    expect(count(teamLocker)).toBe(1);
    expect(teamLocker).toMatch(/!room && <BetaTag/);
  });
  it('설정 > 내 기기 — 계정 기기 칸과 테일스케일로 직접 잇기 칸 머리에 하나씩', () => {
    expect(count(devices)).toBe(2);
    expect(devices).toMatch(/<h2>\{title\}<\/h2><BetaTag/);
    expect(devices).toMatch(/테일스케일로 직접 잇기[^<]*<\/h2><BetaTag/);
  });
  it('폰 팀 탭 머리 — 팀 바꾸기 단추 옆에 하나', () => {
    expect(count(phoneTeam)).toBe(1);
    expect(phoneTeam).toMatch(/m-team-switch[\s\S]{0,400}<\/button>\s*<BetaTag/);
  });
});
