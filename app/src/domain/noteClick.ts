// 데스크톱 알림을 눌렀을 때 할 일 — 갈 곳 글자(domain/notify noteTarget)를 되읽어 정한다.
// 세션·카드는 세션 목록이 있어야 찾는다 — 앱이 막 켜져 목록이 오기 전이면 기다렸다 간다(2026-11-18 사용자 "어떨 땐 되고 안 되고")
import { readNoteTarget } from './notify';
import { tabOf, type SettingsTab } from './settingsTabs';

export type NoteClickPlan =
  | { do: 'wait' }
  | { do: 'none' }
  | { do: 'inbox' }
  | { do: 'team'; room: string }
  | { do: 'settings'; tab: SettingsTab }
  | { do: 'session'; id: string }
  | { do: 'card'; orch: string; card: string };

/** 세션 목록을 기다린 누름을 들고 있는 시간 — 그보다 늦게 뜬 화면은 사람이 이미 다른 걸 보고 있다 */
export const NOTE_WAIT_MS = 30_000;

/** ready = 세션 목록·환경을 한 번이라도 받았나 */
export function noteClickPlan(raw: string, ready: boolean): NoteClickPlan {
  if (raw.startsWith('settings:')) {
    const tab = tabOf(raw.slice(9));
    return tab ? { do: 'settings', tab } : { do: 'none' };
  }
  const t = readNoteTarget(raw);
  if (!t || t.to === 'latest') return { do: 'none' };
  if (t.to === 'inbox') return { do: 'inbox' };
  if (t.to === 'team') return { do: 'team', room: t.room };
  if (!ready) return { do: 'wait' };
  return t.to === 'session' ? { do: 'session', id: t.id } : { do: 'card', orch: t.orch, card: t.card };
}

export type HeldNote = { raw: string; at: number };
/** sessionStorage 열쇠 */
export const NOTE_HELD = 'noteHeld';

/** 기다리던 누름 — 아직 들고 있을 만하면 그 글자, 아니면 null */
export const heldNote = (h: HeldNote | null, now: number): string | null => (h && now - h.at <= NOTE_WAIT_MS ? h.raw : null);

/** 기다리는 누름은 sessionStorage 에 둔다 — 켜는 중 화면이 한 번 다시 읽히면(설정 비추기·흰 화면 감시) 들고 있던 누름이 같이 사라졌다(11-18 시험 앱 실측).
 *  저장된 글을 되읽기 — 모양이 아니면 null */
export function parseHeld(v: string | null): HeldNote | null {
  try {
    const o = JSON.parse(v ?? 'null') as Partial<HeldNote> | null;
    return o && typeof o.raw === 'string' && typeof o.at === 'number' ? { raw: o.raw, at: o.at } : null;
  } catch {
    return null;
  }
}
