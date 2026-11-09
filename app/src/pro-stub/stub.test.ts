import { describe, expect, it } from 'vitest';
import { pro } from './index';
import teamMode from '../ui/team/useTeamMode.tsx?raw';
import phoneTeam from '../ui/mobile/PhoneTeam.tsx?raw';
import teamSpace from '../ui/team/TeamSpace.tsx?raw';
import teamList from '../ui/team/TeamList.tsx?raw';

describe('공개 빌드의 자리표', () => {
  it('공식 설치 파일의 칸은 비어 있다', () => {
    expect(pro.MemoryTab).toBeNull();
    expect(pro.AgentChat).toBeNull();
  });
  it('비어 있으면 탭·줄을 안 그리는 길이 화면에 있다', () => {
    expect(teamMode).toMatch(/mine=\{AgentChat && !closed \? /);
    expect(teamMode).toMatch(/memory=\{MemoryTab && !closed \? /);
    expect(teamMode).toContain("sel === MINE_KEY && AgentChat && !closed ?");
    expect(phoneTeam).toContain('{MemoryTab && !closed && <button');
    expect(phoneTeam).toContain("seg === 'memory' && MemoryTab && !closed ?");
    expect(teamSpace).toContain('{memory && <button');
    expect(teamList).toContain('mine && (');
  });
});
