// 채팅 뷰 사무실 — 스페이스 칸을 사무실로 바꿔 끼운다(시안 docs/design-drafts/office-chat v1 A, 2026-10-03 사용자 확정).
// 사무실도 스페이스 화면 키(pick) 하나라서, 탭(참모)마다 보던 화면 기억이 사무실까지 그대로 따라간다.

/** 스페이스 화면 키 — 사무실 */
export const OFFICE = 'f:';

/** 스페이스 머리 두 아이콘 · 탑바 사무실 아이콘(toggle). before = 사무실 켜기 전 화면 — 돌아갈 때 거기로(모르면 home = 그 참모 대시보드) */
export function officePick(pick: string, want: 'office' | 'space' | 'toggle', before: string, home: string): { pick: string; before: string } {
  const on = pick === OFFICE;
  const go = want === 'toggle' ? !on : want === 'office';
  if (go === on) return { pick, before };
  return go ? { pick: OFFICE, before: pick } : { pick: before || home, before: '' };
}

/** scripts/show 로 새로 뜬 것 — 사무실 밖이면 md 는 문서 페이지로, 그림·시안은 보던 화면 위 미리보기.
 *  사무실이면 사무실을 떠나지 않는다(오피스 A 1단계, 2026-10-04): 그림·시안은 사무실 위 미리보기, md 는 사무실 위 창(sheet).
 *  예전엔 대시보드로 넘어간 뒤 띄워서, 닫으면 사무실이 아니라 대시보드였다 */
export function showPick(pick: string, path: string, md: boolean): { pick: string; sheet?: string } {
  if (pick === OFFICE) return md ? { pick, sheet: `d:${path}` } : { pick };
  return { pick: md ? `d:${path}` : pick };
}

/** 사무실 위 창 기록 — 창 안에서 링크를 타고 가면 쌓이고 뒤로 = 한 칸 빼기. 같은 게 맨 위면 그대로, 아래 있으면 거기까지 줄인다 */
export function sheetOpen(stack: string[], k: string): string[] {
  if (stack[stack.length - 1] === k) return stack;
  const at = stack.indexOf(k);
  return at >= 0 ? stack.slice(0, at + 1) : [...stack, k];
}
export const sheetBack = (stack: string[]): string[] => stack.slice(0, -1);

/** 사무실 책상·현황판 카드를 누르면 — 하위 세션은 사무실 위 창, 다른 참모는 그 채팅 탭, 지금 탭 참모는 없음 */
export function deskTarget(id: string, orchIds: string[], viewing: string): { sheet: string } | { tab: string } | null {
  if (!orchIds.includes(id)) return { sheet: `s:${id}` };
  return id === viewing ? null : { tab: id };
}

export type Side = 'office' | 'space';

/** 참모마다 마지막 고른 쪽 — key = 참모 이름(앱을 다시 켜도 같은 이름). 안 바뀌면 같은 객체 */
export function rememberSide(map: Record<string, Side>, key: string, pick: string): Record<string, Side> {
  // 시안 검토·하니터는 잠깐 덮는 화면 — 닫으면 원래 화면(사무실)으로 돌아오니 기억을 안 바꾼다
  if (pick.startsWith('c:') || pick === 'h:') return map;
  const side: Side = pick === OFFICE ? 'office' : 'space';
  return map[key] === side ? map : { ...map, [key]: side };
}

/** 그 참모 탭에 처음 갈 때 화면 — 사무실로 둔 참모면 사무실 */
export function startPick(map: Record<string, Side>, key: string | string[], home: string): string {
  const side = (Array.isArray(key) ? key : [key]).map((k) => map[k]).find((x) => x !== undefined);
  return side === 'office' ? OFFICE : home;
}

/** 왼쪽 목록에서 참모 이름을 누르면 — 다른 참모는 그 참모가 마지막에 보던 쪽(home = startPick 결과), 지금 보는 참모를 다시 누르면 대시보드.
 *  예전엔 늘 대시보드라 사무실 기억이 덮였다(2026-10-03 QA 7번). 참모 줄이 아니면 누른 그대로 */
export function navPick(k: string, orchId: string | undefined, viewing: string | undefined, home: string): string {
  if (!orchId || k !== `o:${orchId}` || orchId === viewing) return k;
  return home;
}

export type SpaceSide = 'dash' | 'pet' | 'office';

/** 머리 오른쪽 끝 세 칸 중 지금 칸 — 지금 탭 참모의 대시보드(petFor = 펫 탭을 연 참모)·사무실에서만, 그 밖은 null(세 칸 안 그림).
 *  두 묶음(대시보드|펫, 스페이스|사무실)이 따로 그려져 오갈 때 자리가 튀었다 — 하나로 합쳐 한 자리에(2026-10-03 사용자) */
export function spaceView(pick: string, petFor: string | null, orchId: string): SpaceSide | null {
  if (pick === OFFICE) return 'office';
  if (pick !== `o:${orchId}`) return null;
  return petFor === orchId ? 'pet' : 'dash';
}
