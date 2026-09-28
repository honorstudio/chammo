// 관리 프로그램(claude daemon)이 다시 켜지면 백그라운드 세션이 전부 꺼진다(앱 교체·`daemon stop --any`).
// 앱이 살아 있는 세션을 ~/.honor-orchestrator/live.json 에 계속 적어 두고, 관리 프로그램 시작 시각
// (~/.claude/daemon.lock 의 startedAt)이 바뀌면 직전까지 살아 있던 세션을 "재시작으로 꺼짐"으로 본다.
// 2026-09-27: 재시작 뒤 참모-2 와 하위 세션이 조용히 사라져 손으로 뒤져야 했다

import type { Session } from './session';

export type SnapSession = { sessionId: string; name: string; cwd: string; /** 목록에서 사라진 때 — 멈추는 도중 먼저 빠지는 세션을 잡으려고 잠깐 들고 있는다 */ goneAt?: number };
export type LiveSnap = { daemon: number; sessions: SnapSession[]; lost: SnapSession[] };

/** 재시작 직전 이만큼 안에 사라진 세션도 재시작으로 꺼진 걸로 본다 (실측: 멈춤 → 다시 뜸 55초) */
const WINDOW = 3 * 60_000;
/** 사라진 세션 흔적을 들고 있는 시간 */
const KEEP = 10 * 60_000;

const toSnap = (s: Session): SnapSession => ({ sessionId: s.sessionId ?? '', name: s.name, cwd: s.cwd });

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

/** "안 켬" — 꺼진 목록만 비운다 */
export function dismissLost(snap: LiveSnap): LiveSnap {
  return { ...snap, lost: [] };
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
