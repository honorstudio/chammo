// 읽음(카톡처럼) — 방마다 사람(멤버 = 계정)별 '어디까지 읽었나' seq. 원본은 중계 방(chammo-relay ADR 0012),
// Rust 가 소켓으로 받은 값을 feed.reads 로 준다. 같은 계정 기기끼리는 같은 멤버라 한 기기에서 읽으면 다른 기기 안 읽음도 사라진다
import type { TeamItem, TeamRoom } from './teamChat';

/** 방 → 멤버 → 읽은 seq (Rust team_reads) */
export type Reads = Record<string, Record<string, number>>;

/** 방 사람(멤버 id) — DM 은 나 + 상대, 단톡방은 서버 목록(나 포함), 내 기기끼리 방은 없음 */
export function roomPeople(r: Pick<TeamRoom, 'kind' | 'peer' | 'members'>, me: string): string[] {
  if (r.kind === 'dm') return [me, r.peer].filter(Boolean);
  if (r.kind === 'group') return r.members ?? [];
  return [];
}

/** 사람마다 읽은 자리 — 서버 값과 그 사람이 쓴 사람 말(보낸 사람은 거기까지 봤다 — 서버도 같은 규칙) 중 큰 것.
 *  mine = 이 기기에서 본 자리(서버 왕복 전에 바로 맞게) */
export function readersAt(reads: Reads | undefined, room: string, items: TeamItem[], mine?: { me: string; seen: number }): Record<string, number> {
  const at: Record<string, number> = { ...(reads?.[room] ?? {}) };
  const up = (m: string, s: number) => { if (m && s > (at[m] ?? 0)) at[m] = s; };
  for (const it of items) if (it.room === room && it.origin === 'human') up(it.member, it.seq);
  if (mine) up(mine.me, mine.seen);
  return at;
}

/** 말마다 안 읽은 사람 수(seq → 수) — 보낸 사람 빼고, 읽은 자리가 그 seq 앞인 방 사람. 0 은 안 넣는다(숫자 없음) */
export function unreadCounts(people: string[], at: Record<string, number>, lines: TeamItem[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const it of lines) {
    const n = people.filter((p) => p !== it.member && (at[p] ?? 0) < it.seq).length;
    if (n > 0) out.set(it.seq, n);
  }
  return out;
}

/** 내 읽음 = 이 기기 값(localStorage)과 서버의 내 값(다른 기기에서 읽은 것) — 방마다 큰 것. 바뀐 게 없으면 같은 객체 */
export function mergedRead(local: Record<string, number>, reads: Reads | undefined, rooms: Pick<TeamRoom, 'id' | 'me'>[]): Record<string, number> {
  if (!reads) return local;
  let out = local;
  for (const r of rooms) {
    const s = r.me ? reads[r.id]?.[r.me] ?? 0 : 0;
    if (s > (out[r.id] ?? 0)) out = { ...out, [r.id]: s };
  }
  return out;
}

/** 서버에 올릴 읽음 — 사람이 그 방을 보고 있을 때만(창 포커스·화면 보임 — 알림만 뜬 건 아니다), 방 끝 seq 가 서버의 내 자리보다 클 때만 */
export function pushRead(room: string, items: TeamItem[], at: Record<string, number>, me: string, viewing: boolean): number | null {
  if (!room || !viewing) return null;
  const top = Math.max(0, ...items.filter((x) => x.room === room).map((x) => x.seq));
  return top > (at[me] ?? 0) ? top : null;
}

/** 지금 사람이 이 창을 보고 있나 — 포커스 + 화면 보임 */
export const looking = (d: Pick<Document, 'hasFocus' | 'visibilityState'>) => d.visibilityState === 'visible' && d.hasFocus();
