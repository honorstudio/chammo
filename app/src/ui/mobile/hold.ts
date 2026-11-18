// 길게 누르기 화면 쪽 — 눌린 느낌(.m-holding)과 사파리 기본 동작 막기. 때는 domain/hold(HOLD_MS·PRESS_MS) 하나
// 눌린 느낌은 React 상태 없이 요소 클래스로 — 줄마다 다시 그리지 않게
import { blocksNative, PRESS_MS } from '../../domain/hold';

/** 누르기 시작 — PRESS_MS 뒤 눌린 느낌을 켠다. 돌려준 함수: fired = 메뉴가 떴나(떴으면 사파리가 잡은 글 고르기도 지운다) */
export function pressFeel(el: Element | null): (fired?: boolean) => void {
  if (!el) return () => {};
  const t = window.setTimeout(() => el.classList.add('m-holding'), PRESS_MS);
  return (fired) => {
    window.clearTimeout(t);
    el.classList.remove('m-holding');
    if (fired) window.getSelection()?.removeAllRanges();
  };
}

/** 폰 화면 전체에 한 번 — 길게 누르기 대상 안에서 시작한 글 고르기·기본 메뉴를 막고, 화면 단추·탭 글 고르기를 끄는 .m-chrome 을 단다.
 *  아이 화면(KidsScreen)은 MobileApp 이 아니라 안 걸린다. 돌려준 함수로 뗀다 */
export function installHoldGuard(): () => void {
  const root = document.documentElement;
  root.classList.add('m-chrome');
  const stop = (e: Event) => { if (blocksNative(e.target as Element | null)) e.preventDefault(); };
  document.addEventListener('selectstart', stop, true);
  document.addEventListener('contextmenu', stop, true);
  return () => {
    root.classList.remove('m-chrome');
    document.removeEventListener('selectstart', stop, true);
    document.removeEventListener('contextmenu', stop, true);
  };
}
