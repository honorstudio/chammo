import { tr } from '../i18n';
// 팀 프로필(내 이름·사진·상태·상태 글, 팀 아이콘) — 화면 판단. 저장 길은 Rust team_profile(팀 보관함 암호 길, 서버엔 평문 없음)

export type Status = 'free' | 'away' | 'dnd';
export type Shown = { name: string; status: string; note: string; photo: string; at: number };
export type ProfileBoard = { team: string; rev: number; people: Record<string, Shown>; teamIcon: string };
/** 화면에 그릴 한 사람 — status '' = 아직 프로필 없음 */
export type Look = { name: string; photo: string; status: Status | ''; note: string };

export const STATUSES: Status[] = ['free', 'away', 'dnd'];
export const NOTE_MAX = 40;
export const NAME_MAX = 30;

const asStatus = (s: string): Status | '' => (STATUSES.includes(s as Status) ? (s as Status) : '');

export function lookOf(board: ProfileBoard | null, member: string, rosterName: string): Look {
  const p = board?.people[member];
  if (!p) return { name: rosterName, photo: '', status: '', note: '' };
  return { name: p.name || rosterName, photo: p.photo, status: asStatus(p.status), note: p.note };
}

/** 대화 목록·DM 머리에 쓸 이름 — 사람 대화는 프로필 이름(없으면 명부 이름), 단톡방은 방 이름 그대로. 판을 아직 못 읽었으면 그대로 */
export function namedConvos<T extends { peer: string; name: string; kind?: string }>(cs: T[], board: ProfileBoard | null): T[] {
  if (!board) return cs;
  return cs.map((c) => (c.kind === 'group' || !c.peer ? c : { ...c, name: lookOf(board, c.peer, c.name).name }));
}

/** 폰 판 받기(/api/team-profiles·team-posts ?rev=본 판) — {same} 이면 아는 판 그대로, 다른 팀 판(팀을 바꾼 사이 늦게 온 답)은 버린다 */
export function keepBoard<B extends { team: string }>(prev: B | null, got: B | { same: true }, team?: string): B | null {
  if ('same' in got) return prev;
  if (team !== undefined && got.team !== team) return prev;
  return got;
}

export const statusName =(s: Status) => (s === 'free' ? tr('대화 가능', 'Available') : s === 'away' ? tr('자리 비움', 'Away') : tr('방해 금지', 'Do not disturb'));

/** 이름 아래 한 줄 — '자리 비움 · 점심 다녀올게요' */
export const statusLine = (l: Look) => (l.status ? [statusName(l.status), l.note].filter(Boolean).join(' · ') : '');

/** 방해 금지인 사람에게 보낼 때 입력칸 위 한 줄 */
export const dndNotice = (l: Look) => (l.status === 'dnd' ? tr(`${l.name} 님은 방해 금지예요 — 보내면 알림 없이 쌓여요`, `${l.name} is on do-not-disturb — messages arrive without a notification`) : null);

type Size = { w: number; h: number };
type Pt = { x: number; y: number };

/** -0 을 0 으로(그리기엔 같지만 비교·글로 찍을 때 헷갈린다) */
const z = (n: number) => n + 0 || 0;
/** 그림을 칸(view×view)에 덮게 놓았을 때의 배율 — 짧은 변이 칸을 채우는 게 확대 1 */
const scaleOf = (img: Size, view: number, zoom: number) => (view / Math.min(img.w, img.h)) * zoom;

/** 옮긴 만큼(화면 px) — 그림이 칸 밖으로 빠지지 않게 */
export function clampOffset(img: Size, view: number, zoom: number, o: Pt): Pt {
  const s = scaleOf(img, view, zoom);
  const mx = Math.max(0, (img.w * s - view) / 2);
  const my = Math.max(0, (img.h * s - view) / 2);
  return { x: z(Math.min(mx, Math.max(-mx, o.x))), y: z(Math.min(my, Math.max(-my, o.y))) };
}

/** 칸 안에 보이는 원본 자리 — canvas drawImage(sx, sy, sw, sh) */
export function cropRect(img: Size, view: number, zoom: number, o: Pt) {
  const s = scaleOf(img, view, zoom);
  const c = clampOffset(img, view, zoom, o);
  const left = (view - img.w * s) / 2 + c.x;
  const top = (view - img.h * s) / 2 + c.y;
  return { sx: z(-left / s), sy: z(-top / s), sw: view / s, sh: view / s };
}
