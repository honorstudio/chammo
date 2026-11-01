// 11-01 QA(ux-team) 되돌림 막기 — DOM 없이 소스로
import { describe, expect, it } from 'vitest';
import home from './TeamHome.tsx?raw';
import lockerDomain from '../../domain/teamLocker.ts?raw';
import locker from './TeamLocker.tsx?raw';
import mode from './useTeamMode.tsx?raw';

describe('11-01 QA ux-team', () => {
  it('H5: 팀 홈 글 지우기는 휴지통을 약속하지 않는다 — 보관함은 파일 줄만 보여 지운 글을 되살릴 화면이 없다', () => {
    expect(lockerDomain).toContain("i.kind === 'file'");
    expect(home).not.toMatch(/휴지통에 남아요|stays in the team locker trash/);
  });

  it('M3: 남의 파일 영구 지우기는 권한 있을 때만 메뉴에, 휴지통·이름 바꾸기는 한 번 묻는다', () => {
    expect(locker).toContain('canPurge(i, canFiles)');
    expect(locker).toContain('othersOf(picked)');
    expect(locker).toMatch(/if \(i\.mine\) go\(\); else setAskOther/);
    expect(mode.match(/canFiles=\{canDo\(view, 'files'\)\}/g)?.length).toBe(2);
  });
});
