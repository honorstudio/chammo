// 메신저 대화 칸·팀 보관함 칸에 파일 끌어다 놓기(시안 msg-rooms v2) — 메인 창(fileDrop)·메신저 따로 창(messenger.tsx)이 같이 쓴다.
// Rust drop.rs 가 window.__drop 으로 넘긴 이벤트에서 칸을 찾아 그 칸에 사건으로 알린다(겹침·붙이기는 TeamConvo, 올리기는 TeamLocker)
import { TEAM_LOCKER_DROP } from '../../domain/teamLocker';

export type DropEvent = { type: 'over' | 'drop' | 'leave'; x?: number; y?: number; paths?: string[] };

/** 메신저 대화 칸(.tmx-convo[data-team-drop])에 놓은 파일 — detail = {over: boolean} 또는 {paths} */
export const TEAM_DROP_EVENT = 'honor-team-drop';
let teamLit: HTMLElement | null = null;
let lockerLit: HTMLElement | null = null;
/** 메신저 대화 칸·팀 보관함 칸 위면 그 칸에 알리고 true(메인 창·메신저 따로 창이 같이 쓴다) */
export function teamDrop(e: DropEvent): boolean {
  const at = e.x === undefined || e.y === undefined || e.type === 'leave' ? null : (document.elementFromPoint(e.x, e.y) as HTMLElement | null);
  const el = at?.closest<HTMLElement>('.tmx-convo[data-team-drop]') ?? null;
  if (teamLit && teamLit !== el) teamLit.dispatchEvent(new CustomEvent(TEAM_DROP_EVENT, { detail: { over: false } }));
  teamLit = e.type === 'over' ? el : null;
  // 팀 보관함 칸 — 팀 모두에게 올린다(중계 R2, 이 기기에서 암호화 — TeamLocker)
  const tl = el ? null : at?.closest<HTMLElement>('[data-team-locker]') ?? null;
  const lit = e.type === 'over' ? tl : null;
  if (lockerLit !== lit) { lockerLit?.classList.remove('drop-over'); lit?.classList.add('drop-over'); lockerLit = lit; }
  if (tl) {
    if (e.type === 'drop' && e.paths?.length) window.dispatchEvent(new CustomEvent(TEAM_LOCKER_DROP, { detail: { paths: e.paths, team: tl.dataset.teamLocker ?? '' } }));
    return true;
  }
  if (!el) return false;
  el.dispatchEvent(new CustomEvent(TEAM_DROP_EVENT, { detail: e.type === 'drop' ? { paths: e.paths ?? [] } : { over: e.type === 'over' } }));
  return true;
}

