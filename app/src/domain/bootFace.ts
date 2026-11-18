// 켤 때 점호 — 참모 자리는 처음부터 다 있고 얼굴(상태)만 바뀐다. 시안 docs/design-drafts/boot-loading v3 확정(2026-11-17 사용자 "다 좋다").
// 순수 TS(그리는 건 ui/boot). 표 = 시안 README '실제 값 → 얼굴'·'자리'
import { EYES, SHAPES, type AvatarPhase, type AvatarState, type Eyes, type Shape } from './avatar';
import { splitOrchName } from './orchLabel';
import type { SnapSession } from './revive';
import type { SessionState } from './session';
import type { StoppedSession } from './stopped';

/** work 일함 · ask 물음 · rest 쉼(깨어 있음) · queue 깨울 차례(재부팅으로 꺼짐) · waking 깨는 중 · failed 못 깸 · resting 재워 둠(쉬는 칸) */
export type BootFace = 'work' | 'ask' | 'rest' | 'queue' | 'waking' | 'failed' | 'resting';
export const BOOT_FACES: readonly BootFace[] = ['work', 'ask', 'rest', 'queue', 'waking', 'failed', 'resting'];

/** 다 안 돼도 이만큼이면 있는 것부터 보여 준다(사용자 '로딩이 영원히 안 끝나면 안 된다') */
export const BOOT_CAP_MS = 3000;
/** 재부팅으로 꺼진 참모가 깨울 차례로 위 띠에 남는 시간 — 데몬이 뜬 때부터. 11-17 00:32 실제 재부팅은 마지막 참모가 9분에 깼다 */
export const LOST_HOLD_MS = 15 * 60_000;

/**
 * 한 참모의 얼굴. 살아 있으면 그 상태가 먼저, 그다음 이어서 켜는 중, 켜기 실패, 재부팅으로 꺼짐(lost), 꺼진 목록 이유.
 * lost 가 꺼진 목록(stopped·done)보다 먼저 — 재부팅으로 꺼진 참모는 꺼진 목록에도 걸리지만 쉬는 칸으로 안 내려간다
 */
export function bootFace(o: { live?: { state: SessionState; awaiting?: boolean }; waking?: boolean; failed?: boolean; lost?: boolean; stopped?: StoppedSession['reason'] }): BootFace {
  if (o.live) return o.live.state === 'working' ? 'work' : o.live.state === 'blocked' ? 'ask' : 'rest';
  if (o.waking) return 'waking';
  if (o.failed) return 'failed';
  if (o.lost) return 'queue';
  if (o.stopped === 'failed') return 'failed';
  return 'resting';
}

/** 자리 — 쉬는 칸은 재워 둔 참모만, 나머지는 위 띠 제자리(재부팅으로 꺼진 참모는 고장이라 쉬는 칸으로 안 내려간다) */
export const bootPlace = (f: BootFace): 'top' | 'rest' => (f === 'resting' ? 'rest' : 'top');

const baseOf = (name: string) => splitOrchName(name).base;

/**
 * 재부팅으로 꺼진 참모(lost)를 먼저 가른다 — 위 띠 깨울 차례(lostTop)와 쉬는 칸(resting).
 * 같은 참모는 대화 id 가 같거나(이어서 켜기) 기본 이름이 같다(respawn·새로 띄움). 데몬이 뜬 지 LOST_HOLD_MS 가 지나도 안 깨운 참모는 쉬는 칸으로
 */
export function splitOff(o: { stopped: StoppedSession[]; lost: SnapSession[]; live: { name?: string; sessionId?: string }[]; now: number; daemonAt: number | null }): { lostTop: SnapSession[]; resting: StoppedSession[] } {
  const liveIds = new Set(o.live.map((s) => s.sessionId).filter(Boolean));
  const liveNames = new Set(o.live.map((s) => baseOf(s.name ?? '')));
  const fresh = o.daemonAt == null || o.now - o.daemonAt < LOST_HOLD_MS;
  const lostTop = fresh ? o.lost.filter((s) => !liveIds.has(s.sessionId) && !liveNames.has(baseOf(s.name))) : [];
  const ids = new Set(lostTop.map((s) => s.sessionId));
  const names = new Set(lostTop.map((s) => baseOf(s.name)));
  return { lostTop, resting: o.stopped.filter((s) => !ids.has(s.sessionId) && !names.has(baseOf(s.name))) };
}

/**
 * 위 띠 깨울 차례로 둘 꺼진 참모 — 한 번 본 lost 참모는 깰 때까지 남긴다. 자동 되살리기가 꺼진 맥에선 재시작 정리(triageLost)가
 * 참모를 기록에서 바로 빼고 깨우기는 useOrchRevive 가 하나씩 맡는데, 그사이 쉬는 칸으로 내려가 보였다(아이맥 실측 11-17). 살아나면 뺀다
 */
export function keepLost(prev: SnapSession[], lost: SnapSession[], live: { name?: string; sessionId?: string }[]): SnapSession[] {
  const ids = new Set(live.map((s) => s.sessionId).filter(Boolean));
  const names = new Set(live.map((s) => baseOf(s.name ?? '')).filter(Boolean));
  const up = (s: SnapSession) => ids.has(s.sessionId) || (!!s.name && names.has(baseOf(s.name)));
  const kept = prev.filter((s) => !up(s));
  const next = [...kept, ...lost.filter((s) => !up(s) && !kept.some((k) => k.sessionId === s.sessionId))];
  return next.length === prev.length && next.every((s, i) => s === prev[i]) ? prev : next;
}

/** 띠 줄(railRows)·깨우기(resumeSession)가 받는 꺼진 세션 모양으로 — 재부팅 기록(live.json)엔 짧은 번호·대화 id·폴더가 있다 */
export const lostAsStopped = (s: SnapSession): StoppedSession => ({ id: s.id ?? s.sessionId.slice(0, 8), sessionId: s.sessionId, name: s.name, cwd: s.cwd, project: '', workspace: null, reason: 'done', startedAt: s.startedAt ?? 0 });

/**
 * 점호를 걷을 때 — 데이터 넷(참모 목록·고정/순서/맡은 일·프사·꺼진 목록) + 고른 참모 대화 첫 쪽(채팅 칸이 있을 때)이 오고
 * 깨울 차례·깨는 중이 없으면 바로, 아니면 BOOT_CAP_MS 에. 못 깸은 기다리지 않는다(사람이 깨울 일)
 */
export function bootGate(o: { elapsed: number; data: { sessions: boolean; roles: boolean; avatars: boolean; all: boolean; chat: boolean }; faces: BootFace[]; noChat?: boolean; cap?: number }): { done: boolean; why: 'ready' | 'cap' | null } {
  const d = o.data;
  const dataReady = d.sessions && d.roles && d.avatars && d.all && (d.chat || !!o.noChat);
  const waiting = o.faces.some((f) => f === 'queue' || f === 'waking');
  if (dataReady && !waiting) return { done: true, why: 'ready' };
  if (o.elapsed >= (o.cap ?? BOOT_CAP_MS)) return { done: true, why: 'cap' };
  return { done: false, why: null };
}

/** 지난번 기억 — 다음 켤 때 첫 장면(index.html)·점호 줄을 바로 그리려고. localStorage BOOT_KEY */
export const BOOT_KEY = 'chammo.boot.v1';
export type BootChief = { key: string; name: string; label: string; color: string; shape: Shape; eyes: Eyes; face: BootFace };
export type BootMemo = { v: 1; at: number; chiefs: BootChief[] };
const MAX_CHIEFS = 20;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const str = (x: unknown, n: number) => (typeof x === 'string' && x.length > 0 && x.length <= n ? x : null);

/** 없거나 깨졌으면 null(첫 장면은 대표 캐릭터 하나). 참모마다 따져 이상한 참모만 버린다 — 색은 #rrggbb 만(그대로 style 에 들어간다) */
export function parseBootMemo(raw: string | null): BootMemo | null {
  if (!raw) return null;
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const m = o as Record<string, unknown>;
  if (m.v !== 1 || !Array.isArray(m.chiefs)) return null;
  const chiefs: BootChief[] = [];
  for (const c of m.chiefs as Record<string, unknown>[]) {
    if (!c || typeof c !== 'object') continue;
    const key = str(c.key, 120), name = str(c.name, 120), label = str(c.label, 60);
    if (!key || !name || !label || typeof c.color !== 'string' || !COLOR.test(c.color)) continue;
    if (!SHAPES.includes(c.shape as Shape) || !EYES.includes(c.eyes as Eyes) || !BOOT_FACES.includes(c.face as BootFace)) continue;
    chiefs.push({ key, name, label, color: c.color, shape: c.shape as Shape, eyes: c.eyes as Eyes, face: c.face as BootFace });
    if (chiefs.length >= MAX_CHIEFS) break;
  }
  return { v: 1, at: typeof m.at === 'number' ? m.at : 0, chiefs };
}

/**
 * 꺼진 목록(agents --all, 가장 늦게 온다)이 오기 전 쉬는 묶음 짐작 — 지난번 점호(위 띠·쉬는 묶음)에서 지금 위 띠에 선 참모(같은 대화·같은 이름)를 뺀 나머지.
 * 덮개가 꺼진 목록을 안 기다려서 지난번 쉬는 묶음을 그대로 쓰면 깨운 참모가 위·아래 둘 다 섰고, 그사이 재운 참모는 아무 데도 없었다(아이맥 실측 11-17)
 */
export function restGuess<T extends { key: string; name: string }>(rest: T[], top: { key: string; name: string }[]): T[] {
  if (!top.length) return rest;
  const keys = new Set(top.map((c) => c.key));
  const names = new Set(top.map((c) => c.name).filter(Boolean));
  const r = rest.filter((c) => !keys.has(c.key) && !names.has(c.name));
  return r.length === rest.length ? rest : r;
}

/** 얼굴 → 프사 상태·단계(ui/avatar OrchAvatar 가 그린다). 깨울 차례 = 감은 눈으로 바로 섬(queued), 깨는 중 = 켜는 중 얼굴(starting) */
export function faceLook(f: BootFace): { state: AvatarState; phase?: AvatarPhase } {
  switch (f) {
    case 'work': case 'ask': case 'rest': return { state: f };
    case 'queue': return { state: 'off', phase: 'queued' };
    case 'waking': return { state: 'off', phase: 'starting' };
    case 'failed': return { state: 'off', phase: 'failed' };
    default: return { state: 'off' };
  }
}

/** 첫 장면 줄 — 기억으로 그릴 때 살아 있던 참모도 아직 모르니 반쯤 눈 뜬 얼굴(깨는 중)로, 재워 둔 참모는 쉬는 묶음으로 */
export function memoRows(m: BootMemo | null): { top: BootChief[]; rest: BootChief[] } {
  if (!m) return { top: [], rest: [] };
  return { top: m.chiefs.filter((c) => c.face !== 'resting').map((c) => ({ ...c, face: c.face === 'failed' ? 'failed' : 'waking' })), rest: m.chiefs.filter((c) => c.face === 'resting') };
}
