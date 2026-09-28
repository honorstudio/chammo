// 음성 모드 — 참모가 답을 마치면 참모세이로 읽어준다(누워 있을 때 쓰려고, 사용자 2026-09-27).
// 읽을 글은 대화 기록을 읽을 때 자르기 전 전체 답으로 만든다(activity.ts). 마크다운·주소는 빼고 앞 두세 문장만
import { tr } from '../i18n';
import type { Activity, Line } from './activity';
import type { SessionState } from './session';

const MAX = 200;

export function speakable(raw: string): string {
  const lines = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .map((l) => l.replace(/^\s*(#{1,6}\s+|[-*•]\s+|\d+\.\s+|>\s*)/, '').trim())
    .filter(Boolean);
  const joined = lines.reduce((acc, l) => (!acc ? l : /[.!?]$/.test(acc) ? `${acc} ${l}` : `${acc}. ${l}`), '');
  const t = joined
    .replace(/https?:\/\/\S+/g, tr('링크', 'link'))
    .replace(/\*\*|__|`|\|/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = (t.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? []).map((p) => p.trim()).filter(Boolean);
  let out = '';
  for (const p of parts.slice(0, 3)) {
    const next = out ? `${out} ${p}` : p;
    if (next.length > MAX) break;
    out = next;
  }
  out ||= t.slice(0, MAX);
  // 앞만 읽으면 끝에 둔 질문이 빠진다 — 사용자 답이 필요한 말이라 꼭 붙인다(2026-09-28 "재시작해야 돼"에서 끊김)
  const q = parts[parts.length - 1];
  if (q?.endsWith('?') && !out.includes(q)) out = `${out} ${q}`;
  return out;
}

/**
 * 참모가 따로 써 넘긴 음성용 말(scripts/say → ~/.honor-orchestrator/say.jsonl). 음성 모드에선 참모가
 * 중요도에 맞춰 길이를 정해 쓴다 — 앱이 앞 세 문장만 자르면 긴 설명이 필요한 것도 잘렸다(사용자 2026-09-28)
 */
export type SayLine = { ts: string; session: string; text: string };
export function parseSay(raw: string): SayLine[] {
  const out: SayLine[] = [];
  for (const l of raw.split('\n')) {
    try {
      const x = JSON.parse(l) as Partial<SayLine>;
      if (typeof x.ts === 'string' && typeof x.session === 'string' && typeof x.text === 'string') out.push(x as SayLine);
    } catch { /* 깨진 줄은 건너뛴다 */ }
  }
  return out;
}
/**
 * 그 세션(앞 8자리 id)이 이번 턴(since = 지시 시각) 안에 넘긴 말 중 아직 안 읽은 것(spoken 뒤)을 이어 붙인 것 + 그 마지막 ts.
 * 사람 지시 없이 세션 회신으로 여러 번 답하면 지시 뒤 말을 전부 붙여 읽어 앞 말을 되풀이했다(2026-09-28 아이맥). 없으면 undefined
 */
export function pickSay(lines: SayLine[], id: string, since: string, spoken = ''): { text: string; last: string } | undefined {
  const mine = lines.filter((x) => x.session.startsWith(id) && x.ts >= since && x.ts > spoken && x.text.trim());
  // 몰려 있으면 마지막 세 개만 — 저녁 내내 넘긴 말 6,500자를 한 번에 읽은 적이 있다(2026-09-28)
  return mine.length ? { text: mine.slice(-3).map((x) => x.text.trim()).join(' '), last: mine[mine.length - 1]!.ts } : undefined;
}

/** 세션 id → 마지막으로 처리한(읽었거나 처음 보고 넘긴) 답의 ts */
export type ReplySeen = Record<string, string>;
export type Watch = { id: string; state: SessionState; activity: Activity };

/**
 * 참모 세션이 새로 마친 답 — 음성으로 읽고, 묻는 답이면 알림. 넘겨주는 건 참모 세션만(하위 세션 답은 참모한테 한 말).
 * 상태 바뀜(작업 중→끝남)으로 판단하면 안 된다: 상태는 3초, 대화 기록은 10초마다 읽어서 세션이 먼저 쉬면
 * 옛 답이 '방금 끝난 답'처럼 보여 직전 답을 한 번 더 읽었다(2026-09-27 사용자 "음성이 두 번"). 그래서 답 ts 로 한 번만,
 * 턴 중간 멘트(midTurn)는 건너뛰고, 작업 중엔 기다린다. 처음 보는 세션은 이미 있던 답이라 기억만 한다
 */
export function freshReplies(seen: ReplySeen | null, list: Watch[]): { fresh: { id: string; reply: Line }[]; seen: ReplySeen } {
  const next: ReplySeen = {};
  const fresh: { id: string; reply: Line }[] = [];
  for (const { id, state, activity: a } of list) {
    const r = a.reply && !a.reply.midTurn && !(a.prompt && a.prompt.ts > a.reply.ts) ? a.reply : undefined;
    const before = seen?.[id];
    if (before === undefined) next[id] = a.reply?.ts ?? '';
    // 턴 끝(end_turn)이 찍힌 답은 상태와 상관없이 끝난 것 — 백그라운드 job 참모는 기다리는 동안에도 working 으로 나온다(2026-09-28)
    else if ((state !== 'working' || r?.turnEnd) && r && r.ts !== before) {
      fresh.push({ id, reply: r });
      next[id] = r.ts;
    } else next[id] = before;
  }
  return { fresh, seen: next };
}
