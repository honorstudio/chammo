// 관리 프로그램(claude daemon)이 다시 켜지면 백그라운드 세션이 전부 꺼진다(앱 교체·`daemon stop --any`).
// 앱이 살아 있는 세션을 ~/.honor-orchestrator/live.json 에 계속 적어 두고, 관리 프로그램 시작 시각
// (~/.claude/daemon.lock 의 startedAt)이 바뀌면 직전까지 살아 있던 세션을 "재시작으로 꺼짐"으로 본다.
// 2026-09-27: 재시작 뒤 참모-2 와 하위 세션이 조용히 사라져 손으로 뒤져야 했다

import type { Session } from './session';
import type { StoppedSession } from './stopped';
import { splitOrchName } from './orchLabel';

export type SnapSession = { sessionId: string; name: string; cwd: string; /** 짧은 번호 — 있으면 같은 번호로 되살린다(respawn) */ id?: string; /** 목록에서 사라진 때 — 멈추는 도중 먼저 빠지는 세션을 잡으려고 잠깐 들고 있는다 */ goneAt?: number; /** 마지막으로 봤을 때 일하는 중(쉬는 게 아님) — 꺼질 때 일하던 세션은 '끝남'으로 안 친다(lostTriage). 옛 기록엔 없음 */ busy?: boolean; /** 세션이 뜬 때(ms) — 이름이 같은 옛 세션 작업 기록을 거른다(lostTriage). 옛 기록엔 없음 */ startedAt?: number };
export type LiveSnap = { daemon: number; sessions: SnapSession[]; lost: SnapSession[] };

/** 재시작 직전 이만큼 안에 사라진 세션도 재시작으로 꺼진 걸로 본다 (실측: 멈춤 → 다시 뜸 55초) */
const WINDOW = 3 * 60_000;
/** 사라진 세션 흔적을 들고 있는 시간 */
const KEEP = 10 * 60_000;

const toSnap = (s: Session): SnapSession => ({ sessionId: s.sessionId ?? '', name: s.name, cwd: s.cwd, id: s.id, busy: s.state !== 'idle' || !!s.awaiting, ...(s.startedAt ? { startedAt: s.startedAt } : {}) });

export function stepSnapshot(prev: LiveSnap | null, daemon: number | null, live: Session[], now: number): LiveSnap | null {
  if (daemon == null) return prev; // 멈춰 있는 동안 기록을 비우면 재시작 뒤 비교할 게 없어진다
  const bgLive = live.filter((s) => s.kind === 'background' && s.sessionId);
  const aliveIds = new Set(bgLive.map((s) => s.sessionId));
  const aliveNames = new Set(bgLive.map((s) => s.name));
  const current = bgLive.map(toSnap);

  if (!prev) return { daemon, sessions: current, lost: [] };

  const stillLost = (s: SnapSession) => !aliveIds.has(s.sessionId) && !aliveNames.has(s.name);

  if (prev.daemon !== daemon) {
    const killed = prev.sessions.filter((s) => !s.goneAt || s.goneAt >= daemon - WINDOW).map(({ goneAt: _g, ...s }) => s);
    const seen = new Set<string>();
    const lost = [...prev.lost, ...killed].filter((s) => stillLost(s) && !seen.has(s.sessionId) && seen.add(s.sessionId));
    return { daemon, sessions: current, lost };
  }

  const gone = prev.sessions
    .filter((s) => !aliveIds.has(s.sessionId))
    .map((s) => ({ ...s, goneAt: s.goneAt ?? now }))
    .filter((s) => now - s.goneAt <= KEEP);
  // 이어서 켜서 되살아나면 sessionId 가 같고, 앱이 참모를 새로 띄우면 이름이 같다 — 둘 다 뺀다
  return { daemon, sessions: [...current, ...gone], lost: prev.lost.filter(stillLost) };
}

/** live.json 글자 → 기록. 없거나 모양이 다르면 null (처음부터 다시 적는다) */
export function parseSnap(text: string): LiveSnap | null {
  try {
    const v = JSON.parse(text) as Partial<LiveSnap>;
    if (typeof v.daemon !== 'number' || !Array.isArray(v.sessions) || !Array.isArray(v.lost)) return null;
    return { daemon: v.daemon, sessions: v.sessions, lost: v.lost };
  } catch {
    return null;
  }
}

export type AutoRestore = { kind: 'none' } | { kind: 'revive'; sessions: SnapSession[] };

/**
 * 무인 기계(아이맥)에서 재시작 뒤 스스로 되살리기 — 설정 autoRevive 를 켰을 때만.
 * 2026-10-01 아이맥 재부팅: 앱은 다시 떴는데 비서·하위 세션이 꺼진 채 "다시 켜기" 버튼만 떠 있었다. 누를 사람이 없다.
 * 꺼진 세션 중 아직 안 해 본 것을 이어서 켠다(한 번씩만 — 실패해도 매 폴링 두드리지 않게).
 * 참모를 새로 띄우지는 않는다 — 참모가 없으면 오케스트레이터 홈에서 사람이 고른다(2026-10-03 사용자)
 */
export function autoRestore(o: {
  enabled: boolean;
  /** 세션 목록·live.json 을 한 번이라도 읽었나 — 뜨자마자 빈 목록으로 판단하지 않게 */
  ready: boolean;
  lost: SnapSession[];
  tried: Set<string>;
}): AutoRestore {
  if (!o.enabled || !o.ready) return { kind: 'none' };
  const todo = o.lost.filter((x) => !o.tried.has(x.sessionId));
  return todo.length ? { kind: 'revive', sessions: todo } : { kind: 'none' };
}
