// 세션 브라우저 독(2026-10-27 인앱 브라우저 시안 A) — 스페이스 탭 줄에 그 참모가 맡은 세션들의 브라우저가 아이콘 하나씩(Craft 독처럼, 세션 글자 배지).
// 누르면 스페이스 칸 전체가 그 브라우저(b:<프로필>), 칸을 닫아도(숨김) 아이콘은 남는다 — 브라우저를 끄는 건 참모·세션
import { josa, tr } from '../i18n';
import { takeoverLine, type Live } from './agentBrowser';

export type BrowserDot = 'ask' | 'human' | 'agent' | '';
/** who = 세션이 안 쥔 HQ 브라우저(hqBrowserHome) — 사람이 서랍에서 연 것(me)·주인 모름(unknown). 보는 참모 이름을 달지 않는다 */
export type HqWho = 'me' | 'unknown';
export type BrowserDockItem = { profile: string; pid: number; name: string; letter: string; page: string; dot: BrowserDot; live: Live; who?: HqWho };

const hostOf = (u: string) => { try { return new URL(u).host; } catch { return ''; } };

/** 세션 첫 글자(영문은 대문자) — 아이콘 배지 */
const letterOf = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

const dotOf = (l: Live): BrowserDot => (l.ask ? 'ask' : l.takeover ? 'human' : l.busy ? 'agent' : '');

/** 이 참모 독 — 참모 자기 브라우저가 맨 앞, 그다음 맡긴 세션(held 순서). 브라우저 없는 세션은 빼고, 같은 프로필은 한 칸 */
export function browserDock(own: { name: string; live?: Live; who?: HqWho }, held: { name: string; live?: Live }[]): BrowserDockItem[] {
  const out: BrowserDockItem[] = [];
  for (const s of [own, ...held]) {
    const l = s.live;
    if (!l || out.some((x) => x.profile === l.profile)) continue;
    const who = s === own ? own.who : undefined;
    out.push({ profile: l.profile, pid: l.pid, name: who ? tr('참모', 'Chammo') : s.name, letter: who === 'me' ? tr('나', 'M') : who ? '?' : letterOf(s.name), page: l.title || hostOf(l.url), dot: dotOf(l), live: l, ...(who ? { who } : {}) });
  }
  return out;
}

const dotWord = (d: BrowserDot) => (d === 'ask' ? tr('사람 필요', 'Needs you') : d === 'human' ? tr('직접 조작 중', 'You have control') : d === 'agent' ? tr('세션이 쓰는 중', 'Session is using it') : '');

/** 아이콘 이름표(title·aria) — 아이콘만 그리니 읽을 것은 여기 */
export const dockTitleOf = (it: BrowserDockItem) =>
  [it.who === 'me' ? tr('참모 브라우저 · 내가 연 것', 'Chammo browser · opened by you') : it.who ? tr('참모 브라우저 · 주인 모름', 'Chammo browser · owner unknown') : tr(`${it.name} 브라우저`, `${it.name} browser`), it.page, dotWord(it.dot)].filter(Boolean).join(' · ');

/** 스페이스 화면 키 */
export const browserKey = (profile: string) => `b:${profile}`;
export const browserOfPick = (pick: string) => (pick.startsWith('b:') ? pick.slice(2) : null);

/** 칸 더보기 차례 — 헤드리스면 '크롬에서 보기'(창이 없다) 대신 회색 안내 한 줄. 끄기는 늘 맨 안쪽(사람용 하나, 보통은 참모·세션이 끈다) */
export type PaneMenuKey = 'chrome' | 'headless' | 'desk' | 'unshow' | 'signed' | 'unsigned' | 'copy' | 'close';
/** win = 윈도우 숨은 데스크톱 상태(agent_tabs desk·shown) — 숨은 화면이면 회색 안내 + '보이는 창으로 열기', 꺼냈으면 '숨은 화면으로 돌려놓기' */
export type DeskState = { desk: boolean; shown: boolean };
/** mac = 패스키 탈출구(agent_tabs signable·signed, 2026-10-28) — ad-hoc 사본엔 맥 패스키가 없어 '이번만 구글 크롬으로 열기', 바꿔 뒀으면 '참모 브라우저로 돌아가기' */
export type SignedState = { signable: boolean; signed: boolean; auto?: boolean };
export function paneMenuKeys(headless: boolean, hasUrl: boolean, win?: DeskState, mac?: SignedState): PaneMenuKey[] {
  const first: PaneMenuKey[] = headless ? ['headless'] : win?.shown ? ['unshow'] : win?.desk ? ['desk', 'chrome'] : ['chrome'];
  const signed: PaneMenuKey[] = headless || !mac ? [] : mac.signed ? ['unsigned'] : mac.signable ? ['signed'] : [];
  return [...first, ...signed, ...(hasUrl ? (['copy'] as const) : []), 'close'];
}

/** 사람 차례 카드에 '보이는 창에서 열기'를 둘까 — 윈도우 숨은 데스크톱에서 세션이 부른 때만(패스키·Windows Hello·OS 파일 창은 숨은 화면에선 사람이 못 본다) */
export function deskOffer(card: TurnCard | null, win?: DeskState): boolean {
  return !!card && card.kind === 'ask' && !!win?.desk && !win.shown;
}

/** 그 브라우저를 독에 둔 참모 — 사람 부름·'크게 보기'를 그 참모 스페이스 칸으로 연다. 없으면 null(모달로 물러남) */
export function browserOwner(profile: string, rows: { id: string; own?: Live; held: (Live | undefined)[] }[]): string | null {
  return rows.find((r) => [r.own, ...r.held].some((l) => l?.profile === profile))?.id ?? null;
}

/** HQ 참모들은 같은 폴더라 브라우저 프로필 하나를 나눠 쓴다 — 그 브라우저 아이콘은 쥔 세션 기준 한 곳에만(2026-10-29 사용자 "모든 참모가 쓰는 것처럼 보여"):
 *  쥔 세션(sessionPid)이 어느 참모 자신·맡긴 세션이면 그 참모 독이 이미 그린다(null). 세션이 안 쥔 것(sessionPid 0)은 사람이 서랍 '참모 브라우저'로 연 것(앱 지킴이) —
 *  누른 참모(opener) 독에 '내가 연 것', 누른 참모를 모르면(앱 다시 켬·그 참모 꺼짐) 첫 참모 한 곳. 모르는 세션이 쥔 것은 첫 참모 한 곳에 '주인 모름' */
export function hqBrowserHome(live: Live | undefined, rows: { id: string; own?: Live; held: (Live | undefined)[] }[], opener?: string): { id: string; who: HqWho } | null {
  if (!live || !rows.length || browserOwner(live.profile, rows)) return null;
  if (live.sessionPid > 0) return { id: rows[0]!.id, who: 'unknown' };
  return { id: opener && rows.some((r) => r.id === opener) ? opener : rows[0]!.id, who: 'me' };
}

/** 사람 부르기 카드를 눌렀을 때 스페이스가 갈 참모 — 카드가 놓인 참모(hint)가 먼저(누른 채팅의 참모, 카드를 받는 규칙 forwardTo 와 독 규칙 holderMap 이 갈려도 안 놓친다),
 *  없으면 그 브라우저를 독에 둔 참모. 둘 다 없으면 null = 모달로 물러남. hint 참모가 이미 꺼졌으면(rows 에 없음) 무시 */
export function paneTarget(profile: string, rows: { id: string; own?: Live; held: (Live | undefined)[] }[], hint?: string): string | null {
  return (hint && rows.some((r) => r.id === hint) ? hint : null) ?? browserOwner(profile, rows);
}

/** 사람 차례 카드(시안 A) — 칸 아래 작은 카드 하나. 페이지 대화상자(페이지가 굳음) > 세션 부름 > 파일 고르기 > 크롬 자체 창(패스키·권한) */
export type TurnCard = { kind: 'dialog'; text: string; prompt: boolean } | { kind: 'ask' | 'file' | 'passkey' | 'window'; text: string };
export function turnCard(l: Live, t: { dialog: { type: string; message: string } | null; chooser: string | null }, mac?: SignedState): TurnCard | null {
  if (t.dialog) return { kind: 'dialog', text: t.dialog.message || tr('페이지가 확인을 기다려', 'The page is waiting for you'), prompt: t.dialog.type === 'prompt' };
  if (l.ask) return { kind: 'ask', text: l.ask.reason ?? '' };
  if (t.chooser) return { kind: 'file', text: tr('올릴 파일을 골라 줘 — 앱 창에 붙은 창에서', 'Pick the file to upload — in the sheet on the app window') };
  // 래퍼가 패스키 때문에 바꾼 동안(auto)은 크롬 창이 뜨면 패스키다 — 창 이름('문제가 발생했습니다' 등)으로는 못 가를 때가 있다(10-30 실측)
  if (l.popup && (l.popupKind === 'passkey' || signedAutoPeek(mac)) && (mac?.signed || (mac && !mac.signable))) {
    // 구글 서명 크롬(재서명 사본에서 바꿔 둔 동안, 또는 끄는 스위치 CHAMMO_BROWSER_ACCESSORY=0 의 서명 사본 — signable 아님) — 맥 암호 앱 패스키가 된다(2026-10-29 실측 uvpa=true).
    // 재서명 사본은 래퍼·서랍 지킴이 둘 다 signable 을 적는다(10-29 fix/dock-hide-back — 지킴이가 안 적어 서랍 사본이 'Touch ID 됨'으로 틀렸다). 패스키 창은 칸 그림 밖이라 크롬 창을 꺼내서
    // 래퍼가 패스키 때문에 바꾼 동안(auto)은 칸이 크롬 창을 저절로 꺼낸다(signedAutoPeek) — 띠는 어디서 하는지만
    return { kind: 'passkey', text: mac?.auto ? tr('패스키 — 크롬 창에서 Touch ID', 'Passkey — use Touch ID in the Chrome window') : tr('패스키 — 크롬 창을 꺼내 Touch ID 나 암호 앱으로 해 줘', 'Passkey — open the Chrome window and use Touch ID or Passwords') };
  }
  if (l.popup && l.popupKind === 'passkey') {
    // Dock 숨기기 재서명 사본(기본)은 맥 '암호' 앱 패스키를 못 쓴다 — 보통은 래퍼·지킴이가 구글 크롬으로 저절로 바꾸고, 못 바꿀 때(같이 쓰는 손님) 크롬 창을 꺼내 휴대폰 QR·보안 키로
    return { kind: 'passkey', text: tr('패스키는 크롬 창을 열어 휴대폰 QR이나 보안 키로 해 줘. 맥 암호 앱 패스키는 이 크롬에서 안 돼', 'Passkey: open the Chrome window and use your phone (QR) or a security key. Mac Passwords passkeys don’t work in this Chrome') };
  }
  if (l.popup) return { kind: 'window', text: tr('크롬이 자기 창을 띄웠어 — 꺼내서 봐 줘', 'Chrome opened its own window — open it to answer') };
  return null;
}

/** 칸이 크롬 자체 창(Touch ID 시트)을 저절로 꺼낼까 — 래퍼가 패스키 때문에 구글 크롬으로 바꾼 동안만(2026-10-30 사용자: 시트가 숨은 크롬 창에 붙어 안 보였다).
 *  모달은 사람이 만지는 중일 때 꺼내지만(peekStep active) 이때는 패스키 말고 할 일이 없어 바로. 사람이 고른 구글 크롬은 단추로 */
export function signedAutoPeek(mac?: SignedState): boolean {
  return !!mac?.signed && !!mac.auto;
}

/** 구글 크롬으로 바꿔 둔 동안 칸 한 줄(2026-10-29 패스키 자동) — 래퍼가 패스키를 보고 스스로 바꿨으면(auto) 까닭을, 사람이 고른 것이면 지금 상태를. 옆에 돌아오기 단추 */
export function signedLine(mac?: SignedState): string | null {
  if (!mac?.signed) return null;
  return mac.auto
    ? tr('패스키 때문에 크롬 창에서 열었어 — 끝나면 저절로 돌아와', 'Opened in a Chrome window for the passkey — it comes back on its own when done')
    : tr('구글 크롬으로 열어 뒀어', 'Opened in Google Chrome');
}

/** '다 했어'를 누른 부름(at)의 카드는 래퍼가 .done 을 치우기 전에 바로 걷는다 — 칸 반응이 1~2초 늦어 여러 번 눌렀다(10-28 사용자). 새 부름(at 다름)은 다시 보인다 */
export function turnCardAfterDone(card: TurnCard | null, askAt: number | undefined, sentAt: number | null): TurnCard | null {
  return card?.kind === 'ask' && sentAt != null && askAt === sentAt ? null : card;
}

/** 칸 아래 상태줄(2026-10-28) — 차례 표시는 띠 하나: 세션이 부른 동안엔 띠가 말하니 비우고, 사람이 쥐었으면 누가 쥐었나 + 늘 보이는 돌려주기, 아니면 세션이 하는 일 */
export function paneStatus(l: Live): { text: string; giveBack: boolean } {
  if (l.ask) return { text: '', giveBack: false };
  const taking = takeoverLine(l);
  return taking ? { text: taking, giveBack: true } : { text: l.tool, giveBack: false };
}

/** 탭 X 를 누르면 — 탭이 둘 넘으면 그 탭만, 마지막 탭이면 브라우저 끄기(크롬처럼). 세션이 쓰는 브라우저는 한 줄 확인, 사람 혼자 쓰는 참모 브라우저(세션 없음)는 바로 */
export function closeWay(l: Live, tabs: number): 'tab' | 'confirm' | 'close' {
  if (tabs > 1) return 'tab';
  return l.sessionPid > 0 ? 'confirm' : 'close';
}

/** 독 X = 브라우저 자체 끄기 전 앱 확인 창(10-28 사용자 "진짜 닫을 거냐고") — 세션·참모(래퍼의 sessionPid)나 같이 쓰는 스크립트가 쥐고 있으면 누가 쓰는지와 끊긴다는 말, 사람이 연 거면 닫을지만 */
export function closeAsk(it: { name: string; live: Live }): { title: string; body?: string } {
  if (it.live.sessionPid > 0 || (it.live.scripts ?? 0) > 0) {
    // 영문·숫자로 끝나는 이름(shop-app·참모-2)은 읽는 소리를 몰라 '이(가)'
    const who = /[가-힣]$/.test(it.name) ? josa(it.name, '이', '가') : `${it.name}이(가)`;
    return { title: tr(`${who} 사용 중이에요`, `${it.name} is using this browser`), body: tr('닫으면 하던 브라우저 일이 끊겨요', 'Closing it cuts off the browser work in progress') };
  }
  return { title: tr('브라우저를 닫을까요?', 'Close the browser?') };
}

/** 사람이 끈 브라우저(프로필 → 그때 크롬 pid) — 래퍼가 알아채기 전에도 탭 줄에서 뺀다. 세션이 다시 띄우면(pid 바뀜) 다시 보인다 */
export const stillClosed = (closed: Record<string, number>, l: Live) => closed[l.profile] === l.pid;

/** 보던 브라우저 칸이 사라졌나 — 보는 동안 한 번이라도 있었는데 지금 없다(처음부터 없던 건 목록을 아직 못 읽은 것) */
export const wentAway = (seen: boolean, present: boolean) => seen && !present;
