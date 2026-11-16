// 맥 메모리 위험 알림(2026-11-16 — 한 세션의 jest 워커 9개가 21GB 를 먹어 맥이 멈추고 강제 재부팅).
// 부하 모니터(ui/useLoad)가 10초마다 재는 세션별 메모리로 — 세션 하나가 8GB(맥이 압박 중이면 4GB)를 넘으면 맡긴 참모에게 [앱] 한 줄.
// 끄지는 않는다(빌드·시험을 사람 모르게 죽이지 않게) — 참모가 그 세션에 줄이라고 시킨다. 참모 브라우저는 래퍼가 스스로 낮춘다(memcap)
import { tr } from '../i18n';
import { procLabel, type LoadReport, type SessionLoad, type SysLoad } from './load';

const KB_GB = 1024 * 1024;
export const SESSION_GB = 8;
export const PRESSED_GB = 4;

export type MemAlert = { id: string; name: string; gb: number; what: string };

const pressed = (s: SysLoad) => (s.memPressure ?? 1) >= 2 || (s.memFreePct ?? 100) <= 15;

/** 큰 것 이름 — 같은 이름끼리 더해 큰 순 2개("jest-worker ×2 4.8GB") */
function whatOf(s: SessionLoad): string {
  const by = new Map<string, { n: number; kb: number }>();
  for (const p of s.top) {
    const k = procLabel(p.cmd);
    const v = by.get(k) ?? { n: 0, kb: 0 };
    by.set(k, { n: v.n + 1, kb: v.kb + p.rssKb });
  }
  return [...by.entries()].sort((a, b) => b[1].kb - a[1].kb).slice(0, 2)
    .map(([k, v]) => `${k}${v.n > 1 ? ` ×${v.n}` : ''} ${(v.kb / KB_GB).toFixed(1)}GB`).join(', ');
}

export function memAlerts(sys: SysLoad, r: LoadReport): MemAlert[] {
  const min = pressed(sys) ? PRESSED_GB : SESSION_GB;
  return r.sessions.filter((s) => s.rssKb / KB_GB >= min).map((s) => ({ id: s.id, name: s.name || s.project || s.id, gb: s.rssKb / KB_GB, what: whatOf(s) }));
}

/** 참모 입력칸 한 줄 */
export function memAlertLine(a: MemAlert, sys: SysLoad): string {
  const free = sys.memFreePct != null ? tr(` · 맥 메모리 여유 ${sys.memFreePct}%`, ` · Mac memory free ${sys.memFreePct}%`) : '';
  const what = a.what ? ` (${a.what})` : '';
  return tr(
    `[앱] 메모리 위험: ${a.name} 세션이 ${a.gb.toFixed(1)}GB 를 쓰고 있어${what}${free}. 그 세션에 jest·vitest 는 --maxWorkers=2 로, 개발 서버·확인 브라우저·시험은 겹쳐 띄우지 말고 하나씩 하라고 말해 줘`,
    `[app] Memory danger: the ${a.name} session is using ${a.gb.toFixed(1)}GB${what}${free}. Tell it to run jest/vitest with --maxWorkers=2 and not to stack dev servers, check browsers and tests at once`,
  );
}
