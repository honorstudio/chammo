// 루틴(반복 업무) — 정해진 때 깨어나 지침서(ROUTINE.md)대로 한 번 일하고 결과를 남긴다. 실행·예약은 scripts/routine(launchd)
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

/** running 도는 중 · failed 실패 · ok 성공 · noReport 시작했는데 보고 없이 끝남 · paused 꺼 둠 · waiting 아직 안 돌아 봄 · cloud claude.ai 가 돌림(여기선 모름) */
export type RoutineState = 'running' | 'failed' | 'ok' | 'noReport' | 'paused' | 'waiting' | 'cloud';

export function routineState(r: Routine, sessions: { name: string; state: string }[]): RoutineState {
  if (isCloud(r)) return 'cloud';
  if (sessions.some((s) => s.name === `routine-${r.name}` && s.state === 'working')) return 'running';
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
    cloud: tr('클라우드', 'Cloud'),
  })[s];

/** 사이드바 둘째 줄 — 로컬은 "일정 · 상태", 클라우드는 "일정 · 메모"(상태는 claude.ai 에 있다) */
export const routineLine = (r: Routine, s: RoutineState) =>
  isCloud(r) ? [scheduleText(r.schedule), r.note?.trim()].filter(Boolean).join(' · ') : `${scheduleText(r.schedule)} · ${routineStateLabel(s)}`;

/** "daily 09:00" → "매일 09:00" 처럼 사람 말로(모르는 모양이면 그대로) */
export function scheduleText(s: string): string {
  const t = s.trim();
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
