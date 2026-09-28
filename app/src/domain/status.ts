// 세션 현황 카드의 상태 판정 · 알림 보낼 변화 · 사이드바 문서 상태.
import { tr } from '../i18n';

import type { Activity } from './activity';
import type { SessionState } from './session';

export type ActivityStatus = 'working' | 'asks' | 'blocked' | 'done' | 'idle' | 'stale';

const STALE_MS = 24 * 3600_000;

// 답 끝부분이 사용자에게 묻는 말인가. 설명 중간의 "?"(자문자답)는 빼고 끝만 본다
const ASK_END = /(\?|？)\s*[ㅇㅎㅋ;~.!\s]*$/;
const ASK_WORDS = /(골라줘|정해줘|확인해줘|알려줘|말해줘|어떻게 할래|결정해줘)\s*[ㅇㅎㅋ;~.!\s]*$/;

// 끝이 "?" 가 아니어도 허락·확인을 구하는 말 — "해도 될까? … 허락 전에는 안 할게. 참모-2에게도 보내뒀어" 처럼
// 질문 뒤에 한마디가 붙으면 끝만 봐서는 놓친다(2026-09-27 project-b-g)
const PERMIT = /(해도|하면|되면|괜찮으면)\s*(될까|돼|되나|되겠어|괜찮아)\s*\?|허락|승인\s*(이\s*)?필요|확인\s*(이\s*)?필요|확인\s*부탁|결정\s*(이\s*)?필요/;

/** reply 는 자르기 전 전체 답이어야 한다 — 끝 80자로 질문꼴, 끝 400자로 허락·확인 요청을 본다 */
export function asksUser(reply: string): boolean {
  const text = reply.trim();
  const tail = text.slice(-80);
  return ASK_END.test(tail) || ASK_WORDS.test(tail) || PERMIT.test(text.slice(-400));
}

export function activityStatus(state: SessionState, a: Activity, now: number): ActivityStatus {
  if (state === 'working') return 'working';
  if (state === 'blocked') return 'blocked';
  const last = a.reply?.ts ?? a.prompt?.ts;
  if (!last) return 'idle';
  if (now - Date.parse(last) > STALE_MS) return 'stale';
  if (!a.reply) return 'idle';
  if (a.prompt && a.prompt.ts > a.reply.ts) return 'idle'; // 지시를 받고 답 없이 멈춤
  return (a.reply.asks ?? asksUser(a.reply.text)) ? 'asks' : 'done';
}

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
