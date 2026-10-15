// 애니메이션 줄이기 판단(2026-10-12 사용자 "부하 심해지면 애니메이션 때문에 끊긴다 — 자동으로 최소화 + 설정에서 없애기").
// 단계: full(그대로) · reduce(도는 움직임 멈춤 + 전환 짧게) · off(움직임 0). 화면에 거는 건 ui/calm
import type { Animation } from './config';

export type Calm = 'full' | 'reduce' | 'off';

/** 1분 부하/코어 — 이 이상이 ON_MS 이어지면 줄이기. 실측(30분·142표본, 화면 밖 WKWebView 프레임 늦음): 2~4 정상, 4~10 자주 끊김, 10↑ 거의 멈춤.
 *  화면 밖 창은 앞에 있는 앱보다 우선순위가 낮아 숫자가 나쁘게 나와서 끊기기 시작하는 4 대신 8(이 맥 10코어 = 1분 부하 80). CPU 사용률 합은 60~90% 에 몰려 못 가른다 */
export const HOT_ON = 8;
/** 이 밑이 OFF_MS 이어지면 푼다 — 사이(6~8)는 그대로(깜빡이지 않게) */
export const HOT_OFF = 6;
const ON_MS = 10_000;
const OFF_MS = 30_000;

/** hot = 지금 줄이는 중, since = 반대쪽 조건이 처음 보인 때(이어지는지 잰다) */
export type HotState = { hot: boolean; since: number | null };

/** 부하를 한 번 잴 때마다(앱이 이미 읽는 부하 주기 — 새 폴링 없음) */
export function stepHot(st: HotState, s: { load1: number; cores: number } | null, now: number): HotState {
  if (!s || !(s.cores > 0) || !Number.isFinite(s.load1)) return st;
  const per = s.load1 / s.cores;
  const flip = st.hot ? per < HOT_OFF : per >= HOT_ON;
  if (!flip) return st.since === null ? st : { hot: st.hot, since: null };
  const since = st.since ?? now;
  return now - since >= (st.hot ? OFF_MS : ON_MS) ? { hot: !st.hot, since: null } : { hot: st.hot, since };
}

/** 설정 + OS '동작 줄이기' + 부하 → 단계. 자동은 OS 동작 줄이기나 부하 높음이면 줄이기 */
export function calmOf(setting: Animation, osReduce: boolean, hot: boolean): Calm {
  if (setting === 'off') return 'off';
  if (setting === 'reduce') return 'reduce';
  return osReduce || hot ? 'reduce' : 'full';
}

/** 줄이기의 '전환 짧게' — 'transition-duration' 목록에서 maxS 넘는 것만 maxS 로. 바꿀 게 없으면 null(ui/calm 이 덮개 규칙을 안 만든다) */
export function capDurations(v: string, maxS = 0.1): string | null {
  if (!v.trim()) return null;
  let changed = false;
  const out = v.split(',').map((x) => {
    const t = x.trim();
    const m = t.match(/^(-?[\d.]+)(m?s)$/);
    if (!m) return t;
    const sec = Number(m[1]) / (m[2] === 'ms' ? 1000 : 1);
    if (sec <= maxS) return t;
    changed = true;
    return `${maxS}s`;
  });
  return changed ? out.join(', ') : null;
}
