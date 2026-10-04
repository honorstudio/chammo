// Claude 사용 한도(5시간·주간) — 상태줄 스크립트가 받은 값을 ~/.honor-orchestrator/statusline.json 에 남기고 앱이 읽는다.
// Claude Code 가 주는 건 five_hour · seven_day 두 개뿐이다(2026-09-27 실측). 모델별(Fable) 한도는 여기 없다.
import { tr } from '../i18n';

export type Limit = { left: number; resetIn: number | null };
export type Usage = { five?: Limit; week?: Limit };

type RawLimit = { used_percentage?: number; resets_at?: number };

const limit = (r: RawLimit | undefined, now: number): Limit | undefined =>
  r?.used_percentage == null
    ? undefined
    : { left: 100 - Math.round(r.used_percentage), resetIn: r.resets_at == null ? null : Math.round(r.resets_at - now / 1000) };

export function parseUsage(json: string, now: number): Usage {
  let d: { rate_limits?: { five_hour?: RawLimit; seven_day?: RawLimit } };
  try {
    d = JSON.parse(json);
  } catch {
    return {};
  }
  const out: Usage = {};
  const five = limit(d.rate_limits?.five_hour, now);
  const week = limit(d.rate_limits?.seven_day, now);
  if (five) out.five = five;
  if (week) out.week = week;
  return out;
}

/** 남은 % 막대 색 — 50% 이상 넉넉, 20% 이상 보통, 그 아래 모자람(위 막대·계정 팝오버가 같이 쓴다) */
export const usageLevel = (left: number) => (left >= 50 ? 'ok' : left >= 20 ? 'mid' : 'low');

export function fmtResetIn(sec: number): string {
  if (sec <= 0) return tr('곧', 'soon');
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return tr(`${d}일 ${h}시간`, `${d}d ${h}h`);
  if (h > 0) return tr(`${h}시간 ${m}분`, `${h}h ${m}m`);
  return tr(`${m}분`, `${m}m`);
}

const DAY_START_HOUR = 5;
const pad = (n: number) => String(n).padStart(2, '0');

/** "오늘"의 시작 시각(로컬). git --since 에 그대로 넘긴다. 자정을 넘겨 일해도 새벽 5시 전까진 같은 날 */
export function dayStart(now: Date): string {
  const d = new Date(now);
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(DAY_START_HOUR)}:00`;
}
