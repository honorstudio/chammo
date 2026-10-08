// 폰에서 맥 부하 보기(사용자 2026-10-05 "PC 안 보면 왜 느린지 모르겠다") — 맥이 /api/load 로 주는 것을 머리줄 칩·시트로.
// 재료는 맥 앱이 잴 때마다 적는 load.json(domain/load summarize)과 scripts/slot 자리 파일. 보기만 — 끄기는 데스크톱 부하 화면에서
type Level = 'ok' | 'warn' | 'high';
type Summary = { at: string; cores: number; load1: number; swapUsedGb: number; level: Level; sessions: { name: string; project: string; cpu: number; mem: string; top: string[] }[]; rest?: { cpu: number; top: string[] } };

export type PhoneLoadSession = { name: string; project: string; cpu: number; mem: string; what: string };
export type SlotState = 'busy' | 'idle' | 'gone';
/** state·who = 쥔 세션이 바쁜지·그 세션 이름(맥 앱이 live.json 으로 붙인다, 세션을 모르면 null) */
export type PhoneSlot = { name: string; owner: string | null; min: number; over: boolean; state: SlotState | null; who: string | null };
export type PhoneLoad = {
  level: Level | 'unknown';
  label: string;
  load1: number;
  cores: number;
  swapGb: number;
  /** 맥 앱이 마지막으로 잰 지 몇 초(맥 시각 기준 — 폰 시계가 틀려도) */
  ageSec: number | null;
  /** 앱이 1분 넘게 안 적었다 — 맥 앱이 꺼졌거나 멈춤 */
  stale: boolean;
  sessions: PhoneLoadSession[];
  slots: PhoneSlot[];
  why: string;
};

const LABEL: Record<Level, string> = { ok: '보통', warn: '바쁨', high: '과부하' };
const SLOTS = ['build', 'ios', 'galaxy'];
const STALE_SEC = 90;
const STATE: Record<SlotState, string> = { busy: '바쁨', idle: '쉬는 중', gone: '세션 없음' };

/** "Gradle 16% 196MB" → "Gradle" */
const labelOf = (line: string) => line.replace(/\s+\d+%\s+\S+$/, '');
/** 세션 안에서 무거운 것 — Claude Code 자신은 늘 있으니 건너뛴다 */
const whatOf = (top: string[], project: string) => top.map(labelOf).find((l) => l !== 'Claude Code' && l !== project) ?? '';
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function whyOf(s: Summary, sessions: PhoneLoadSession[]): string {
  if (s.level === 'ok') return '여유 있어요';
  const top = sessions[0];
  const rest = s.rest && s.rest.top[0] ? s.rest : null;
  if (rest && rest.cpu > (top?.cpu ?? 0) && rest.cpu >= 50) return `세션 밖 ${labelOf(rest.top[0]!)} — CPU ${rest.cpu}%`;
  if (top && top.cpu >= 50) return `${top.name}${top.what ? ` · ${top.what}` : ''} — CPU ${top.cpu}%`;
  if (s.swapUsedGb >= 4) return `스왑 ${s.swapUsedGb}G — 메모리가 모자라요`;
  return top ? `${top.name} — CPU ${top.cpu}%` : '큰 원인을 못 찾았어요';
}

export function readPhoneLoad(text: string): PhoneLoad | null {
  let v: { now?: unknown; load?: Summary | null; slots?: Record<string, { owner?: string; ts?: number; since?: number; state?: unknown; who?: unknown } | null>; ttl?: Record<string, number> };
  try { v = JSON.parse(text); } catch { return null; }
  const now = num(v?.now);
  if (now === null) return null;
  const ttl = v.ttl ?? {};
  const slots = SLOTS.map((name) => {
    const h = v.slots?.[name];
    const ts = num(h?.ts);
    if (!h || typeof h.owner !== 'string' || ts === null) return { name, owner: null, min: 0, over: false, state: null, who: null };
    // 몇 분째는 처음 잡은 때(since)부터 — slot run 이 ts 를 계속 늘린다. 시간 넘음은 마지막으로 늘린 때(ts)로
    const age = Math.max(0, now - ts);
    const held = Math.max(0, now - (num(h.since) ?? ts));
    const state = typeof h.state === 'string' && h.state in STATE ? (h.state as SlotState) : null;
    return { name, owner: h.owner, min: Math.floor(held / 60), over: !!ttl[name] && age > ttl[name]!, state, who: typeof h.who === 'string' ? h.who : null };
  });
  const s = v.load;
  if (!s || num(s.load1) === null || num(s.cores) === null) {
    return { level: 'unknown', label: '모름', load1: 0, cores: 0, swapGb: 0, ageSec: null, stale: true, sessions: [], slots, why: '맥 앱이 아직 부하를 안 쟀어요' };
  }
  const at = Date.parse(s.at) / 1000;
  const ageSec = Number.isFinite(at) ? Math.max(0, Math.round(now - at)) : null;
  const sessions = (Array.isArray(s.sessions) ? s.sessions : []).slice(0, 5).map((x) => ({ name: x.name, project: x.project, cpu: x.cpu, mem: x.mem, what: whatOf(x.top ?? [], x.project) }));
  const level: Level = s.level in LABEL ? s.level : 'ok';
  return {
    level,
    label: LABEL[level],
    load1: s.load1,
    cores: s.cores,
    swapGb: num(s.swapUsedGb) ?? 0,
    ageSec,
    stale: ageSec === null || ageSec > STALE_SEC,
    sessions,
    slots,
    why: whyOf({ ...s, level }, sessions),
  };
}

/** 머리줄 칩 — 점 하나 + 1분 부하. 낡았으면 회색(지금 값이 아니다) */
export function loadChip(v: PhoneLoad | null): { cls: string; text: string; aria: string } | null {
  if (!v || v.level === 'unknown') return null;
  const text = v.load1 >= 10 ? String(Math.round(v.load1)) : v.load1.toFixed(1);
  return { cls: v.stale ? 'ld-unknown' : `ld-${v.level}`, text, aria: `맥 부하 ${v.stale ? '(오래된 값) ' : ''}${v.label} — ${text}, 코어 ${v.cores}개` };
}

/** 부하 시트 자리 줄 글 — 주인 · 바쁨/쉬는 중/세션 없음 · 몇 분 · 쥔 세션. 줄이 좁아 말줄임되니 긴 세션 이름을 맨 뒤에 */
export function slotLine(s: PhoneSlot): string {
  if (!s.owner) return '비어 있음';
  return [s.owner, s.state && STATE[s.state], `${s.min}분`, s.over && '시간 넘음', s.who].filter(Boolean).join(' · ');
}
