import { describe, expect, it } from 'vitest';
import { barItems, BAR_ITEMS, railItems } from './topbarMenu';

const all = { tama: true, office: true, voice: true, review: true };

describe('위 막대 오른쪽 아이콘 — 뷰에 따라', () => {
  // 2026-10-11 사용자(180.png): 기록·음성·도구·하니터·리뷰는 채팅 뷰에선 왼쪽 참모 패널(접힌 패널 둘째 줄·펼친 패널 맨 아래)로
  it('터미널 뷰: 리더·사무실·기록·음성·도구·하니터·리뷰가 토글 왼쪽에', () => {
    expect(barItems('terminal', all)).toEqual({ before: ['reader', 'office', 'replay', 'voice', 'tools', 'harnitor', 'review'], after: ['tama', 'inbox'] });
  });
  it('채팅 뷰: 위 막대엔 다마고치·종만 — 리더 대신 스페이스, 사무실은 스페이스 오른쪽 위, 기능 다섯은 참모 패널', () => {
    expect(barItems('chat', all)).toEqual({ before: [], after: ['tama', 'inbox'] });
  });
  it('참모 패널 기능 줄 — 180.png 순서(기록 시계·도구·층·가지), 음성은 빠진다', () => {
    expect(railItems(all)).toEqual(['replay', 'tools', 'harnitor', 'review']);
    expect(railItems({ tama: true, office: true, voice: false, review: false })).toEqual(['replay', 'tools', 'harnitor']);
  });
  // 2026-10-11 사용자: 음성 모드 단추만 패널에서 빼서 채팅 입력칸 옆으로 — 채팅 뷰 위 막대·참모 패널 어디에도 없다
  it('채팅 뷰 음성은 입력칸 옆(ChatVoice) — 위 막대·참모 패널엔 없고, 터미널 뷰 위 막대엔 그대로', () => {
    const chat = barItems('chat', all);
    expect([...chat.before, ...chat.after, ...railItems(all)]).not.toContain('voice');
    expect(barItems('terminal', all).before).toContain('voice');
  });
  it('토글 오른쪽(공통)은 두 뷰가 똑같다 — 뷰를 바꿔도 토글·공통 아이콘 자리가 안 튄다', () => {
    expect(barItems('chat', all).after).toEqual(barItems('terminal', all).after);
  });
  it('꺼 둔 기능(다마고치·사무실·음성·리뷰)은 어느 뷰에서도 안 보인다', () => {
    const off = { tama: false, office: false, voice: false, review: false };
    expect(barItems('terminal', off)).toEqual({ before: ['reader', 'replay', 'tools', 'harnitor'], after: ['inbox'] });
    expect(barItems('chat', off)).toEqual({ before: [], after: ['inbox'] });
  });
  it('도구는 하니터 바로 옆, 리뷰는 그 다음 — 터미널 위 막대와 참모 패널이 같은 순서', () => {
    for (const row of [barItems('terminal', all).before, railItems(all)]) {
      expect(row.indexOf('tools')).toBe(row.indexOf('harnitor') - 1);
      expect(row.indexOf('review')).toBe(row.indexOf('harnitor') + 1);
    }
  });
  it('표의 모든 아이콘은 뷰가 적혀 있다', () => {
    for (const it of BAR_ITEMS) expect(it.views.length).toBeGreaterThan(0);
  });
});
