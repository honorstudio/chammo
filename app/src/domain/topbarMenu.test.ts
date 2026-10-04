import { describe, expect, it } from 'vitest';
import { barItems, BAR_ITEMS } from './topbarMenu';

const all = { tama: true, office: true, voice: true };

describe('위 막대 오른쪽 아이콘 — 뷰에 따라', () => {
  it('터미널 뷰: 리더·사무실이 토글 왼쪽에, 나머지는 공통', () => {
    expect(barItems('terminal', all)).toEqual({ before: ['reader', 'office'], after: ['tama', 'replay', 'voice', 'tools', 'harnitor', 'inbox'] });
  });
  it('채팅 뷰: 리더·사무실 없음(리더 대신 스페이스, 사무실은 스페이스 오른쪽 위 세 칸에)', () => {
    expect(barItems('chat', all)).toEqual({ before: [], after: ['tama', 'replay', 'voice', 'tools', 'harnitor', 'inbox'] });
  });
  it('토글 오른쪽(공통)은 두 뷰가 똑같다 — 뷰를 바꿔도 토글·공통 아이콘 자리가 안 튄다', () => {
    expect(barItems('chat', all).after).toEqual(barItems('terminal', all).after);
  });
  it('꺼 둔 기능(다마고치·사무실·음성)은 어느 뷰에서도 안 보인다', () => {
    const off = { tama: false, office: false, voice: false };
    expect(barItems('terminal', off)).toEqual({ before: ['reader'], after: ['replay', 'tools', 'harnitor', 'inbox'] });
    expect(barItems('chat', off)).toEqual({ before: [], after: ['replay', 'tools', 'harnitor', 'inbox'] });
  });
  it('도구(MCP·플러그인·스킬)는 스페이스 사이드바가 아니라 위 막대에, 두 뷰 다 — 하니터 옆(2026-10-05 사용자 "여기 패널은 아니지, 메뉴바에")', () => {
    for (const v of ['chat', 'terminal'] as const) {
      const { after } = barItems(v, all);
      expect(after.indexOf('tools')).toBe(after.indexOf('harnitor') - 1);
    }
  });
  it('표의 모든 아이콘은 뷰가 적혀 있다', () => {
    for (const it of BAR_ITEMS) expect(it.views.length).toBeGreaterThan(0);
  });
});
