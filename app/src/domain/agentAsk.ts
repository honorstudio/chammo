// 세션 브라우저 '사람 필요'(browser_ask_human) — 크게 보기 모달을 누구에게 띄울지.
// 2026-10-04 QA: 다른 세션이 부르면 쓰던 모달이 말없이 그 브라우저로 바뀌어 치던 글(비밀번호일 수도)이 엉뚱한 데로 갔다 →
// 열린 모달은 안 바꾸고 새 부름은 줄에만(모달 머리에 표시), 바꾸는 건 사람이 눌러서. 줄 선 부름은 모달을 닫으면 띄운다
import { tr } from '../i18n';
import type { Live } from './agentBrowser';

/** 사람 부름 알림 글 — 제목에 부른 세션 이름(예전엔 '세션이 사람을 불러요'뿐이라 어느 세션인지 몰랐다), 본문은 이유 */
export function askNotice(name: string, reason: string): { title: string; body: string } {
  const n = name.trim();
  return {
    title: n ? tr(`${n} 세션이 사람을 불러요`, `${n} needs you`) : tr('세션이 사람을 불러요', 'A session needs you'),
    body: reason || tr('브라우저에서 직접 해 줄 일이 있어요', 'Something to do in the browser'),
  };
}

/** 지금 크게 보기에 띄운 브라우저 — 프로필만으론 모자라다(세션이 끝나고 다른 세션 브라우저가 같은 프로필을 잡으면 입력이 그쪽으로 간다) */
export type AskOpen = { profile: string; pid: number; sessionPid: number; /** 사람이 눌러 열었나 — 저절로 뜬 모달은 글칸 포커스를 안 가져간다(치던 채팅 글이 브라우저로 안 가게) */ byHuman: boolean };
/** seen = 이미 알린 부름, queue = 모달이 열려 있어서 아직 한 번도 못 띄운 부름(먼저 부른 순) */
export type AskState = { open: AskOpen | null; seen: string[]; queue: string[] };
export const ASK_EMPTY: AskState = { open: null, seen: [], queue: [] };

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
  // 그 브라우저가 다른 래퍼 것이 됐으면 바로 닫는다. 목록에서 빠진 건 저절로 닫지 않는다 — 모달이 '닫혔어' 덮개를 그리고 사람이 닫는다
  // (예전 '두 번 연속 빠지면 닫기'는 lives 가 바뀔 때만 돌아서, 빈 채 그대로면 두 번째가 영영 안 와 마지막 화면이 사진처럼 남았다 — 2026-10-05)
  const taken = !!s.open && lives.some((l) => l.profile === s.open!.profile && !isOpen(s.open, l));
  let open = s.open && !taken ? s.open : null;
  const fresh = lives.filter((l) => l.ask && !s.seen.includes(keyOf(l))).sort(byAt);
  const queue = [...s.queue, ...fresh.filter((l) => !isOpen(open, l)).map(keyOf)];
  // 닫힌(목록에 없는) 모달이 다른 세션 부름을 막지 않게 — 그 브라우저는 입력을 막고 있고 새 모달은 저절로 떠 글칸 포커스를 안 가져가니
  // 치던 글이 새 브라우저로 갈 일이 없다(리뷰: 예전 miss 규칙이 하던 일)
  if (open && !lives.some((l) => isOpen(open, l)) && queue.some((k) => lives.some((l) => l.ask && keyOf(l) === k))) open = null;
  return { state: { seen: [...s.seen, ...fresh.map(keyOf)], ...serve(open, queue, lives) }, notify: fresh };
}

/** 사람이 눌러 연다(칸의 크게 보기·사람 필요, 모달 머리의 줄 선 부름) */
export const askOpen = (s: AskState, l: Live): AskState => ({ ...s, open: openOf(l, true), queue: s.queue.filter((k) => !k.startsWith(`${l.profile}:${l.pid}:`)) });
/** 닫기 — 줄 선 부름이 있으면 그걸 띄운다. who 를 주면 그 브라우저가 열려 있을 때만(같은 닫기가 키·메뉴 두 갈래로 와도 다음 모달까지 안 닫게) */
export const askClose = (s: AskState, lives: Live[], who?: { profile: string; pid: number }): AskState =>
  who && !(s.open?.profile === who.profile && s.open.pid === who.pid) ? s : { ...s, ...serve(null, s.queue, lives) };
/** 모달이 그리는 브라우저 — 같은 프로필이어도 다른 세션 브라우저면 없음, 목록에서 잠깐 빠졌으면 없음(그동안 화면은 마지막 것을 붙든다) */
/** 크게 보기로 열 브라우저 — 프로필 + 래퍼 번호(칸·사람 필요 단추가 넘김). 같은 프로필을 래퍼 둘이 쥘 수 있어 프로필만으론 엉뚱한 것이 열렸다.
 *  번호가 없거나(결정 카드) 그 래퍼가 그새 바뀌었으면 프로필로 */
export const pickLive = (lives: Live[], profile: string, pid?: number): Live | undefined =>
  (pid != null ? lives.find((l) => l.profile === profile && l.pid === pid) : undefined) ?? lives.find((l) => l.profile === profile);

export const openLive = (s: AskState, lives: Live[]): Live | undefined => lives.find((l) => isOpen(s.open, l));
/** 모달 말고 사람을 기다리는 다른 브라우저들(먼저 부른 순) — 모달 머리에 줄로 */
export const askWaiting = (s: AskState, lives: Live[]): Live[] => lives.filter((l) => l.ask && !isOpen(s.open, l)).sort(byAt);

/**
 * 모달이 그릴 브라우저 — 목록에 있으면 그것, 목록에서 빠졌으면 마지막으로 본 같은 브라우저(last)를 붙들고 gone.
 * gone 이면 모달은 마지막 화면을 흐리게 + '닫혔어' 덮개(사진을 진짜 화면으로 안 보게), 입력·'다 했어'는 막는다
 */
export function askShown(s: AskState, lives: Live[], last: Live | undefined): { live: Live | undefined; gone: boolean } {
  const found = openLive(s, lives);
  if (found) return { live: found, gone: false };
  const held = s.open && last && isOpen(s.open, last) ? last : undefined;
  return { live: held, gone: !!held };
}

/**
 * 패스키·Touch ID·QR 창(Live.popup) — 모달로 보고 있는 브라우저는 모달이 맡고(사람이 쓰는 중이면 작게 꺼냄), 나머지는 결정 대기함 카드.
 * 알림은 창이 새로 뜰 때 한 번(prev = 지난번 창이 떠 있던 브라우저들 — 모달을 열었다 닫아도 같은 창이면 다시 안 알린다)
 */
export function popupStep(prev: string[], lives: Live[], open: AskOpen | null): { keys: string[]; cards: Live[]; notify: Live[] } {
  const up = lives.filter((l) => l.popup);
  const key = (l: Live) => `${l.profile}:${l.pid}`;
  const cards = up.filter((l) => !isOpen(open, l));
  return { keys: up.map(key), cards, notify: cards.filter((l) => !prev.includes(key(l))) };
}

/** 패스키 창 알림 글 */
export function popupNotice(name: string): { title: string; body: string } {
  const n = name.trim();
  return {
    title: n ? tr(`${n} 세션에 패스키 창이 떴어요`, `${n} is showing a passkey window`) : tr('세션 브라우저에 패스키 창이 떴어요', 'A session browser is showing a passkey window'),
    body: tr('결정 대기함에서 크롬에서 보기를 누르면 그 창이 앞으로 나와요', 'Open it from Decisions to bring the Chrome window forward'),
  };
}
