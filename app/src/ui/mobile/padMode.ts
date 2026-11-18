// 패드 배치 판정(domain/padLayout)을 창 크기에 붙인다 — 돌리기·분할 화면에서 폭이 바뀌면 다시
// PadHead = 위 막대 자리. 패드면 대시보드 머리줄(참모·부하·한도·종·사무실·더보기 — 상태·시트는 OrchDash 그대로)이 이리로 포털, extra = 세로 판 열기 단추
import { createContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { padMode, type PadMode } from '../../domain/padLayout';

const read = (): PadMode => padMode(window.innerWidth, window.innerHeight);

export function usePadMode(): PadMode {
  const [m, setM] = useState(read);
  useEffect(() => {
    const on = () => setM(read());
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('orientationchange', on); };
  }, []);
  return m;
}

/** ⌘⇧H·⌘⇧L — 대시보드 홈·보관함 탭으로(detail 'home'|'locker'). 세로면 스페이스 판도 연다 */
export const DASH_TAB = 'm-dash-tab';

export type PadSlot = { el: HTMLElement | null; extra?: ReactNode };
export const PadHead = createContext<PadSlot | null>(null);

/** 패드면 위 막대 자리로, 폰이면 그 자리 그대로(시트가 아니라 머리줄 — 시트는 BottomSheet) */
export const padHeadOut = (node: ReactNode, slot: PadSlot | null): ReactNode => (slot ? (slot.el ? createPortal(node, slot.el) : null) : node);
