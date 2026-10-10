// 오케스트레이터 칸 줄 — 살아 있는 참모와 꺼진 참모를 한 목록으로, 자리를 기억해서.
// 끌 때 누르는 즉시 줄을 치우고(갱신 뒤 '꺼진 참모'로 맨 아래에 다시), 켤 때 꺼진 줄을 먼저 빼서(다음 갱신에 다른 자리로)
// 줄이 잠깐 사라졌다 튀어나왔다(2026-10-02 사용자). 실측: claude 목록 자체엔 틈이 없다 — 끄는 2.5초 동안 살아 있는 목록에 있고
// 끝나면 바로 꺼진(done) 목록에, 되살리기 2.4초 뒤 바로 살아 있는 목록에. 그래서 줄은 그대로 두고 상태만 '끄는 중·켜는 중'.
import { orchSort } from './orchOrder';
import type { Session } from './session';
import { orchShadow, type StoppedSession } from './stopped';

export type OrchPhase = 'live' | 'off' | 'stopping' | 'starting';
export type OrchRow = { key: string; phase: OrchPhase; live?: Session; off?: StoppedSession };

/** 줄 = 세션(대화) — 되살려도(respawn) 같은 sessionId, 별명이 바뀌어도 같은 줄. 기본 이름으로 묶으면 번호가 같은
 *  참모 둘이 한 줄로 합쳐졌다(2026-10-02 참모-3 둘 사고) */
const liveKey = (s: Session) => s.sessionId ?? s.id;

/**
 * live = 살아 있는 참모(끄는 중인 것 포함), off = 꺼진 참모(이름마다 최근 하나), stopping = 끄는 중인 세션 id,
 * starting = 켜는 중인 sessionId, prev = 지난번 줄(자리 기억·찰나 메우기)
 */
/** pins = 고정한 대화 id(고정한 순서) — 그 줄은 지난 자리보다 먼저(domain/orchPins).
 *  order = 저장한 참모 순서(대화 id, 채팅 탭 끌기) — 지난 자리 기억보다 먼저, 순서에 없는 줄만 지난 자리로(domain/orchOrder) */
export function orchRows(o: { live: Session[]; off: StoppedSession[]; stopping: Set<string>; starting: Set<string>; prev: OrchRow[]; pins?: string[]; order?: string[] }): OrchRow[] {
  const now = new Map<string, OrchRow>();
  for (const s of o.live) {
    const k = liveKey(s);
    if (!now.has(k)) now.set(k, { key: k, phase: o.stopping.has(s.id) ? 'stopping' : 'live', live: s });
  }
  const show = orchShadow(o.live);
  for (const x of o.off) {
    const k = x.sessionId;
    if (now.has(k) || !show(x.name)) continue; // 같은 대화가 살아 있거나, 같은 참모의 옛 기록
    now.set(k, { key: k, phase: o.starting.has(x.sessionId) ? 'starting' : 'off', off: x });
  }
  // 갱신 사이 찰나에 두 목록 어디에도 없지만 아직 끄는 중·켜는 중이면 마지막 모습으로 남긴다
  for (const p of o.prev) {
    if (now.has(p.key)) continue;
    const stillStopping = p.phase === 'stopping' && p.live && o.stopping.has(p.live.id);
    const stillStarting = p.phase === 'starting' && p.off && o.starting.has(p.off.sessionId);
    if (stillStopping || stillStarting) now.set(p.key, p);
  }
  // 자리: 지난번 순서를 지키고, 새로 생긴 줄만 끝에(살아 있는 것 먼저 — 위에서 넣은 순서).
  // 새로 만든 참모는 '켜는 중' 줄(new:<진짜 이름>) 자리를 이어받는다
  const out: OrchRow[] = [];
  for (const p of o.prev) {
    const r = now.get(p.key) ?? (p.key.startsWith('new:') ? [...now.values()].find((x) => x.live?.name === p.key.slice(4)) : undefined);
    if (r) { out.push(r); now.delete(r.key); }
  }
  return orchSort([...out, ...now.values()], o.order ?? [], o.pins ?? [], (r) => r.live?.sessionId ?? r.off?.sessionId);
}

/** 사이드바 B안 — 자리를 잡은 꺼진 줄만 '쉬는 참모 N' 접힌 줄로 뺀다. 켜는 중·끄는 중은 위(바뀌는 동안 줄이 안 튀게, 2026-10-10) */
export function foldOff(rows: OrchRow[]): { main: OrchRow[]; off: OrchRow[] } {
  return { main: rows.filter((r) => r.phase !== 'off'), off: rows.filter((r) => r.phase === 'off') };
}

/** 새로 만든 참모(진짜 이름)가 살아 있는 목록에 떴으면 그 id — 그때 채팅 탭·대시보드를 그리로 옮긴다 */
export function arrivedOrch(creating: string | null, live: { id: string; name: string }[]): string | undefined {
  if (!creating) return undefined;
  return live.find((s) => s.name === creating)?.id;
}

/** 뜨는 동안 보일 자리 — 꺼진 참모 모양으로 만들어 orchRows 의 '켜는 중'으로 넣는다(sessionId = new:<이름>) */
export function creatingRow(name: string, cwd: string): StoppedSession {
  return { id: `new:${name}`, sessionId: `new:${name}`, name, cwd, project: '', workspace: null, reason: 'stopped', startedAt: Date.now() };
}
