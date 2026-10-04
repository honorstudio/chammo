import { describe, expect, it } from 'vitest';
import { selectionWord, spaceWord, viewLine } from './viewNow';

// 사용자가 화면을 보며 "여기 왜 이래?" 하면 참모가 "여기"를 몰랐다(2026-10-02 사용자 "내가 보는 화면을 니가 감지하느냐").
// 앱이 지금 보는 화면을 한 줄로 적고, 참모 훅이 지시마다 그 줄을 붙인다
describe('viewLine — 지금 보는 화면 한 줄', () => {
  it('채팅 뷰 — 탭 · 스페이스 · 하니터 안에서 고른 것', () => {
    expect(viewLine({ mode: '채팅 뷰', tab: '참모-2', space: '하니터', harnitor: '프로젝트 honor-orchestrator · 고른 것 mcp:supabase' }))
      .toBe('채팅 뷰 · 채팅 탭 참모-2 · 왼쪽 스페이스: 하니터 (프로젝트 honor-orchestrator · 고른 것 mcp:supabase)');
  });
  it('하니터가 아닌 화면엔 하니터 줄을 안 붙인다(닫은 뒤 남은 값)', () => {
    expect(viewLine({ mode: '채팅 뷰', tab: '참모', space: '문서 ~/a.md', harnitor: '프로젝트 x' })).toBe('채팅 뷰 · 채팅 탭 참모 · 왼쪽 스페이스: 문서 ~/a.md');
  });
  it('미리보기 창이 떠 있으면 그게 맨 위', () => {
    expect(viewLine({ mode: '채팅 뷰', tab: '참모', space: '참모 대시보드', preview: '~/x.png' })).toBe('채팅 뷰 · 채팅 탭 참모 · 왼쪽 스페이스: 참모 대시보드 · 그 위 미리보기 창: ~/x.png');
  });
  it('터미널 뷰 — 고른 칸 · 커서가 있는 세션', () => {
    expect(viewLine({ mode: '터미널 뷰 — 프로젝트 project-b', focus: 'project-b-1' })).toBe('터미널 뷰 — 프로젝트 project-b · 커서가 있는 세션 project-b-1');
  });
  it('비면 빈 줄', () => {
    expect(viewLine({})).toBe('');
  });
});

describe('spaceWord — 스페이스 화면 키를 말로', () => {
  const names = { orch: (id: string) => (id === 'a' ? '참모' : undefined), session: (id: string) => (id === 's1' ? 'project-b-1' : undefined), home: '/Users/me' };
  it.each([
    ['o:a', '참모 대시보드'],
    ['p:/Users/me/Desktop/dev/project-b', '프로젝트 project-b 대시보드'],
    ['s:s1', '세션 project-b-1 화면'],
    ['d:/Users/me/Desktop/dev/x/docs/starter.md', '문서 ~/Desktop/dev/x/docs/starter.md'],
    ['c:/Users/me/d/v2.html', '시안 검토(큐레이션) ~/d/v2.html'],
    ['h:', '하니터'],
    ['f:', '사무실'],
    ['m:', '페이지 목록'],
    ['rv:', '리뷰'],
    ['r:daily', '예약(루틴) daily'],
    ['t:', '도구'],
    ['t:/Users/me/Desktop/dev/project-b', '도구 project-b'],
  ])('%s → %s', (k, want) => expect(spaceWord(k, names)).toBe(want));
});

describe('selectionWord — 터미널 뷰에서 고른 칸', () => {
  it('프로젝트는 이름까지', () => {
    expect(selectionWord({ kind: 'project', name: 'project-b' })).toBe('프로젝트 project-b');
    expect(selectionWord({ kind: 'orchestrator' })).toBe('오케스트레이터');
  });
});
