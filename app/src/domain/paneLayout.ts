// 한 화면(프로젝트 화면·전체 보기) 안의 창 배치. 크게 한 창 하나 + 아래 띠로 접어 둔 창들.
// 띠로 내려간 창은 attach 를 떼어 둔다 — attach 하나가 약 137MB라 안 보이는 창은 붙여 둘 이유가 없다(ADR 0003).

import { applyOrder, moveTo } from './gridSizing';

export type PaneLayout = {
  maximized: string | null;
  collapsed: string[];
  /** 사용자가 끌어 놓은 순서 */
  order?: string[];
  /** 격자 열·줄 비율(fr). 칸 수가 바뀌면 gridSizing.tracksFor 가 균등으로 되돌린다 */
  cols?: number[];
  rows?: number[];
};

export const EMPTY_LAYOUT: PaneLayout = { maximized: null, collapsed: [] };

export type LayoutAction =
  | { type: 'maximize'; id: string }
  | { type: 'restore' }
  | { type: 'collapse'; id: string }
  | { type: 'expand'; id: string }
  | { type: 'forget'; id: string }
  | { type: 'reorder'; ids: string[]; from: string; to: string }
  | { type: 'resize'; axis: 'cols' | 'rows'; tracks: number[] };

export function layoutReducer(s: PaneLayout, a: LayoutAction): PaneLayout {
  switch (a.type) {
    case 'maximize':
      return { ...s, maximized: a.id, collapsed: s.collapsed.filter((x) => x !== a.id) };
    case 'restore':
      return { ...s, maximized: null };
    case 'collapse':
      return {
        ...s,
        maximized: s.maximized === a.id ? null : s.maximized,
        collapsed: s.collapsed.includes(a.id) ? s.collapsed : [...s.collapsed, a.id],
      };
    case 'expand':
      // 크게 상태에서 띠의 창을 꺼내면 둘 다 보여야 하니 크게를 푼다
      return { ...s, maximized: null, collapsed: s.collapsed.filter((x) => x !== a.id) };
    case 'forget':
      return { ...s, maximized: s.maximized === a.id ? null : s.maximized, collapsed: s.collapsed.filter((x) => x !== a.id) };
    case 'reorder':
      return { ...s, order: moveTo(applyOrder(a.ids, s.order), a.from, a.to) };
    case 'resize':
      return { ...s, [a.axis]: a.tracks };
  }
}

/** ids 는 지금 살아 있는 세션 순서. 사라진 세션의 기록은 무시한다 */
export function visiblePanes(allIds: string[], s: PaneLayout): { shown: string[]; strip: string[] } {
  const ids = applyOrder(allIds, s.order);
  if (s.maximized && ids.includes(s.maximized)) {
    return { shown: [s.maximized], strip: ids.filter((x) => x !== s.maximized) };
  }
  return { shown: ids.filter((x) => !s.collapsed.includes(x)), strip: ids.filter((x) => s.collapsed.includes(x)) };
}

/** 크게·되돌리기·화면 전환 뒤 키 입력을 받을 창 — 버튼을 누르면 포커스가 버튼으로 가서 매번 창을 다시 눌러야 했다(사용자 2026-09-28) */
export function paneToFocus(p: { maximized: string | null; wasMaximized: string | null; last: string | null }): string | null {
  return p.maximized ?? p.wasMaximized ?? p.last;
}

/** "그 세션으로 가기"(알림·작업 패널·결정 대기함) 때 그 창이 가려져 있으면 드러내는 동작들 */
export function revealPane(s: Pick<PaneLayout, 'maximized' | 'collapsed'>, id: string): LayoutAction[] {
  const out: LayoutAction[] = [];
  if (s.maximized && s.maximized !== id) out.push({ type: 'restore' });
  if (s.collapsed.includes(id)) out.push({ type: 'expand', id });
  return out;
}

/** ⌘₩ 대상 — 마지막으로 누른 창 → 입력 커서가 있는 창 → 첫 창. shown = 지금 이 격자에 보이는 창들 */
export function maxTarget(remembered: string | undefined, active: string | null, shown: string[]): string | null {
  if (remembered && shown.includes(remembered)) return remembered;
  if (active && shown.includes(active)) return active;
  return shown[0] ?? null;
}

/**
 * "그 세션으로 가기"(알림·결정 대기함)가 포커스를 보낼 격자 이름. 참모는 스페이스·사무실 모드면 오른쪽 열(orch-col)에 있다 —
 * 스페이스 모드에서 'orch'(화면에 없는 격자)로 보내 아무 데도 안 갔다(2026-09-30 사용자)
 */
export function gridKeyOf(
  s: { kind: 'orch' } | { kind: 'helper' } | { kind: 'project'; project: string },
  mode: { space: boolean; office: boolean },
): string {
  if (s.kind === 'orch') return mode.space || mode.office ? 'orch-col' : 'orch';
  return s.kind === 'helper' ? 'helpers' : `p:${s.project}`;
}
