// 꺼진 세션(이어갈 수 있는 것)과, 참모 화면 아래 띄울 "지금 시킨 일" 세션 고르기.

import { classifyWorkspace, type Session } from './session';
import { fwd } from './paths';
import type { TaskCard } from './tasks';

export type StoppedSession = {
  id: string;
  sessionId: string;
  name: string;
  cwd: string;
  project: string;
  workspace: string | null;
  /** stopped = 사람이 끔 · done = 할 일 끝나고 종료 · failed = 비정상 종료 */
  reason: 'stopped' | 'done' | 'failed';
  startedAt: number;
};

const REASONS = new Set(['stopped', 'done', 'failed']);

/** `claude agents --json --all` 에서 꺼진 세션만. sessionId 가 없으면 이어갈 수 없으니 뺀다 */
export function parseStopped(json: string, devRoot: string, extras: string[] = []): StoppedSession[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .filter((r) => REASONS.has(String(r.state)) && typeof r.sessionId === 'string')
    .map((r) => {
      const cwd = fwd(String(r.cwd ?? ''));
      return {
        id: String(r.id ?? r.sessionId),
        sessionId: String(r.sessionId),
        name: String(r.name ?? ''),
        cwd,
        reason: r.state as StoppedSession['reason'],
        startedAt: Number(r.startedAt ?? 0),
        ...classifyWorkspace(cwd, devRoot, extras),
      };
    })
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** 참모가 시킨 일 중 끝나지 않은 것의 대상 세션, 최근 순 최대 3개. 터미널 대화형은 attach 가 안 되니 뺀다 */
export function recentDelegated(cards: TaskCard[], sessions: Session[], max = 4): Session[] {
  const out: Session[] = [];
  const sorted = [...cards].sort((a, b) => (a.sentAt < b.sentAt ? 1 : a.sentAt > b.sentAt ? -1 : 0));
  for (const c of sorted) {
    if (c.status === 'done' || c.status === 'gone') continue;
    const s = sessions.find((x) => (x.id === c.target || x.name === c.target) && x.kind === 'background');
    if (s && !out.includes(s)) out.push(s);
    if (out.length === max) break;
  }
  return out;
}

/**
 * "이어서" 목록: 이미 살아 있는 대화, 방금 누른 것(pending), 같은 대화의 옛 기록은 뺀다.
 * 안 빼면 여러 번 눌렀을 때 CLI 가 "이미 돈다"며 복사본을 계속 만든다(실사용 버그 2026-09-27)
 */
export function resumable(stopped: StoppedSession[], live: Session[], pending: Set<string> = new Set()): StoppedSession[] {
  const alive = new Set(live.map((s) => s.sessionId).filter(Boolean));
  const seen = new Set<string>();
  return stopped.filter((s) => {
    if (alive.has(s.sessionId) || pending.has(s.sessionId) || seen.has(s.sessionId)) return false;
    seen.add(s.sessionId); // parseStopped 가 최근 순이라 처음 본 게 가장 최근
    return true;
  });
}

/**
 * 주인 잃은 일(세션이 사라진 일)을 이어서 켤 꺼진 세션. 대상은 이름·짧은 id·sessionId 어느 쪽으로도 적힌다.
 * stopped 는 최근 순이라 같은 이름이 여럿이면 가장 최근 대화를 잇는다
 */
export function orphanSession(target: string, stopped: StoppedSession[]): StoppedSession | undefined {
  return stopped.find((s) => s.id === target || s.sessionId === target) ?? stopped.find((s) => s.name === target);
}
