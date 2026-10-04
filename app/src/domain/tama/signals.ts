// '끝낸 일' 먹이 출처 — 참모가 이미 적고 있는 기록(show.jsonl·대화 기록·예약 실행·space-log)을 TamaEvent 로.
// 개발 안 하는 사람도 똑같이 키우게(2026-10-03 사용자, 시안 docs/design-drafts/tama-v2 v1 F). 상한·같은 일 거르기는 sources.balanceFeed
import type { Routine } from '../routine';
import type { TamaEvent } from './pet';

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p;

function jsonLines<T>(raw: string): T[] {
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as T); } catch { /* 깨진 줄은 건너뛴다 */ }
  }
  return out;
}

/** scripts/show 로 띄운 파일 = 결과물(특식). by = 띄운 세션 id */
export function showFeed(raw: string): TamaEvent[] {
  return jsonLines<{ ts?: string; path?: string; from?: string }>(raw).flatMap((r) => {
    const t = Date.parse(r.ts ?? '');
    return r.path && Number.isFinite(t) ? [{ t, type: 'show' as const, label: base(r.path), ...(r.from ? { by: r.from } : {}) }] : [];
  });
}

/** Rust `human_turns` 원문(`세션 id\t시각` 줄) = 사람이 세션에 건 말(간식) */
export function talkFeed(raw: string): TamaEvent[] {
  return raw.split('\n').flatMap((line) => {
    const [by, ts] = line.split('\t');
    const t = Date.parse(ts ?? '');
    return by && Number.isFinite(t) ? [{ t, type: 'talk' as const, by }] : [];
  });
}

/** 예약이 돌고 보고한 것 = 끼니 + 배틀(성공 = 승) */
export function routineFeed(routines: Routine[]): TamaEvent[] {
  return routines.flatMap((r) =>
    (r.runs ?? []).flatMap((e) => {
      const t = Date.parse(e.ts);
      return e.event === 'end' && (e.result === 'ok' || e.result === 'fail') && Number.isFinite(t) ? [{ t, type: 'routine' as const, pass: e.result === 'ok', label: r.name }] : [];
    }),
  );
}

/** space-log.jsonl — 문서 고침 = 목욕, 시안 검토 보냄 = 놀아주기, 스페이스에서 참모에게 보냄 = 대화 */
export function spaceFeed(raw: string): TamaEvent[] {
  return jsonLines<{ ts?: string; kind?: string; path?: string }>(raw).flatMap((r): TamaEvent[] => {
    const t = Date.parse(r.ts ?? '');
    if (!Number.isFinite(t)) return [];
    if (r.kind === 'edit' && r.path) return [{ t, type: 'doc', label: base(r.path) }];
    if (r.kind === 'review' && r.path) return [{ t, type: 'review', label: base(r.path) }];
    if (r.kind === 'send') return [{ t, type: 'talk' }];
    return [];
  });
}

/** 돌보는 참모 — 마지막으로 먹이를 준 참모(메아리 빼고). 아무도 안 먹였으면 첫 참모. 펫은 하나, 돌보는 참모는 여럿(시안 B) */
export function keeperOf(events: TamaEvent[], orchIds: string[]): string | null {
  let best: { t: number; by: string } | null = null;
  for (const e of events) if (!e.echo && e.by && orchIds.includes(e.by) && (!best || e.t > best.t)) best = { t: e.t, by: e.by };
  return best?.by ?? orchIds[0] ?? null;
}

/** 오늘(새벽 5시부터) 먹은 것 — 최근 먼저. 일한 시간(훈련)과 메아리는 먹은 게 아니라 뺀다 */
export function todayFed(events: TamaEvent[], now: number): TamaEvent[] {
  const d = new Date(now - 5 * 3_600_000);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 5).getTime();
  return events.filter((e) => e.t >= start && e.t <= now && !e.echo && e.type !== 'work').sort((a, b) => b.t - a.t);
}
