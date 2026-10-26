// 앱 공용 오른쪽 클릭 메뉴(ui/OrchDialogs ContextMenu)의 자리·키 판단 — 시험: ctxMenu.test.ts

const PAD = 8;

/** 누른 자리(x,y)에서 메뉴(w×h)가 창(vw×vh) 밖으로 안 넘치게 — 오른쪽이 모자라면 왼쪽으로, 아래가 모자라면 위로 펼친다(맥 메뉴처럼).
 *  창보다 길면 위 여백에 붙이고 maxHeight 로 잘라 스크롤 */
export function menuPos(x: number, y: number, w: number, h: number, vw: number, vh: number): { left: number; top: number; maxHeight?: number } {
  const left = Math.max(PAD, x + w > vw - PAD ? x - w : x);
  if (h > vh - PAD * 2) return { left, top: PAD, maxHeight: vh - PAD * 2 };
  const top = y + h > vh - PAD ? Math.max(PAD, y - h) : y;
  return { left, top };
}

/** 화살표·Home·End 로 고른 줄 — n 개 중 i(-1 = 아직 없음). 끝에서 돈다 */
export function menuStep(n: number, i: number, key: string): number {
  if (n <= 0) return i;
  if (key === 'ArrowDown') return i < 0 ? 0 : (i + 1) % n;
  if (key === 'ArrowUp') return i < 0 ? n - 1 : (i - 1 + n) % n;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return i;
}

/** 우클릭 뒤따라오는 click 인가 — 맥 웹뷰는 우클릭(두 손가락·ctrl+클릭) 뒤에 click 을 하나 더 보내 카드가 열렸다(2026-10-12 191.png).
 *  메뉴를 연 지 0.4초 안의 click, 그리고 ctrl+클릭·왼쪽 아닌 버튼 click 은 언제든 삼킨다 */
export function trailingClick(e: { button: number; ctrlKey: boolean }, sinceMenuMs: number): boolean {
  return e.ctrlKey || e.button !== 0 || sinceMenuMs < 400;
}

/** 줄·카드 누름이 열기인가 — 왼쪽 단추만. 맥 ctrl+클릭(= 오른쪽 클릭)·오른쪽·가운데 단추는 메뉴 몫(10-26 사용자 "오른쪽 클릭하면 열기도 같이 돌아서 '폴더로 옮기기'를 못 써") */
export const opensOnClick = (e: { button: number; ctrlKey: boolean }) => e.button === 0 && !e.ctrlKey;
