// 폰 채팅 시트·화면 틀이 박혔을 때 알아보고 되돌리기(2026-10-11) — 판단만 여기, 사건·그리기는 ui/mobile/useSheetDrag·useViewport
// 공용 시트 판단(끌기 속도·목록 끌기·자리 모델)도 여기 — 채팅 시트·아래 시트가 같은 틀(SheetModel)을 쓴다
import { closeOnRelease, diagLine, releaseSnap, rubberTop, sheetTop, type Snap } from './mobile';

/** 끌기를 놓아 줄 때까지 기다리는 시간 — 손 없이 이만큼 움직임이 없으면 손 떼는 사건을 잃은 것(앱 전환·알림 누르기) */
export const STALE_DRAG_MS = 1500;

export function dragStale(o: { dragging: boolean; touching: boolean; lastMoveAt: number; now: number }): boolean {
  return o.dragging && !o.touching && o.now - o.lastMoveAt >= STALE_DRAG_MS;
}

/** 끈 자리에서 가장 가까운 자리 */
export function nearestSnap(top: number, viewport: number, peekH: number): Snap {
  const snaps: Snap[] = ['full', 'half', 'peek'];
  return snaps.reduce((a, b) => (Math.abs(sheetTop(b, viewport, peekH) - top) < Math.abs(sheetTop(a, viewport, peekH) - top) ? b : a));
}

/** 이상한 화면 — 입력줄이 보이는 화면 아래로 빠졌거나(comp-below), 쓰는 중이 아닌데 화면 틀이 밀렸거나(frame-shift).
 *  쓰는 중·키보드가 떠 있을 땐 iOS 가 화면을 옮기니 보지 않는다 */
export function layoutOff(o: { compBottom: number; visBottom: number; frameTop: number; editing: boolean; kb: boolean }): 'comp-below' | 'frame-shift' | null {
  if (o.editing || o.kb) return null;
  if (o.compBottom > o.visBottom + 8) return 'comp-below';
  if (Math.abs(o.frameTop) > 8) return 'frame-shift';
  return null;
}

/** 시트 위 끝 — 키보드가 떠 있으면 반·전체는 보이는 화면 맨 위(머리줄을 시트 모서리에 반쯤 걸치지 않게, 2026-10-11 UI 재조사). 아니면 sheetTop */
export function openTop(snap: Snap, viewport: number, peekH: number, kb: boolean): number {
  if (kb && snap !== 'peek') return 0;
  return sheetTop(snap, viewport, peekH);
}

/** 시트에 대화 칸을 그리나 — 반·전체는 늘, 살짝은 끄는 동안만. 살짝에서 끌어올리면 시트가 바닥까지 늘어나는데 대화 칸(flex:1)이 없어
 *  입력줄 위가 빈 바탕으로 남았다(2026-10-12 사용자 "끌고 있을 때") — 끄는 동안 대화가 드러나게 */
export function logShown(snap: Snap, dragging: boolean): boolean {
  return snap !== 'peek' || dragging;
}

/** 손가락 자취 한 점 */
export type TrailPt = { t: number; y: number };

/** 놓는 속도(px/ms, 아래 +) — 놓기 직전 0.1초 동안. 자취가 없으면 0 */
export function flickV(trail: TrailPt[], t: number, y: number): number {
  if (!trail.length) return 0;
  const first = trail.find((p) => t - p.t <= 100) ?? trail[trail.length - 1]!;
  return (y - first.y) / Math.max(1, t - first.t);
}

/** 이만큼 움직여야 끌기 — 그 아래는 누르기 */
export const SLOP = 5;

/** 목록 위에서 손가락이 움직일 때 — 맨 위에서 아래로면 시트를 끌고, 위로·스크롤된 목록이면 목록에 맡긴다 */
export function pullStep(o: { dy: number; scrollTop: number }): 'drag' | 'wait' | 'scroll' {
  if (o.dy < -SLOP || o.scrollTop > 0) return 'scroll';
  return o.dy > SLOP ? 'drag' : 'wait';
}

/** 시트 자리 모델 — 끌기 훅은 이것만 안다. 자리 값(px)은 채팅 시트는 위 끝, 아래 시트는 아래로 민 양 */
export type SheetModel<S extends string> = {
  /** 지금 쉬는 자리 */
  rest: number;
  /** 끄는 중 그릴 자리 */
  rubber: (p: number) => number;
  /** 놓을 때 갈 자리 */
  release: (start: number, end: number, v: number) => S;
  /** 박혀서 놓아 줄 때 갈 자리 — 가장 가까운 곳 */
  nearest: (p: number) => S;
};

/** 아래 시트 — 열림(0)·닫힘. 위로는 고무줄, 80px 넘게 내리거나 아래로 튕기면 닫는다. h = 시트 높이 */
export function modalModel(h: number): SheetModel<'open' | 'closed'> {
  return {
    rest: 0,
    rubber: (p) => (p < 0 ? p * 0.35 : p),
    release: (start, end, v) => (closeOnRelease(end - start, v) ? 'closed' : 'open'),
    nearest: (p) => (p > h / 2 ? 'closed' : 'open'),
  };
}

/** 채팅 시트 — 살짝·반·전체(domain/mobile 판단 그대로) */
export function chatModel(snap: Snap, vh: number, peekH: number, kb: boolean): SheetModel<Snap> {
  return {
    rest: openTop(snap, vh, peekH, kb),
    rubber: (p) => rubberTop(p, vh, peekH),
    release: (start, end, v) => releaseSnap(snap, start, end, v, vh, peekH),
    nearest: (p) => nearestSnap(p, vh, peekH),
  };
}

/** 박힘 풀기 진단 한 줄(맥 phone-layout.jsonl) — sheet = chat·pick·card */
export function stuckLine(f: { sheet: string; why: string; at: number; to: string; vh: number; from?: string }): string {
  return diagLine(f);
}
