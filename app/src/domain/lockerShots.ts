// 최근 스크린샷 — 입력칸 # 고르기·채팅 첨부 단추 맨 위에 몇 장 띄운다(Rust locker_link::recent_shots).
// 여기는 그 목록을 다른 후보 목록과 합치는 판단만(시험: lockerShots.test.ts). 화면 연결은 # 고르기가 머지된 뒤

import { tr } from '../i18n';

/** Rust locker_link::Shot — path 는 진짜 파일(홈 안), name 은 한글을 합쳐 쓴 이름, mtime 은 ms */
export type Shot = { path: string; name: string; mtime?: number | null };

/** 맨 위에 보일 최근 스크린샷 n장 + 나머지 — 같은 파일은 나머지에서 빼서 두 번 안 보이게 */
export function shotsFirst<T extends { path: string }>(shots: Shot[], rest: T[], n = 5): { shots: Shot[]; rest: T[] } {
  const top = shots.slice(0, Math.max(0, n));
  const taken = new Set(top.map((s) => s.path));
  return { shots: top, rest: rest.filter((r) => !taken.has(r.path)) };
}

/** 얼마 전 — 최근 스크린샷 줄에 붙이는 짧은 글(방금·n분 전·n시간 전·날짜) */
export function agoText(mtime: number | null | undefined, now: number): string {
  if (!mtime || mtime > now) return '';
  const m = Math.floor((now - mtime) / 60000);
  if (m < 1) return tr('방금', 'Just now');
  if (m < 60) return tr(`${m}분 전`, `${m} min ago`);
  const h = Math.floor(m / 60);
  if (h < 24) return tr(`${h}시간 전`, `${h} h ago`);
  const d = new Date(mtime);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const nfc = (t: string) => t.normalize('NFC');
/** 맥 파일 이름은 한글을 풀어 쓴 모양일 수 있어 합쳐 쓴 모양으로 맞춰 견준다 */
export const sameName = (a: string, b: string) => nfc(a) === nfc(b);

/** # 고르기 맨 위에 띄울 스크린샷 — 친 글자가 이름에 든 것만, 최신이 앞(Rust 가 이미 그 순서), 'n분 전' 붙여서 */
export function shotChoices(shots: Shot[], q: string, now: number, max = 4): { path: string; name: string; ago: string }[] {
  const k = nfc(q).toLowerCase();
  return shots
    .filter((x) => nfc(x.name).toLowerCase().includes(k))
    .slice(0, Math.max(0, max))
    .map((x) => ({ path: x.path, name: x.name, ago: agoText(x.mtime, now) }));
}
