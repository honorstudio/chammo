// 팀 판 바뀜 묻기 하나로(domain/teamRevWatch) — 데스크톱 프로필판·글판·홈판이 같은 묶음을 쓰고, 폰(웹 API)은 원래 3초 주기 그대로
import { describe, expect, it } from 'vitest';

const src = import.meta.glob(['./useProfiles.ts', './TeamHome.tsx', './teamRev.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const prof = src['./useProfiles.ts'] ?? '';
const home = src['./TeamHome.tsx'] ?? '';
const rev = src['./teamRev.ts'] ?? '';

describe('팀 판 바뀜 묻기는 팀마다 한 번', () => {
  it('묶음 하나를 앱 폴링(ui/poll every)으로', () => {
    expect(rev).toContain('export const teamRev = makeRevWatch(teamProfileChanged, every)');
  });
  it('프로필판은 묶음에 든다 — 따로 3초 묻지 않는다', () => {
    expect(prof).toMatch(/teamRev\.watch\(teamId, \{/);
    expect(prof).not.toMatch(/every\(\(\) => \{ if \(!busy\.current\) void teamProfileChanged/);
  });
  it('글판·홈판은 데스크톱 API 일 때만 묶음, 폰은 원래 주기', () => {
    expect(home).toMatch(/const watchPosts = api === desktopPosts \? teamRev\.watch : undefined/);
    expect(home).toMatch(/const watchHome = homeApi === desktopHome \? teamRev\.watch : undefined/);
    expect(home).not.toMatch(/return every\(\(\) => \{ if \(!busy(Load|Home)\.current\)/);
  });
});
