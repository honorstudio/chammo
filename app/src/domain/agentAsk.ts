// 세션 브라우저 '사람 필요'(browser_ask_human) — 크게 보기 모달을 누구에게 띄울지.
// 2026-10-04 QA: 다른 세션이 부르면 쓰던 모달이 말없이 그 브라우저로 바뀌어 치던 글(비밀번호일 수도)이 엉뚱한 데로 갔다 →
// 열린 모달은 안 바꾸고 새 부름은 줄에만(모달 머리에 표시), 바꾸는 건 사람이 눌러서. 줄 선 부름은 모달을 닫으면 띄운다
import type { Live } from './agentBrowser';

/** 지금 크게 보기에 띄운 브라우저 — 프로필만으론 모자라다(세션이 끝나고 다른 세션 브라우저가 같은 프로필을 잡으면 입력이 그쪽으로 간다) */
export type AskOpen = { profile: string; pid: number; sessionPid: number; /** 사람이 눌러 열었나 — 저절로 뜬 모달은 글칸 포커스를 안 가져간다(치던 채팅 글이 브라우저로 안 가게) */ byHuman: boolean };
/** seen = 이미 알린 부름, queue = 모달이 열려 있어서 아직 한 번도 못 띄운 부름(먼저 부른 순) */
export type AskState = { open: AskOpen | null; seen: string[]; queue: string[]; miss: number };
export const ASK_EMPTY: AskState = { open: null, seen: [], queue: [], miss: 0 };

const keyOf = (l: Live) => `${l.profile}:${l.pid}:${l.ask?.at ?? 0}`;
const isOpen = (o: AskOpen | null, l: Live) => !!o && o.profile === l.profile && o.pid === l.pid && o.sessionPid === l.sessionPid;
const openOf = (l: Live, byHuman: boolean): AskOpen => ({ profile: l.profile, pid: l.pid, sessionPid: l.sessionPid, byHuman });
const byAt = (a: Live, b: Live) => (a.ask?.at ?? 0) - (b.ask?.at ?? 0);

/** 줄에서 아직 사람을 기다리는 것만 남기고, 모달이 비었으면 맨 앞을 띄운다 */
function serve(open: AskOpen | null, queue: string[], lives: Live[]): Pick<AskState, 'open' | 'queue'> {
  const waiting = (k: string) => lives.find((l) => l.ask && keyOf(l) === k);
  // 그 브라우저가 목록에 있는데 부름이 다르면(풀림·새 부름·새 래퍼) 뺀다 — 목록에서 잠깐 빠진 건(상태 파일 깜빡) 남긴다
  const gone = (k: string) => lives.some((l) => k.startsWith(`${l.profile}:`) && keyOf(l) !== k);
  let q = queue.filter((k) => !gone(k) && !lives.some((l) => isOpen(open, l) && keyOf(l) === k));
  const next = open ? -1 : q.findIndex((k) => waiting(k));
  if (next >= 0) {
    open = openOf(waiting(q[next]!)!, false);
    q = q.filter((_, i) => i !== next);
  }
  return { open, queue: q };
}

/** 래퍼 상태가 바뀔 때마다 — 새 부름은 알리고(notify), 모달이 비었으면 먼저 부른 것을 띄우고 나머지는 줄에 */
export function askStep(s: AskState, lives: Live[]): { state: AskState; notify: Live[] } {
  // 그 브라우저가 다른 래퍼 것이 됐으면 바로, 목록에서 빠졌으면 두 번 연속일 때 닫는다(상태 파일 한 번 깜빡에 치던 모달이 사라지지 않게)
  const here = !!s.open && lives.some((l) => isOpen(s.open, l));
  const taken = !!s.open && lives.some((l) => l.profile === s.open!.profile && !isOpen(s.open, l));
  const miss = here || !s.open ? 0 : s.miss + 1;
  const open = s.open && !taken && miss < 2 ? s.open : null;
  const fresh = lives.filter((l) => l.ask && !s.seen.includes(keyOf(l))).sort(byAt);
  const queue = [...s.queue, ...fresh.filter((l) => !isOpen(open, l)).map(keyOf)];
  return { state: { seen: [...s.seen, ...fresh.map(keyOf)], miss: open ? miss : 0, ...serve(open, queue, lives) }, notify: fresh };
}

/** 사람이 눌러 연다(칸의 크게 보기·사람 필요, 모달 머리의 줄 선 부름) */
export const askOpen = (s: AskState, l: Live): AskState => ({ ...s, miss: 0, open: openOf(l, true), queue: s.queue.filter((k) => !k.startsWith(`${l.profile}:${l.pid}:`)) });
/** 닫기 — 줄 선 부름이 있으면 그걸 띄운다. who 를 주면 그 브라우저가 열려 있을 때만(같은 닫기가 키·메뉴 두 갈래로 와도 다음 모달까지 안 닫게) */
export const askClose = (s: AskState, lives: Live[], who?: { profile: string; pid: number }): AskState =>
  who && !(s.open?.profile === who.profile && s.open.pid === who.pid) ? s : { ...s, miss: 0, ...serve(null, s.queue, lives) };
/** 모달이 그리는 브라우저 — 같은 프로필이어도 다른 세션 브라우저면 없음, 목록에서 잠깐 빠졌으면 없음(그동안 화면은 마지막 것을 붙든다) */
export const openLive = (s: AskState, lives: Live[]): Live | undefined => lives.find((l) => isOpen(s.open, l));
/** 모달 말고 사람을 기다리는 다른 브라우저들(먼저 부른 순) — 모달 머리에 줄로 */
export const askWaiting = (s: AskState, lives: Live[]): Live[] => lives.filter((l) => l.ask && !isOpen(s.open, l)).sort(byAt);
