import { describe, expect, it } from 'vitest';
import team from './useTeamMode.tsx?raw';
import phone from '../mobile/PhoneTeam.tsx?raw';

// 11-06 사용자 기준 — 열린 팀 팀원이면 작동, 닫힌 팀은 탭·줄을 안 그린다(앱 쪽 거절은 pro/rust)
describe('닫힌 팀 — 비공개 칸 잠금', () => {
  it('데스크톱: 탭·줄·칸이 closed 를 본다', () => {
    expect(team).toMatch(/const closed = !!closedLine\(view\)/);
    expect(team).toMatch(/mine=\{AgentChat && !closed \?/);
    expect(team).toMatch(/sel === MINE_KEY && AgentChat && !closed \?/);
    expect(team).toMatch(/memory=\{MemoryTab && !closed \?/);
  });
  it('폰: 메모리 탭·칸이 closed 를 본다', () => {
    expect(phone).toMatch(/const closed = !!closedLine\(view\)/);
    expect(phone).toMatch(/MemoryTab && !closed && <button/);
    expect(phone).toMatch(/seg === 'memory' && MemoryTab && !closed \?/);
  });
});
