// 팀 보관함 파일을 내 참모에게(10-26 사용자 "보관함에서 내 참모들한테 주고 수정 시키려는데 안 된다") — 화면(ui/team/teamGive)과 따로 시험한다.
// 참모 목록은 메인 창이 그려 내놓고(localStorage) 메신저 따로 창이 읽는다 — 따로 창엔 참모 세션 목록이 없다
import { tr } from '../i18n';
import type { TeamFile } from './teamChat';

/** 고를 참모 한 줄 — id = 세션 id, owner = 보관함 폴더 열쇠(SpaceView ownerKey), name = 세션 이름(프사 찾기 — 없으면 별명), label = 별명, busy = 지금 일하는 중 */
export type RosterOrch = { id: string; owner: string; name?: string; label: string; color: string; busy: boolean; /** 띠 점(물어봄·새 것·일함·쉼) — 바탕·따로 창 배지 숫자 알약 */ pip?: 'ask' | 'new' | 'run' | 'rest' | null };
const PIPS = ['ask', 'new', 'run', 'rest'] as const;

/** 다른 창에서 끌어 놓은 팀 파일을 받는 신호(dragPath → teamGive giveIn) — detail { team, ids, to: 참모·세션 id } */
export const TEAM_GIVE_IN = 'team-give-in';

/** 메인 창이 쓰고 따로 창이 읽는 자리 */
export const ROSTER_KEY = 'chammo.orchRoster.v1';

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const idOk = (id: unknown): id is string => typeof id === 'string' && !!id && id.length <= 80 && !id.startsWith('team-') && !/[/\\]/.test(id) && !id.startsWith('.');

/** 저장된 글 → 참모 목록. 모양이 틀린 줄·팀 폴더 id(team-…)는 버리고, 메뉴가 창을 넘지 않게 40줄까지 */
export function parseRoster(raw: string | null): RosterOrch[] {
  let v: unknown;
  try { v = JSON.parse(raw ?? ''); } catch { return []; }
  if (!Array.isArray(v)) return [];
  const out: RosterOrch[] = [];
  for (const x of v as Record<string, unknown>[]) {
    if (!x || !idOk(x.id) || typeof x.owner !== 'string' || !x.owner || typeof x.label !== 'string') continue;
    const label = cut(x.label || x.owner, 60);
    out.push({ id: x.id, owner: cut(x.owner, 120), name: typeof x.name === 'string' && x.name ? cut(x.name, 120) : label, label, color: typeof x.color === 'string' ? cut(x.color, 40) : '', busy: x.busy === true, pip: PIPS.find((p) => p === x.pip) ?? null });
    if (out.length >= 40) break;
  }
  return out;
}

/** 메뉴 한 줄 글 — 별명만(상태 글은 안 붙인다: 고르기 목록은 어디서든 프사 + 이름, 10-28 사용자) */
export const giveLabel = (o: RosterOrch) => o.label;

/** 마지막 고른 참모(보관함·@ 메뉴·넘기기가 같이 쓴다) */
export const PICK_KEY = 'chammo.orchPick.last.v1';
/** 고르기 순서 — 마지막 고른 참모가 맨 위 */
export function pickOrder(list: RosterOrch[], last: string | null): RosterOrch[] {
  const hit = list.find((o) => o.id === last);
  return hit ? [hit, ...list.filter((o) => o !== hit)] : list;
}

/** 팀 대화 입력칸에 놓은 팀 보관함 파일 — 팀 전체 파일·같은 방 대화 파일은 그 파일을 가리키는 첨부(다시 안 올림),
 *  다른 방 대화 파일은 이 방 사람이 못 열 수 있어 다시 봉해 올린다(reupload = 풀어서 이 방에 올릴 id). 방 없는 새 DM 은 둘 다 빈 것 */
export function splitTeamDrop(items: { id: string; name: string; size: number; room: string }[], room: string, team: string): { refs: TeamFile[]; reupload: string[] } {
  if (!room) return { refs: [], reupload: [] };
  const refs: TeamFile[] = [];
  const reupload: string[] = [];
  for (const i of items) {
    if (!i.room || i.room === room) refs.push({ id: i.id, name: i.name, size: i.size, team, room: i.room });
    else reupload.push(i.id);
  }
  return { refs, reupload };
}
