// Chammo 계정은 폰·메신저를 처음 쓸 때 그 자리에서(2026-11-05 사용자, ADR 0027 — 10-24 '로그인 필수'를 바꿈). 로그인 전에도 참모·세션은 그대로 돈다.
// 이 문은 로그인한 기기의 다음 단계(4자리·첫 기기·다시 시작)와 '다시 로그인'을 눌렀을 때의 로그인 화면만 다룬다. 한 번 로그인하면 기기 열쇠(키체인)·team.json 으로 계속(만료 없음)
import { tr } from '../i18n';
export type Gate = 'none' | 'login' | 'waiting' | 'code' | 'start' | 'reset' | 'relogin' | 'recoverWait' | 'recoverReady' | 'checking';

/** step = Rust e2e_flow::self_step — need·failed 면 4자리 화면(건너뛰기 없음, chammo-relay ADR 0007 R7), start 면 '첫 기기로 시작'(R8, 나중에는 이번 실행만), reset 이면 '이 기기로 다시 시작'(허용해 줄 사슬 기기가 없음 — 계정 되찾기 갈래 ①), relogin 이면 '다시 로그인'(봉인 없이 대기 — 옛 판 로그인, 10-26 아이맥), outside 면 숫자 대기(허용됐지만 사슬 밖) */
export function gateState(v: { account: unknown; pending?: boolean } | null, o: { asked?: boolean; waitSeen?: boolean; step?: string; startLater?: boolean; resetLater?: boolean; reloginLater?: boolean; recoverLater?: boolean; checkingLater?: boolean }): Gate {
  if (!v) return 'none';
  // 로그인 전 — 막지 않는다. 사람이 '다시 로그인'을 눌렀을 때(asked)만 로그인 화면
  if (!v.account) return o.asked ? 'login' : 'none';
  if (o.step === 'need' || o.step === 'failed') return 'code';
  // 로그인 직후 확인 중(Rust checking) — 문이 잠깐 닫혀 팀 팝업이 드러났다(2026-11-01 ux-team H2). 계속 쓰기 = 이번 실행만(망이 막혀도 갇히지 않게)
  if (o.step === 'checking') return o.checkingLater ? 'none' : 'checking';
  // 이 기기가 낸 다시 시작 요청(계정 되찾기 갈래 ②) — 기다림 · 48시간 뒤 마치기. 나중에는 이번 실행만
  if (o.step === 'recover-wait') return o.recoverLater ? 'none' : 'recoverWait';
  if (o.step === 'recover-ready') return o.recoverLater ? 'none' : 'recoverReady';
  if (o.step === 'start' && !o.startLater) return 'start';
  if (o.step === 'reset' && !o.resetLater) return 'reset';
  // 나중에 = 이번 실행 동안 문 없음 — 숫자가 영영 안 뜨는 대기 화면으로 넘기지 않는다
  if (o.step === 'relogin') return o.reloginLater ? 'none' : 'relogin';
  // 허용됐지만 사슬 밖(outside) — 대기 기기와 같은 숫자 화면, 사슬 기기 어디서든 '내 기기 확인' 카드로(10-26)
  if ((v.pending || o.step === 'outside') && !o.waitSeen) return 'waiting';
  return 'none';
}

/** 상태를 다시 물을 때 — 아직 못 읽음·허용 대기·단계가 있을 때(checking 포함 — ensure 가 끝나 단계가 정해질 때까지). 로그인 전은 가끔만(11-05 — 문이 안 막으니 3초마다 볼 까닭이 없고, 앱 안 로그인은 TEAM_LOGGED_IN 으로 바로 안다) */
/** fresh = 계정이 있는 상태에서 단계를 읽었나 — 로그인 직후엔 로그인 전에 읽은 빈 단계라 한 번 더 읽어야 한다(10-26 아이맥: 다시 시작 화면이 안 떴다) */
export function watchGate(v: { pending?: boolean; account?: unknown } | null, step: string, fresh = true): boolean {
  return !v || (!!v.account && (!!v.pending || step !== '' || !fresh));
}

/** 상태를 다시 읽는 간격 — 지켜볼 때 3초, 아닐 때도 1분(서버가 이 기기를 지우거나 끊으면 Rust 가 relogin 으로 적는다, 10-28 윈도우). 둘 다 로컬 파일 읽기 */
export const lookEvery = (watching: boolean) => (watching ? 3_000 : 60_000);

/** Rust 로그인 오류 맨 앞 이름(team_relay TAG_OFFLINE·TAG_ALREADY·clock_err) — 판단은 이것으로만.
 *  예전엔 한국어 문구를 정규식으로 봐서 번역·다듬기 한 번에 조용히 깨질 판이었다(11-01 QA). min = 시계 차이(분, 이 기기가 빠르면 +) */
export type GateErr = { kind: 'offline' | 'clock' | 'already' | 'other'; min: number; rest: string };
export function gateErr(raw: string): GateErr {
  const m = /^\[(offline|already|clock:(-?\d+))\]\s*/.exec(raw);
  if (!m) return { kind: 'other', min: 0, rest: raw };
  const rest = raw.slice(m[0].length);
  if (m[2] !== undefined) return { kind: 'clock', min: Number(m[2]), rest };
  return { kind: m[1] as 'offline' | 'already', min: 0, rest };
}

/** 로그인이 '이미 로그인돼 있어요'로 막혔다 — 밖에서 먼저 로그인한 것. 오류 대신 상태를 다시 읽어 화면을 닫는다(QA 7) */
export const alreadyIn = (e: string) => gateErr(e).kind === 'already';

/** 시계 차이(분) → 사람이 읽는 시간 */
export function skewTime(min: number): string {
  const a = Math.abs(min), h = Math.floor(a / 60), m = a % 60;
  if (!h) return tr(`${m}분`, `${m} minute${m === 1 ? '' : 's'}`);
  return tr(`${h}시간${m ? ` ${m}분` : ''}`, `${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} minute${m === 1 ? '' : 's'}` : ''}`);
}

const fill = (t: string, min: number) => t.replace('{time}', skewTime(min)).replace('{dir}', min > 0 ? tr('빠르게', 'ahead') : tr('느리게', 'behind'));

/** 시계가 틀려 로그인이 막힌 게이트 화면 — 맥·윈도우 메뉴 길이 다르다 */
export function clockText(min: number, win: boolean): { title: string; body: string } {
  const body = win
    ? tr("이 컴퓨터 시계가 {time} {dir} 맞춰져 있어서 Chammo 계정에 로그인할 수 없어요. 설정 > 시간 및 언어 > 날짜 및 시간에서 '자동으로 시간 설정'을 켜고 '지금 동기화'를 누른 뒤 다시 시도해 주세요.",
      'Your computer\'s clock is set {time} {dir}, so Chammo can\'t sign you in. Open Settings > Time & language > Date & time, turn on "Set time automatically", select "Sync now", then try again.')
    : tr("이 컴퓨터 시계가 {time} {dir} 맞춰져 있어서 Chammo 계정에 로그인할 수 없어요. 시스템 설정 > 일반 > 날짜 및 시간에서 '자동으로 날짜 및 시간 설정'을 켜고 다시 시도해 주세요.",
      'Your computer\'s clock is set {time} {dir}, so Chammo can\'t sign you in. Open System Settings > General > Date & Time, turn on "Set time and date automatically", then try again.');
  return { title: tr('컴퓨터 시계가 실제 시간과 달라요', "Your computer's clock is off"), body: fill(body, min) };
}

/** 로그인·로그아웃 실패 한 줄 — 시계는 사람 말, 이름표는 떼고, 그 밖은 원문 그대로(전체 번역은 docs/plans/2026-11-01-error-names.md) */
export function gateErrText(raw: string): string {
  const g = gateErr(raw);
  if (g.kind === 'clock') return fill(tr('시계가 {time} {dir} 맞춰져 있어서 로그인할 수 없어요. 시간 자동 맞추기를 켜고 다시 시도해 주세요.', 'Your clock is {time} {dir}, so sign-in failed. Turn on automatic time setting and try again.'), g.min);
  return g.rest;
}

/** 첫 기기 질문에서 '나중에'를 고른 계정인가 — 켤 때마다 다시 막았다(2026-11-01 ux-start M1). 다른 계정으로 로그인하면 다시 묻는다.
 *  시작은 설정 > 기기 관리에서(DevicesSection) */
export const laterFor = (saved: string | null, account: string | undefined): boolean => !!account && saved === account;
