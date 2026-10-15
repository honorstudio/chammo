// 프사 띠 위쪽 줄 — 살아 있는 참모 + 끄는 중 + 켜는 중(깨우는 쉬는 참모·새로 만드는 참모)을 한 줄로(2026-10-12 사용자 "뿅 나왔다 뿅 사라진다").
// 옛 사이드바 orchRows 와 같은 생각(줄은 그대로, 상태만 바뀜)이지만 띠는 꺼진 참모를 아래 '쉬는 참모'로 따로 둔다 —
// 그래서 켜는 중은 누르는 순간 위 줄(살아나면 설 자리)로 올라오고, 끄는 중은 끝날 때까지 제자리에 있다가 아래로 내려간다.
import { tr } from '../i18n';
import { orchSort } from './orchOrder';
import type { Session } from './session';
import type { StoppedSession } from './stopped';

export type RailPhase = 'live' | 'stopping' | 'starting';
/** key = 대화 id(되살려도 같다) — 켜는 중 줄이 살아나면 같은 키라 같은 칸이 그대로 살아난다. 새로 만드는 참모는 new:<이름> */
export type RailRow = { key: string; phase: RailPhase; name: string; live?: Session; off?: StoppedSession; waking: boolean };

const liveKey = (s: Session) => s.sessionId ?? s.id;

/**
 * live = 살아 있는 참모(끄는 중 포함, 이미 정렬된 순서), stopping = 끄는 중 세션 id, starting = 켜는 중(꺼진 참모 모양 — 새 참모는 creatingRow),
 * startingIds = 아직 켜는 중인 대화 id(목록 갱신 사이 찰나 메우기 — 없으면 starting 의 것), prev = 지난번 줄
 */
export function railRows(o: { live: Session[]; stopping: Set<string>; starting: StoppedSession[]; startingIds?: Set<string>; prev: RailRow[]; order?: string[]; pins?: string[] }): RailRow[] {
  const rows: RailRow[] = o.live.map((s) => ({ key: liveKey(s), phase: o.stopping.has(s.id) ? 'stopping' : 'live', name: s.name, live: s, waking: false }));
  const have = new Set(rows.map((r) => r.key));
  for (const x of o.starting) {
    if (have.has(x.sessionId)) continue; // 살아났는데 켜는 중 목록에도 남은 찰나
    have.add(x.sessionId);
    rows.push({ key: x.sessionId, phase: 'starting', name: x.name, off: x, waking: !x.sessionId.startsWith('new:') });
  }
  // 갱신 사이 찰나 — 두 목록 어디에도 없지만 아직 끄는 중·켜는 중이면 지난 자리에 마지막 모습으로
  const startingIds = o.startingIds ?? new Set(o.starting.map((x) => x.sessionId));
  o.prev.forEach((p, i) => {
    if (have.has(p.key)) return;
    const still = (p.phase === 'stopping' && p.live && o.stopping.has(p.live.id)) || (p.phase === 'starting' && startingIds.has(p.key));
    if (!still) return;
    have.add(p.key);
    rows.splice(Math.min(i, rows.length), 0, p);
  });
  return orchSort(rows, o.order ?? [], o.pins ?? [], (r) => (r.key.startsWith('new:') ? undefined : r.key));
}

/** 줄 모양 지문(키:상태) 두 개가 다르면 자리 옮김 움직임을 한다 — 폭 바꾸기·끌기만 있었으면 안 움직인다 */
export function railMoved(prev: string[], next: string[]): boolean {
  return prev.length !== next.length || prev.some((k, i) => k !== next[i]);
}

/** 호버 카드·넓은 띠 맡은 일 자리에 들어갈 한 줄 */
export function phaseWord(phase: RailPhase, waking: boolean): string | undefined {
  if (phase === 'stopping') return tr('끄는 중…', 'Stopping…');
  if (phase === 'starting') return waking ? tr('깨우는 중…', 'Waking…') : tr('켜는 중…', 'Starting…');
  return undefined;
}

/** 깨우는 동안 참모 채팅 입력칸 위 한 줄 — 채팅은 뜰 때까지 앞 참모에 남는다(그사이 친 말이 엉뚱한 참모로 가지 않게) */
export function wakeNotice(name: string, waking: boolean): string {
  return waking ? tr(`${name} 깨우는 중… 뜨면 이 채팅이 그리로 넘어가`, `Waking ${name}… this chat moves there when it's up`) : tr(`${name} 켜는 중… 뜨면 이 채팅이 그리로 넘어가`, `Starting ${name}… this chat moves there when it's up`);
}
