// 꺼진 세션(이어갈 수 있는 것)과, 참모 화면 아래 띄울 "지금 시킨 일" 세션 고르기.

import { classifyWorkspace, orchestratorLike, type Session } from './session';
import { fwd, samePath } from './paths';
import { splitOrchName } from './orchLabel';
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

/** 오케스트레이터 패널에 보일 꺼진 참모 — HQ 폴더의 비서 이름 꼴(참모·참모-2·옛 참모-N), 지금 같은 이름으로 떠 있지 않은 것, 이름마다 가장 최근 하나.
 *  예전엔 이름이 딱 '참모'일 때만 통과해서 번호 붙은 참모는 끄는 순간 사라졌다(2026-10-01 사용자) */
export function stoppedOrchs(stopped: StoppedSession[], orchCwd: string, live: { name: string }[]): StoppedSession[] {
  const shadow = orchShadow(live);
  return stopped.filter((x) => samePath(x.cwd, orchCwd) && orchestratorLike(x.name) && shadow(x.name));
}

/**
 * 꺼진 참모 기록을 보일지 — 보이면 true(그리고 기억해서 다음 같은 것은 숨긴다).
 * 별명 없는 기록(참모-5)은 같은 번호가 이미 있으면 숨긴다 — 진짜 이름에 별명이 실리기 전 옛 이름·복사본(참모-2 가 7개).
 * 별명이 있으면 번호+별명이 같을 때만 숨긴다 — 번호가 같아도 별명이 다르면 다른 참모다(2026-10-02 참모-3 둘 사고:
 * 살아 있는 '참모-3 · 서버 정리' 때문에 꺼진 '참모-3 · 쇼핑몰 문의'가 사이드바에서 사라졌다)
 */
export function orchShadow(live: { name: string }[]): (name: string) => boolean {
  const bases = new Set<string>();
  const fulls = new Set<string>();
  const add = (n: string) => { const { base, nick } = splitOrchName(n); bases.add(base); fulls.add(`${base}${NICK}${nick ?? ''}`); };
  live.forEach((o) => add(o.name));
  return (name) => {
    const { base, nick } = splitOrchName(name);
    if (nick ? fulls.has(`${base}${NICK}${nick}`) : bases.has(base)) return false;
    add(name);
    return true;
  };
}
const NICK = '\u0000';

/** 꺼진 참모 하나를 지울 때 같이 지울 것 — 같은 HQ·같은 참모 이름으로 쌓인 꺼진 세션 전부(패널엔 최근 하나만 보여서, 하나만 지우면 다음 옛것이 올라왔다). 참모가 아니면 그것 하나 */
export function sameOrchSlot(stopped: StoppedSession[], x: StoppedSession, orchCwd: string): StoppedSession[] {
  if (!samePath(x.cwd, orchCwd) || !orchestratorLike(x.name)) return [x];
  // 같은 번호 + 같은 별명, 그리고 별명 없는 옛 복사본만 — 번호가 같아도 별명이 다르면 다른 참모라 남긴다(2026-10-02 참모-3 둘)
  const { base: b, nick: n } = splitOrchName(x.name);
  return stopped.filter((y) => {
    const { base, nick } = splitOrchName(y.name);
    return base === b && samePath(y.cwd, orchCwd) && (!nick || nick === n);
  });
}
