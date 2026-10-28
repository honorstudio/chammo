// 음성 모드 — 참모가 답을 마치면 참모세이로 읽어준다(누워 있을 때 쓰려고, 사용자 2026-09-27).
// 읽을 글은 대화 기록을 읽을 때 자르기 전 전체 답으로 만든다(activity.ts). 마크다운·주소는 빼고 앞 두세 문장만
import { tr } from '../i18n';
import type { Activity, Line } from './activity';
import { orchestratorLike, type SessionState } from './session';

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
 * id 는 여러 개를 줄 수 있다 — 이어서 켠(--resume) 세션은 짧은 id 와 대화 id 가 달라서 둘 다로 찾는다(2026-09-29)
 */
export function pickSay(lines: SayLine[], id: string | (string | undefined)[], since: string, spoken = ''): { text: string; last: string } | undefined {
  const ids = (Array.isArray(id) ? id : [id]).filter((v): v is string => !!v);
  const mine = lines.filter((x) => ids.some((i) => x.session.startsWith(i)) && x.ts >= since && x.ts > spoken && x.text.trim());
  // 몰려 있으면 마지막 세 개만 — 저녁 내내 넘긴 말 6,500자를 한 번에 읽은 적이 있다(2026-09-28)
  return mine.length ? { text: mine.slice(-3).map((x) => x.text.trim()).join(' '), last: mine[mine.length - 1]!.ts } : undefined;
}

/** 세션 id → 마지막으로 처리한(읽었거나 처음 보고 넘긴) 답의 ts */
export type ReplySeen = Record<string, string>;
/** since = 이 앱이 켜진 때와 그 세션이 (다시) 켜진 때 중 늦은 것(ISO) — 그 전에 끝난 턴은 이미 지난 말이라 안 읽는다 */
export type Watch = { id: string; state: SessionState; activity: Activity; since?: string };

/**
 * 참모 세션이 새로 마친 답 — 음성으로 읽고, 묻는 답이면 알림. 넘겨주는 건 참모 세션만(하위 세션 답은 참모한테 한 말).
 * 상태 바뀜(작업 중→끝남)으로 판단하면 안 된다: 상태는 3초, 대화 기록은 10초마다 읽어서 세션이 먼저 쉬면
 * 옛 답이 '방금 끝난 답'처럼 보여 직전 답을 한 번 더 읽었다(2026-09-27 사용자 "음성이 두 번"). 그래서 답 ts 로 한 번만,
 * 턴 중간 멘트(midTurn)는 건너뛰고, 작업 중엔 기다린다. 처음 보는 세션은 이미 있던 답이라 기억만 한다.
 * 다시 켜진(respawn) 세션은 목록에 먼저 뜨고 대화 기록은 늦게 읽혀 '처음 본 답 없음'으로 기억됐다 — 그 뒤 읽힌 일주일 전 답을
 * 새 답으로 읽었다(2026-10-20 사용자: 깨어난 참모가 지난 대화를 읽음). 그래서 since 전에 끝난 턴은 아예 안 읽는다
 */
export function freshReplies(seen: ReplySeen | null, list: Watch[]): { fresh: { id: string; reply: Line }[]; seen: ReplySeen } {
  const next: ReplySeen = {};
  const fresh: { id: string; reply: Line }[] = [];
  for (const { id, state, activity: a, since } of list) {
    const r = a.reply && !a.reply.midTurn && !(a.prompt && a.prompt.ts > a.reply.ts) ? a.reply : undefined;
    const before = seen?.[id];
    if (before === undefined) next[id] = a.reply?.ts ?? '';
    // 턴 끝(end_turn)이 찍힌 답은 상태와 상관없이 끝난 것 — 백그라운드 job 참모는 기다리는 동안에도 working 으로 나온다(2026-09-28)
    else if (r && since && r.ts <= since) next[id] = r.ts;
    else if ((state !== 'working' || r?.turnEnd) && r && r.ts !== before) {
      fresh.push({ id, reply: r });
      next[id] = r.ts;
    } else next[id] = before;
  }
  return { fresh, seen: next };
}

/**
 * 다른 참모가 보낸 말(SendMessage)로만 깬 턴인가 — 그 답은 보낸 참모에게 한 말이라 소리로 안 읽는다(사람이 말 건 참모만 말한다, 2026-10-16).
 * 훅(voice-hint)은 세션에 scripts/say 를 부르지 말라고만 했고, 앱이 답 앞부분을 읽는 길엔 거름이 없었다(2026-10-20).
 * 하위 세션 회신·사람 말·끝 알림이 하나라도 섞이면 아니다(scripts/orch-roster from_orch 와 같은 규칙)
 */
export function fromOrchTurn(reply: Line): boolean {
  return !!reply.woke?.length && reply.woke.every(orchestratorLike);
}

/**
 * 지금 사용자가 말 건 참모 — 사람이 마지막으로 직접 말한(human) 참모와 앞에 띄운 채팅 탭. 음성은 이 참모들 답만 소리로 읽는다.
 * 모든 참모 답을 다 읽어서 회사 비서에게 말했는데 하위 세션 회신으로 깬 개발 담당도 같이 읽었다(2026-10-25 사용자)
 */
export function talkedTo(list: { id: string; human?: Line }[], front?: string | null): Set<string> {
  const out = new Set<string>();
  const last = list.filter((x) => x.human?.ts).sort((a, b) => (a.human!.ts < b.human!.ts ? -1 : 1)).pop();
  if (last) out.add(last.id);
  if (front && list.some((x) => x.id === front)) out.add(front);
  return out;
}

/** 소리로 안 읽고 쌓아 둔 다른 참모 답 — 참모 id → 읽을 글들·물어보는 답이 있나 */
export type VoiceHeld = Record<string, { texts: string[]; asks: boolean; ts: string; /** 한 줄 알림을 이미 했나 — 조용히 쌓인 것만이면 없음 */ noted?: boolean }>;

const without = (held: VoiceHeld, id: string): VoiceHeld => {
  const next = { ...held };
  delete next[id];
  return next;
};

/** 쌓을 때 한 줄 — "개발 담당한테 새 답 있어." 질문이면 "물어볼 게 있대"를 붙인다 */
export const heldNote = (name: string, asks: boolean) =>
  asks ? tr(`${name}한테 새 답 있어, 물어볼 게 있대.`, `New reply from ${name} — they have a question for you.`) : tr(`${name}한테 새 답 있어.`, `New reply from ${name}.`);

/**
 * 새 답 하나 — 말 건 참모면 그대로 읽고(speak), 아니면 쌓는다. 알림 한 줄(note)은 사람이 깨운 턴(human)이거나 묻는 답일 때만 —
 * 앱 줄·하위 세션 회신·깨운 말 모름으로 깬 턴은 조용히 쌓기만(10-28: 회사 비서가 넘긴 일의 디자인 담당 답을 "새 답 있어"로 알렸다).
 * 같은 참모가 이미 알렸으면 한 줄을 되풀이하지 않는다(질문이 새로 생길 때만 다시). 말 건 참모의 옛 쌓인 답은 새 답이 덮는다
 */
export function routeReply(held: VoiceHeld, r: { id: string; name: string; text: string; asks: boolean; ts: string; human?: boolean }, speakers: Set<string>): { speak?: string; note?: string; held: VoiceHeld } {
  const text = r.text.trim();
  if (!text) return { held };
  if (speakers.has(r.id)) {
    return { speak: text, held: without(held, r.id) };
  }
  const prev = held[r.id];
  const asks = !!prev?.asks || r.asks;
  const loud = r.asks || !!r.human;
  const note = loud && (!prev?.noted || (r.asks && !prev.asks));
  const next = { ...held, [r.id]: { texts: [...(prev?.texts ?? []), text], asks, ts: r.ts, noted: !!prev?.noted || loud } };
  return { ...(note ? { note: heldNote(r.name, asks) } : {}), held: next };
}

/**
 * 새 답 하나를 어떻게 — skip: 다른 참모가 보낸 말로만 깬 턴(그 참모에게 한 답, 쌓지도 않음) · speak: 말 건 참모 · hold: 쌓기(한 줄은 routeReply 가 가른다) ·
 * deeper: 꼬리가 잘려 깨운 말을 모름 — 기록을 더 길게 읽어 다시 본다(말 건 참모도 — 참모끼리 턴이면 버리게). final = 이미 더 읽은 뒤라 모르면 말 건 참모는 읽고 나머지는 쌓기.
 * giver = 이 참모가 일을 넘긴 참모의 말로 깬 턴인가(domain/handedAsk giverTurn) — 받은 쪽 질문을 모아 사람에게 묻는 턴이라 버리지 않는다(10-28)
 */
export function voiceTurn(reply: Line, speaker: boolean, final = false, giver: (r: Line) => boolean = () => false): 'skip' | 'speak' | 'hold' | 'deeper' {
  if (fromOrchTurn(reply) && !giver(reply)) return 'skip';
  if (reply.cut && !reply.byHuman && !final) return 'deeper';
  return speaker ? 'speak' : 'hold';
}

/** 쌓인 답 꺼내 읽기 — 그 참모 탭을 열거나 "○○ 거 읽어 줘"(scripts/app voice read). 몰려 있으면 마지막 세 개(pickSay 와 같은 이유) */
export function takeHeld(held: VoiceHeld, id: string): { text?: string; held: VoiceHeld } {
  const h = held[id];
  if (!h) return { held };
  return { text: h.texts.slice(-3).join(' '), held: without(held, id) };
}

/** scripts/app voice read <참모> 의 참모 — 화면 별명·SendMessage 이름(참모-5 · 개발 담당)·앞 번호 이름·id 앞자리 */
export function heldTarget(target: string, orchs: { id: string; name: string; display: string }[]): string | undefined {
  const t = target.trim().toLowerCase();
  if (!t) return undefined;
  const base = (n: string) => n.split(' · ')[0]!.trim().toLowerCase();
  return (orchs.find((o) => o.display.toLowerCase() === t || o.name.toLowerCase() === t || base(o.name) === t) ?? orchs.find((o) => o.id.startsWith(t)))?.id;
}
