import { tr } from '../i18n';
import type { WorkAct } from './activity';
import type { OfficeState } from './office';

/** 사무실 아래 현황판 — 누가 무슨 일을 하는지 얼굴 옆에 늘 띄운다(사용자 2026-09-27: 일반 비서 화면의 아래 터미널처럼) */
// 부를 때마다 만든다 — 언어를 바꾼 테스트에서도 맞게(표가 작아 비용 없음)
const VERB = (): Record<WorkAct, string> => ({
  type: tr('고치는 중', 'Editing'), read: tr('읽는 중', 'Reading'), run: tr('실행 중', 'Running'),
  web: tr('웹 보는 중', 'Browsing'), agent: tr('분신 보냄', 'Sent a helper'), think: tr('생각 중', 'Thinking'),
});
const STATE = (): Record<Exclude<OfficeState, 'working'>, string> => ({
  asks: tr('물어봄', 'Asking'), done: tr('끝남', 'Done'), wait: tr('대기', 'Idle'), sleep: tr('잠듦', 'Asleep'),
});

export function dockLine(st: OfficeState, act: WorkAct | undefined, doing: string | undefined): { verb: string; text: string } {
  if (st === 'working') return { verb: VERB()[act ?? 'think'], text: doing ?? '' };
  return { verb: STATE()[st], text: '' };
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
