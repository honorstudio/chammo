import { tr } from '../i18n';
import type { WorkAct } from './activity';
import { statusWord, type ActivityStatus } from './status';

/** 사무실 아래 현황판 — 누가 무슨 일을 하는지 얼굴 옆에 늘 띄운다(사용자 2026-09-27: 일반 비서 화면의 아래 터미널처럼) */
// 부를 때마다 만든다 — 언어를 바꾼 테스트에서도 맞게(표가 작아 비용 없음)
const VERB = (): Record<WorkAct, string> => ({
  type: tr('고치는 중', 'Editing'), read: tr('읽는 중', 'Reading'), run: tr('실행 중', 'Running'),
  web: tr('웹 보는 중', 'Browsing'), agent: tr('분신 보냄', 'Sent a helper'), think: tr('생각 중', 'Thinking'),
});
/** st = 원래 상태(메뉴와 같은 말 — statusWord), human = 브라우저가 사람을 부른 이유(있으면 무슨 상태든 그게 먼저) */
export function dockLine(st: ActivityStatus, act: WorkAct | undefined, doing: string | undefined, human?: string): { verb: string; text: string } {
  if (human !== undefined) return { verb: tr('사람 필요', 'Needs you'), text: human };
  if (st === 'working') return { verb: VERB()[act ?? 'think'], text: doing ?? '' };
  return { verb: statusWord(st), text: '' };
}

export type Tick = { text: string; at: number };
const KEEP = 3;
/** 하는 일이 바뀔 때마다 맨 위에 — 방금 뭘 했는지 두 줄 더 보인다 */
export function pushTick(prev: Tick[], text: string, now: number): Tick[] {
  if (!text || prev[0]?.text === text) return prev;
  return [{ text, at: now }, ...prev].slice(0, KEEP);
}

export function ago(at: number, now: number): string {
  const s = Math.floor((now - at) / 1000);
  if (s < 10) return tr('방금', 'now');
  if (s < 60) return tr(`${s}초`, `${s}s`);
  if (s < 3600) return tr(`${Math.floor(s / 60)}분`, `${Math.floor(s / 60)}m`);
  return tr(`${Math.floor(s / 3600)}시간`, `${Math.floor(s / 3600)}h`);
}

/** 답 원문 → 카드 한 줄(마크다운 기호·줄바꿈 제거, 길이는 CSS 가 두 줄로 자른다) */
export function noteOf(text: string | undefined): string {
  return (text ?? '').replace(/\*\*|__|`|^#+\s*/gm, '').replace(/\s+/g, ' ').trim();
}

/** 현황판 카드 폭·사이·+N 단추 폭(styles.css .dock-card·.office-dock gap·.dock-more) */
export const DOCK_CARD = 224, DOCK_GAP = 8, DOCK_MORE = 56;
/**
 * 현황판은 한 줄만 — 줄이 늘면 방 바닥을 가렸다(11-09 사용자 13장 = 세 줄). 넘치면 +N 단추 자리를 빼고 들어가는 만큼, 나머지는 단추를 눌러 편다.
 * n = 카드 수, width = 현황판 폭(px)
 */
export function dockFit(n: number, width: number): { show: number; more: number } {
  const fit = (w: number) => Math.max(1, Math.floor((w + DOCK_GAP) / (DOCK_CARD + DOCK_GAP)));
  if (n <= fit(width)) return { show: n, more: 0 };
  const show = Math.min(n, fit(width - DOCK_MORE - DOCK_GAP));
  return { show, more: n - show };
}
