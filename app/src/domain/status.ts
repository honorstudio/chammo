// 세션 현황 카드의 상태 판정 · 알림 보낼 변화 · 사이드바 문서 상태.
import { tr } from '../i18n';

import type { Activity } from './activity';
import type { SessionState } from './session';

/** login = 로그인이 풀려 멈춤(대화 기록 마지막 줄이 로그인 오류, domain/activity isAuthError) */
export type ActivityStatus = 'working' | 'asks' | 'blocked' | 'login' | 'done' | 'idle' | 'stale';

const STALE_MS = 24 * 3600_000;

// 답 끝부분이 사용자에게 묻는 말인가. 설명 중간의 "?"(자문자답)는 빼고 끝만 본다
const ASK_END = /(\?|？)\s*[ㅇㅎㅋ;~.!\s]*$/;
// 골라줘·정해줘 같은 부탁은 아래 REQUEST 가 조건("안 되면 말해 줘")까지 보고 가른다
const ASK_WORDS = /어떻게 할래\s*[ㅇㅎㅋ;~.!\s]*$/;

// 끝이 "?" 가 아니어도 허락·확인을 구하는 말 — "해도 될까? … 허락 전에는 안 할게. 참모-2에게도 보내뒀어" 처럼
// 질문 뒤에 한마디가 붙으면 끝만 봐서는 놓친다(2026-09-27 project-b-g).
// '허락'·'확인 필요' 낱말만으로는 "결제 허락과는 별개야"·"확인이 필요했던 4개" 를 잡아서(2026-10-09 실측) 구하는 꼴만
const PERMIT = /(해도|하면|되면|괜찮으면)\s*(될까|돼|되나|되겠어|괜찮아)\s*\?|허락\s*(해\s*줘|해\s*줄래|할래|해\s*줄\s*수|이\s*필요|부탁)|(승인|확인|결정)\s*(이\s*)?필요(?!했)|확인\s*부탁|(네가|너가)\s*(허락|승인)\s*하면/;

// 사용자 답을 기다린다는 말 — "아직 네 답 기다리고 있어"·"네 답이 필요한 건 세 개야"·"정할 게 세 개 있어"
const WAITING = /(네|너|사용자)\s*(의\s*)?(답|결정|확인|선택|허락)\s*(을|이|만)?\s*(기다리|필요|받아야)|(아직|지에\s*대한)\s*(네\s*)?답(을|도)?\s*기다리|물어본\s*(거|것)\s*답|답이\s*필요한\s*(건|것|게)|정할\s*(게|것|거)\s*(가\s*)?(하나|한\s*개|두|세|네|[0-9])|남은\s*결정/;

// 띄어 쓴 부탁도 — "골라 줘"·"정해 주면 바로"·"켜 주면 바로". "안 되면 말해 줘"·"보여 줄 테니 골라 줘"·"그때 승인해 줘"처럼
// 조건·나중이 붙은 건 열어 둔 말이라 뺀다
const REQUEST = /(골라|정해|말해|알려|답해|결정해|확인해|켜|수락해|승인해)\s*(줘|주면|줄래|주세요)(?!라고|서|야)/;
const IF_BEFORE = /면\s|테니|때\s|나중에|다음에|내가/;

// 문장 안 따옴표·백틱(화면 문구 "acme-shop 끌까?"·현황표 "거래처 확인 필요")은 묻는 말이 아니다
const QUOTED = /"[^"\n]*"|“[^”\n]*”|`[^`\n]*`/g;
// 스스로 묻고 답하는 꼴 — "왜 느렸을까? 원인은 …", "설명하면? …"
const SELF_Q = /^(\*\*)?(왜|뭐가|무엇이|어디서|어떻게 된|원인은|이유는)|하면\s*[?？]$/;
const TAIL = 300;

const sentences = (t: string) => t.split(/(?<=[.!?？。])\s+|\n+/).map((x) => x.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean);

/** 끝 300자 안에 사용자에게 묻는 문장이 있나 — 묻고 나서 "참고로 …" 한두 마디를 더 붙이는 답이 많다(2026-10-09 놓친 것 18/60) */
// 말할 낱말을 쥐여 주는 꼴 — '"다 진행"이라고 하면 1번부터 할게'·'"ㄱㄱ" 하면 시작할게'·'"ㅇㅇ"만 해 주면 돼'.
// '"내일 일정 뭐야?" 하면 답하고'처럼 남이 말하는 경우는 빼려고 내가 할 일(…게)로 끝나는 문장만
const SAY_TO_GO = /""\s*(만\s*)?(이?라고\s*)?하면.*게[.!]?$|""\s*(만\s*)?(이?라고\s*)?해\s*주면\s*돼/;

function asksInTail(tail: string): boolean {
  for (const x of sentences(tail.replace(QUOTED, '""').replace(/\*\*/g, ''))) {
    if (SAY_TO_GO.test(x)) return true;
    if (/[?？]\s*[ㅇㅎㅋ;~!\s]*$/.test(x) && !SELF_Q.test(x)) return true;
    const m = REQUEST.exec(x);
    if (m && !IF_BEFORE.test(x.slice(0, m.index))) return true;
  }
  return false;
}

/** reply 는 자르기 전 전체 답이어야 한다 — 끝 80자로 질문꼴, 끝 300자로 묻는 문장·부탁, 끝 400자로 허락·확인 요청·답 기다림을 본다 */
export function asksUser(reply: string): boolean {
  const text = reply.trim();
  const tail = text.slice(-80);
  const near = text.slice(-400).replace(QUOTED, '""');
  return ASK_END.test(tail) || ASK_WORDS.test(tail) || asksInTail(text.slice(-TAIL)) || PERMIT.test(near) || WAITING.test(near);
}

/** 메뉴·대시보드·사무실이 다 이 판단 하나를 쓴다(2026-10-04 오피스 A 1단계). 메뉴는 CLI 의 awaiting(state blocked + status idle)을
 *  '물어봄'으로 써서 사무실 '끝남'과 갈렸는데, awaiting 은 턴을 끝낸 세션 대부분(실측 21개 중 12개)이라 '묻는다'는 뜻이 아니다 — 답 글로 본다 */
export function activityStatus(state: SessionState, a: Activity, now: number): ActivityStatus {
  if (state === 'working') return 'working';
  if (state === 'blocked') return 'blocked';
  if (a.auth && !a.auth.retry) return 'login'; // 오래돼도 — 로그인은 저절로 안 풀린다
  const last = a.reply?.ts ?? a.prompt?.ts;
  if (!last) return 'idle';
  if (now - Date.parse(last) > STALE_MS) return 'stale';
  if (!a.reply) return 'idle';
  if (a.prompt && a.prompt.ts > a.reply.ts) return 'idle'; // 지시를 받고 답 없이 멈춤
  return (a.reply.asks ?? asksUser(a.reply.text)) ? 'asks' : 'done';
}

/** 대화 기록 없이 세션만으로 — 기록을 아직 못 읽었을 때 메뉴 표시(awaiting 은 안 본다, 위 activityStatus) */
export const sessionStatus = (s: { state: SessionState }): ActivityStatus => activityStatus(s.state, {}, 0);

/** 상태 말 — 메뉴·대시보드·사무실 현황판이 이 표 하나만 쓴다 */
export function statusWord(st: ActivityStatus): string {
  switch (st) {
    case 'working': return tr('일하는 중', 'Working');
    case 'asks': return tr('물어봄', 'Asking');
    case 'blocked': return tr('기다림', 'Waiting');
    case 'login': return tr('로그인 필요', 'Sign-in needed');
    case 'done': return tr('답함', 'Replied'); // 살아서 다음 지시를 기다림 — '끝남'은 꺼진 세션 줄(StoppedStrip)에만(2026-10-04 QA N4)
    case 'stale': return tr('잠듦', 'Asleep');
    default: return tr('쉼', 'Idle');
  }
}

/** 표시 갈래 — run = 도는 고리, ask = 노란 점, idle = 표시 없음 */
export const statusTone = (st: ActivityStatus): 'run' | 'ask' | 'idle' => (st === 'working' ? 'run' : st === 'asks' || st === 'blocked' || st === 'login' ? 'ask' : 'idle');

const NOTIFY: ActivityStatus[] = ['done', 'asks', 'blocked'];

/** 이전 폴링 → 이번 폴링 사이에 알림 보낼 변화. 처음 보는 세션은 안 알린다(앱을 막 켰을 때 알림 폭탄 방지) */
export function transitions(
  prev: Readonly<Record<string, ActivityStatus>>,
  next: Readonly<Record<string, ActivityStatus>>,
): { id: string; to: ActivityStatus }[] {
  return Object.entries(next)
    .filter(([id, to]) => prev[id] !== undefined && prev[id] !== to && NOTIFY.includes(to))
    .map(([id, to]) => ({ id, to }));
}

export type ProjectDoc = {
  name: string;
  hasClaude: boolean;
  /** docs/starter.md 글자 수, 없으면 null */
  starterChars: number | null;
  /** starter 마지막 갱신 뒤 커밋 수 */
  commitsSinceStarter: number;
  lastCommit: string;
};

const STARTER_MAX = 8000; // honor-orchestrator CLAUDE.md "갱신 전 크기 확인" 기준과 같다
const DRIFT = 10;

export function docBadges(d: ProjectDoc): string[] {
  const out: string[] = [];
  if (!d.hasClaude) out.push(tr('CLAUDE.md 없음', 'no CLAUDE.md'));
  // starter 가 없는 건 경고가 아니다 — docs/starter.md 를 쓰기로 한 프로젝트만 크기·밀림을 본다
  if (d.starterChars != null && d.starterChars > STARTER_MAX) out.push(`starter ${Math.round(d.starterChars / 1000)}k`);
  if (d.starterChars != null && d.commitsSinceStarter >= DRIFT) out.push(tr(`starter ${d.commitsSinceStarter}커밋 밀림`, `starter ${d.commitsSinceStarter} commits behind`));
  return out;
}

/** 프로젝트 화면에 "하네스 깔기" 버튼 — CLAUDE.md 나 docs/starter.md 가 없을 때(깔면 빈 자리만 채운다) */
export const needsHarness = (d: ProjectDoc | undefined): boolean => !!d && (!d.hasClaude || d.starterChars == null);
