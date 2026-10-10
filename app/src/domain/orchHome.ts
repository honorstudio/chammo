// 오케스트레이터 홈 — 참모가 하나도 안 떠 있을 때(또는 사이드바 '오케스트레이터' 머리를 누르면) 어떤 참모를 켤지 고르는 화면.
// 앱이 스스로 참모를 새로 만들거나 켜지 않는다 — 사람이 고를 때만(2026-10-03 사용자)
import type { Activity } from './activity';
import type { Session } from './session';
import type { StoppedSession } from './stopped';
import { tr } from '../i18n';

/** 채팅 뷰 스페이스에서 홈 화면 키(SpaceView pick) */
export const HOME_PICK = 'oh:';

export type HomeRow = { key: string; live?: Session; off?: StoppedSession; /** 마지막으로 일한 때(ms) */ lastAt: number; /** 마지막에 하던 일 한 줄 */ doing: string; ctx?: number };

/** 참모가 0개면 늘, 떠 있으면 머리를 눌렀을 때만 */
export function showHome(o: { live: number; picked: boolean }): boolean {
  return o.live === 0 || o.picked;
}

const at = (ts: string | undefined) => { const n = ts ? Date.parse(ts) : NaN; return Number.isFinite(n) ? n : 0; };
const oneLine = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
/** 사람이 건 지시가 아닌 줄 — Claude Code 가 끊김을 user 줄로 남긴다 */
const notAsk = (t: string) => /^\[Request interrupted/.test(t);

type CtxFile = { used: number; ts?: number; modelId?: string; size?: number };
/** 모델 → 창 크기 — 상태줄 파일들에서(기록엔 [1m] 같은 창 크기가 안 남는다). 모르는 모델은 짐작하지 않는다 */
const windowSizes = (ctx: Record<string, CtxFile>) => new Map(Object.values(ctx).filter((c) => c.modelId && c.size).map((c) => [c.modelId!, c.size!]));

function rowOf(key: string, sid: string | undefined, startedAt: number, activity: Record<string, Activity>, ctx: Record<string, CtxFile>, sizes: Map<string, number>): Omit<HomeRow, 'live' | 'off'> {
  const a = sid ? activity[sid] : undefined;
  // 이어 켜기만 하고 일을 안 시켰으면 기록이 옛 시각 그대로 — 마지막으로 켠 때(세션 시작)도 같이 본다
  const last = Math.max(at(a?.prompt?.ts), at(a?.peer?.ts), at(a?.reply?.ts), at(a?.tool?.ts), startedAt);
  // 하던 일 = 사람 지시와 다른 세션이 SendMessage 로 건 말 중 늦은 것(끊김 표시는 거름) — 없으면 마지막 답
  const asked = [a?.prompt, a?.peer].filter((l): l is NonNullable<typeof l> => !!l && !!oneLine(l.text) && !notAsk(oneLine(l.text))).sort((x, y) => at(y.ts) - at(x.ts))[0];
  // 상태줄 파일이 없는 대화(상태줄이 안 돈 옛 대화)는 기록의 마지막 토큰 ÷ 같은 모델 창 크기
  const size = a?.model ? sizes.get(a.model) : undefined;
  const est = a?.tokens && size ? Math.min(100, Math.round((a.tokens / size) * 100)) : undefined;
  return { key, lastAt: last, doing: oneLine(asked?.text) || oneLine(a?.reply?.text), ctx: (sid ? ctx[sid]?.used : undefined) ?? est };
}

/** 켜진 참모 = 받은 순서 그대로, 꺼진 참모 = 마지막으로 일한 때 최근 순 */
export function homeRows(o: { live: Session[]; off: StoppedSession[]; activity: Record<string, Activity>; ctx: Record<string, CtxFile> }): { live: HomeRow[]; off: HomeRow[] } {
  const sizes = windowSizes(o.ctx);
  return {
    live: o.live.map((s) => ({ ...rowOf(s.sessionId ?? s.id, s.sessionId, s.startedAt, o.activity, o.ctx, sizes), live: s })),
    off: o.off.map((s) => ({ ...rowOf(s.sessionId, s.sessionId, s.startedAt, o.activity, o.ctx, sizes), off: s })).sort((a, b) => b.lastAt - a.lastAt),
  };
}

export type HomeAction = { kind: 'go'; id: string } | { kind: 'resume'; session: StoppedSession };
/** 줄을 누르면 — 켜진 참모는 그리로, 꺼진 참모는 그 세션만 이어서 켠다 */
export function homeAction(r: HomeRow): HomeAction {
  return r.live ? { kind: 'go', id: r.live.id } : { kind: 'resume', session: r.off! };
}

/** 이어서 켠 대화(sessionId)가 살아 있는 목록에 떴으면 그 세션 id — 되살려도 같은 sessionId 다(respawn) */
export function resumedOrch(sessionId: string | null, live: Session[]): string | undefined {
  if (!sessionId) return undefined;
  return live.find((s) => s.sessionId === sessionId)?.id;
}

const dayStart = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** 방금 · N분 전 · N시간 전(오늘) · 어제 · N일 전(일주일 안) · M월 D일 */
export function whenLabel(ms: number, now: number): string {
  if (!ms) return '';
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return tr('방금', 'just now');
  if (s < 3600) return tr(`${Math.floor(s / 60)}분 전`, `${Math.floor(s / 60)}m ago`);
  const days = Math.round((dayStart(now) - dayStart(ms)) / 86_400_000);
  if (days <= 0) return tr(`${Math.floor(s / 3600)}시간 전`, `${Math.floor(s / 3600)}h ago`);
  if (days === 1) return tr('어제', 'yesterday');
  if (days < 7) return tr(`${days}일 전`, `${days}d ago`);
  const d = new Date(ms);
  return tr(`${d.getMonth() + 1}월 ${d.getDate()}일`, d.toLocaleDateString('en', { month: 'short', day: 'numeric' }));
}
