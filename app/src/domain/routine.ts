// 예약(반복·한 번) — 정해진 때 깨어나 지침서(ROUTINE.md)대로 한 번 일하고 결과를 남긴다. 실행·예약은 scripts/routine(launchd).
// 화면 이름은 '예약'(2026-10-02), 코드·파일·명령은 옛 이름 routine 그대로
import { tr } from '../i18n';

export type RoutineEvent = { event: 'start' | 'end' | 'skip'; ts: string; result?: 'ok' | 'fail'; note?: string; session?: string | null; reason?: string; error?: string | null };
export type Routine = {
  name: string;
  /** local = 이 맥 launchd · cloud = claude.ai 클라우드 루틴(<데이터>/cloud-routines.json, 목록에만). 옛 스크립트는 안 줘서 없으면 local */
  kind?: 'local' | 'cloud';
  /** 클라우드 루틴 — claude.ai 에서 여는 주소와 한 줄 메모 */
  url?: string;
  note?: string;
  schedule: string;
  cwd: string;
  enabled: boolean;
  instructions: string;
  next: string | null;
  /** 한 번짜리(날짜) 예약인가 · 아직 안 온 실행 수 · 마지막 날짜까지 다 돌아 스스로 꺼진 시각 */
  once?: boolean;
  remaining?: number | null;
  finished?: string | null;
  last: RoutineEvent | null;
  lastStart: RoutineEvent | null;
  runs: RoutineEvent[];
};

export function parseRoutines(json: string): Routine[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as Routine[]) : [];
  } catch {
    return [];
  }
}

export const isCloud = (r: Routine) => r.kind === 'cloud';

/** 클라우드 루틴을 브라우저로 열 주소 — https 만(목록 파일은 손으로도 고칠 수 있어서 다시 거른다) */
export const cloudUrl = (r: Routine): string | null => (isCloud(r) && typeof r.url === 'string' && r.url.startsWith('https://') ? r.url : null);

/** running 도는 중 · failed 실패 · ok 성공 · noReport 시작했는데 보고 없이 끝남 · paused 꺼 둠 · waiting 아직 안 돌아 봄
 *  · done 한 번짜리가 마지막 날짜까지 다 돌아 스스로 꺼짐 · cloud claude.ai 가 돌림(여기선 모름) */
export type RoutineState = 'running' | 'failed' | 'ok' | 'noReport' | 'paused' | 'waiting' | 'done' | 'cloud';

export function routineState(r: Routine, sessions: { name: string; state: string }[]): RoutineState {
  if (isCloud(r)) return 'cloud';
  if (sessions.some((s) => s.name === `routine-${r.name}` && s.state === 'working')) return 'running';
  if (r.finished) {
    if (r.lastStart && (!r.last || r.last.ts < r.lastStart.ts)) return 'noReport';
    return r.last?.result === 'fail' ? 'failed' : 'done';
  }
  if (!r.enabled) return 'paused';
  if (!r.lastStart) return 'waiting';
  if (!r.last || r.last.ts < r.lastStart.ts) return 'noReport';
  return r.last.result === 'fail' ? 'failed' : 'ok';
}

export const routineStateLabel = (s: RoutineState) =>
  ({
    running: tr('도는 중', 'Running'),
    failed: tr('실패', 'Failed'),
    ok: tr('성공', 'OK'),
    noReport: tr('보고 없음', 'No report'),
    paused: tr('꺼 둠', 'Paused'),
    waiting: tr('첫 실행 전', 'Not run yet'),
    done: tr('끝남', 'Finished'),
    cloud: tr('클라우드', 'Cloud'),
  })[s];

// 'YYYY-MM-DDTHH:MM(:SS)' 를 맥 시계 그대로(시간대 변환 없이) 쪼갠다
const parts = (ts: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(ts);
  return m ? { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), h: Number(m[4]), mi: Number(m[5]), s: +(m[6] ?? 0) } : null;
};
const p2 = (n: number) => String(n).padStart(2, '0');
const sameDay = (a: Date, y: number, mo: number, d: number) => a.getFullYear() === y && a.getMonth() + 1 === mo && a.getDate() === d;

/** 날짜·시각을 짧게 — 올해면 "10/06 09:00", 다른 해면 "2027-01-05 09:00" */
function shortWhen(ts: string, now: Date): string {
  const t = parts(ts);
  if (!t) return ts;
  const md = `${p2(t.mo)}/${p2(t.d)} ${p2(t.h)}:${p2(t.mi)}`;
  return t.y === now.getFullYear() ? md : `${t.y}-${p2(t.mo)}-${p2(t.d)} ${p2(t.h)}:${p2(t.mi)}`;
}

/** 다음 실행을 사람 말로 — "오늘 16:00" · "내일 08:30" · "10/05 09:00" */
function relWhen(ts: string, now: Date): string {
  const t = parts(ts);
  if (!t) return ts;
  const hm = `${p2(t.h)}:${p2(t.mi)}`;
  if (sameDay(now, t.y, t.mo, t.d)) return tr(`오늘 ${hm}`, `today ${hm}`);
  const tmr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (sameDay(tmr, t.y, t.mo, t.d)) return tr(`내일 ${hm}`, `tomorrow ${hm}`);
  return shortWhen(ts, now);
}

/** 사이드바 첫째 줄 이름 옆 상태 글자 — "도는 중 12분" · "끝 08:31" · "실패" · "끝남" … */
export function routineStatus(r: Routine, s: RoutineState, now: Date = new Date()): string {
  if (s === 'running') {
    const t = r.lastStart && parts(r.lastStart.ts);
    if (!t) return routineStateLabel(s);
    const min = Math.max(1, Math.round((now.getTime() - new Date(t.y, t.mo - 1, t.d, t.h, t.mi, t.s).getTime()) / 60000));
    return tr(`도는 중 ${min}분`, `Running ${min} min`);
  }
  if (s === 'ok' && r.last) {
    const t = parts(r.last.ts);
    if (t) {
      const at = sameDay(now, t.y, t.mo, t.d) ? `${p2(t.h)}:${p2(t.mi)}` : `${p2(t.mo)}/${p2(t.d)}`;
      return tr(`끝 ${at}`, `Done ${at}`);
    }
  }
  return routineStateLabel(s);
}

/** 사이드바 둘째 줄 — 반복은 "매일 08:30 · 다음 내일 08:30", 한 번짜리는 "10/06 09:00 · 한 번 · 남은 2번",
 *  클라우드는 "일정 · 메모"(상태는 claude.ai 에 있다) */
export function routineLine(r: Routine, now: Date = new Date()): string {
  if (isCloud(r)) return [scheduleText(r.schedule, now), r.note?.trim()].filter(Boolean).join(' · ');
  if (r.once) {
    const at = r.next ?? lastDate(r.schedule);
    const left = r.remaining ?? 0;
    return [at ? shortWhen(at, now) : scheduleText(r.schedule, now), tr('한 번', 'once'), left > 1 ? tr(`남은 ${left}번`, `${left} left`) : '']
      .filter(Boolean).join(' · ');
  }
  return r.next ? `${scheduleText(r.schedule, now)} · ${tr(`다음 ${relWhen(r.next, now)}`, `next ${relWhen(r.next, now)}`)}` : scheduleText(r.schedule, now);
}

const DATED = /^(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})\/(\d{1,2}))\s+(\d{1,2}):(\d{2})$/;
const datedList = (s: string) => {
  const xs = s.split(',').map((x) => DATED.exec(x.trim()));
  return xs.length > 0 && xs.every(Boolean) ? (xs as RegExpExecArray[]) : null;
};
/** 날짜 일정의 마지막 날짜(연도가 박힌 것만 — 스크립트가 만들 때 박는다) */
function lastDate(s: string): string | null {
  const xs = datedList(s.trim());
  const full = xs?.filter((m) => m[1]).map((m) => `${m[1]}-${p2(Number(m[2]))}-${p2(Number(m[3]))}T${p2(Number(m[6]))}:${m[7]}`).sort();
  return full?.at(-1) ?? null;
}

/** 다 끝난 한 번짜리는 '끝난 예약 N개'로 접고, 나머지는 도는 중 → 실패·보고 없음 → 다음 실행 가까운 순 */
export type RoutineItem = { name: string; state: RoutineState; status: string; line: string; cloud: boolean; next: string | null;
  /** 채팅에 끌어다 넣을 참조 글 */
  ref: string };

/** 채팅 참조 글 — 예약을 참모 입력칸에 끌어다 넣거나 '채팅에 붙이기'로(파일 참조처럼, 2026-10-02 사용자) */
export function routineRef(r: Routine, now: Date = new Date()): string {
  const when = `${scheduleText(r.schedule, now)}${r.once ? ' 한 번' : ''}`;
  return isCloud(r) ? `[클라우드 예약 ${r.name} · ${when} · ${r.url ?? ''}]` : `[예약 ${r.name} · ${when} · 폴더 ${r.cwd} · 지침서 ${r.instructions}]`;
}

export function routineItem(r: Routine, sessions: { name: string; state: string }[], now: Date = new Date()): RoutineItem {
  const state = routineState(r, sessions);
  return { name: r.name, state, status: routineStatus(r, state, now), line: routineLine(r, now), cloud: isCloud(r), next: r.next, ref: routineRef(r, now) };
}

export function groupRoutines<T extends { name: string; state: RoutineState; next: string | null }>(xs: T[]): { active: T[]; done: T[] } {
  const rank = (s: RoutineState) => (s === 'running' ? 0 : s === 'failed' || s === 'noReport' ? 1 : 2);
  const active = xs.filter((x) => x.state !== 'done').sort((a, b) =>
    rank(a.state) - rank(b.state) || (a.next ?? '\uffff').localeCompare(b.next ?? '\uffff') || a.name.localeCompare(b.name));
  return { active, done: xs.filter((x) => x.state === 'done') };
}

/** "daily 09:00" → "매일 09:00", "2026-10-06 09:00, 2026-10-13 09:00" → "10/06 09:00, 10/13 09:00" 처럼 사람 말로(모르는 모양이면 그대로) */
export function scheduleText(s: string, now: Date = new Date()): string {
  const t = s.trim();
  const dated = datedList(t);
  if (dated) {
    return dated.map((m) => {
      const [mo, d, hm] = [p2(Number(m[2] ?? m[4])), p2(Number(m[3] ?? m[5])), `${p2(Number(m[6]))}:${m[7]}`];
      return m[1] && Number(m[1]) !== now.getFullYear() ? `${m[1]}-${mo}-${d} ${hm}` : `${mo}/${d} ${hm}`;
    }).join(', ');
  }
  let m = /^(?:daily|매일)\s+(\d{1,2}:\d{2})$/i.exec(t);
  if (m) return tr(`매일 ${m[1]}`, `Every day ${m[1]}`);
  m = /^(?:weekdays|평일)\s+(\d{1,2}:\d{2})$/i.exec(t);
  if (m) return tr(`평일 ${m[1]}`, `Weekdays ${m[1]}`);
  m = /^(?:weekly|매주)\s+(\S+)\s+(\d{1,2}:\d{2})$/i.exec(t);
  if (m) return tr(`매주 ${m[1]} ${m[2]}`, `Weekly ${m[1]} ${m[2]}`);
  m = /^every\s+(\d+)\s*([mh])$/i.exec(t) ?? /^(\d+)\s*(분|시간)마다$/.exec(t);
  if (m) {
    const min = m[2] === 'm' || m[2] === '분';
    return tr(`${m[1]}${min ? '분' : '시간'}마다`, `Every ${m[1]}${min ? ' min' : ' h'}`);
  }
  return t;
}

/** 폰 예약 판 맨 위 요약 — "예약 12개 · 다음 내일 07:30 docs-sync". 다음 실행은 켜 둔 이 맥 예약 중 가장 가까운 것(클라우드는 claude.ai 가 돌려 뺀다) */
export function routineSummary(rs: Routine[], now: Date = new Date()): string {
  if (!rs.length) return tr('예약 없음', 'No routines');
  const soon = rs.filter((r) => r.enabled && !isCloud(r) && r.next).sort((a, b) => (a.next! < b.next! ? -1 : 1))[0];
  const head = tr(`예약 ${rs.length}개`, `${rs.length} routines`);
  return soon ? `${head} · ${tr(`다음 ${relWhen(soon.next!, now)} ${soon.name}`, `next ${relWhen(soon.next!, now)} ${soon.name}`)}` : `${head} · ${tr('다음 실행 없음', 'nothing scheduled')}`;
}
