// 위 막대 오른쪽 아이콘 — 채팅 뷰와 터미널 뷰가 아예 달라져서 '채팅 | 터미널' 토글에 따라 그 뷰에서 쓰는 것만(2026-10-03 사용자).
// 순서 고정: [그 뷰에서만 쓰는 것] [토글] [두 뷰 공통 … 종]. 뷰에서만 쓰는 건 토글 왼쪽에 둬서, 뷰를 바꿔도
// 오른쪽 끝에 붙은 토글·공통 아이콘 자리가 안 튄다(방금 누른 토글이 커서 밑에서 움직이면 두 번 눌린다).

export type BarItem = 'reader' | 'tama' | 'office' | 'replay' | 'voice' | 'tools' | 'harnitor' | 'inbox';
export type View = 'chat' | 'terminal';

/** 표 = 순서. feature = 설정에서 끌 수 있는 기능(꺼 두면 어느 뷰에서도 숨김) */
export const BAR_ITEMS: { id: BarItem; views: View[]; feature?: 'tama' | 'office' | 'voice' }[] = [
  { id: 'reader', views: ['terminal'] },
  { id: 'tama', views: ['chat', 'terminal'], feature: 'tama' },
  // 채팅 뷰 사무실은 스페이스 오른쪽 위 세 칸(대시보드·펫·사무실)에 있어서 위 막대엔 터미널 뷰만(2026-10-03 사용자)
  { id: 'office', views: ['terminal'], feature: 'office' },
  { id: 'replay', views: ['chat', 'terminal'] },
  { id: 'voice', views: ['chat', 'terminal'], feature: 'voice' },
  // 도구(MCP·플러그인·스킬) — 스페이스 사이드바 줄에서 옮김(2026-10-05 사용자 "여기 패널은 아니지, 메뉴바에"). 하니터와 이웃
  { id: 'tools', views: ['chat', 'terminal'] },
  { id: 'harnitor', views: ['chat', 'terminal'] },
  { id: 'inbox', views: ['chat', 'terminal'] },
];

export function barItems(view: View, f: { tama: boolean; office: boolean; voice: boolean }): { before: BarItem[]; after: BarItem[] } {
  const shown = BAR_ITEMS.filter((x) => x.views.includes(view) && (!x.feature || f[x.feature]));
  return {
    before: shown.filter((x) => x.views.length === 1).map((x) => x.id),
    after: shown.filter((x) => x.views.length > 1).map((x) => x.id),
  };
}
