// 팀 성능 예산 넘침 알림(10-31 사용자 '사람이 캡처를 보내기 전에 알아채게') — Rust 가 쌓은 알림(team_relay::take_alerts)을
// '앱 업데이트·참모 앱' 맡은 참모(없으면 첫 참모) 입력칸에 [앱] 한 줄로. 같은 원인은 하루 한 번
import { tr } from '../i18n';
import type { RoleMap } from './orchRoles';

/** bg-cap = 배경 요청이 10분 칸 몫(200)을 처음 넘음(detail = 경로별 셈) · human-429 = 사람 동작이 서버 429(detail = 경로) */
export type PerfAlert = { kind: string; detail: string; at: number };

const APP_ROLE = /앱 업데이트|참모 앱|chammo ?앱|app updates?/i;

/** 받을 참모 — 맡은 일이 앱 업데이트·참모 앱인 참모, 없으면 첫 참모 */
export function alertTarget<T extends { id: string; name: string }>(orchs: T[], roles: RoleMap): T | undefined {
  return orchs.find((o) => APP_ROLE.test(roles[o.name]?.role ?? '')) ?? orchs[0];
}

/** 원인 = 종류 + 가장 많은 경로(숫자 뺌) + 날짜(로컬) — 하루 한 번 */
export function alertKey(a: PerfAlert): string {
  const top = (a.detail.split(' · ')[0] ?? '').replace(/^(막힘|사람) /, '').replace(/ \d+$/, '');
  const d = new Date(a.at);
  return `${a.kind}|${top}|${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 참모 입력칸에 넣을 한 줄(Enter 로 보내져서 줄바꿈 없이) */
export function alertLine(a: PerfAlert): string {
  const detail = a.detail.replace(/\s+/g, ' ').slice(0, 300);
  return a.kind === 'human-429'
    ? tr(`[앱] 팀 성능 예산 넘침: 사람 동작이 중계 429(잠시 쉬래요)를 받았어 — ${detail}. perf-budget 스킬로 어느 길이 몫을 먹는지(notify.log 경로별 셈) 보고 원인·고칠 안을 정리해 줘`,
      `[app] Team performance budget exceeded: a person's action got relay 429 (slow down) — ${detail}. Use the perf-budget skill to find which path eats the budget (per-path counts in notify.log) and write up cause and fix`)
    : tr(`[앱] 팀 성능 예산 넘침: 배경 요청이 10분 몫(200)을 넘었어 — 경로별 ${detail}. perf-budget 스킬로 원인·고칠 안을 정리해 줘`,
      `[app] Team performance budget exceeded: background requests passed the 10-minute share (200) — by path ${detail}. Use the perf-budget skill to write up cause and fix`);
}

/** 알림 보내기 — 보내기에 성공한 원인만 seen(하루 한 번)에 넣고, 받을 참모가 없거나 못 보낸 알림은 left 로 돌려 다음 바퀴에 다시.
 *  Rust 줄(perf_alerts)은 가져가는 순간 비어서 여기서 놓치면 사라진다(10-31 리뷰). left 는 최근 20개까지 */
export async function deliverAlerts(list: PerfAlert[], seen: string[], to: { id: string } | undefined, send: (id: string, line: string) => Promise<unknown>): Promise<{ seen: string[]; left: PerfAlert[] }> {
  const out = [...seen];
  const left: PerfAlert[] = [];
  for (const a of list) {
    const key = alertKey(a);
    if (out.includes(key)) continue;
    if (!to) { left.push(a); continue; }
    try {
      await send(to.id, alertLine(a));
      out.push(key);
    } catch {
      left.push(a);
    }
  }
  return { seen: out, left: left.slice(-20) };
}
