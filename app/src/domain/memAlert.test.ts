import { describe, expect, it } from 'vitest';
import { memAlertLine, memAlerts } from './memAlert';
import type { LoadReport, SysLoad } from './load';

const GB = 1024 * 1024; // rssKb
const sys = (o: Partial<SysLoad> = {}): SysLoad => ({ cores: 10, load1: 80, load5: 60, load15: 40, swapUsedMb: 0, swapTotalMb: 0, memTotalMb: 24576, memFreePct: 40, memPressure: 1, ...o });
const proc = (pid: number, cmd: string, gb: number) => ({ pid, ppid: 1, cpu: 50, rssKb: gb * GB, etime: '01:00', cmd });
const report = (gb: number, top = [proc(1, 'node /x/node_modules/jest-worker/build/processChild.js', 2.4), proc(2, 'node /x/node_modules/jest-worker/build/processChild.js', 2.4)]): LoadReport => ({
  sessions: [{ id: 's1', name: 'shop-store', project: 'shop', cpu: 300, rssKb: gb * GB, top }, { id: 's2', name: 'small', project: 'x', cpu: 1, rssKb: 0.5 * GB, top: [] }],
  orphans: [], outside: { cpu: 0, rssKb: 0, top: [] }, rest: { cpu: 0, rssKb: 0, top: [] }, modes: [],
});

describe('맥 메모리 위험 알림(2026-11-16 jest 워커 9개 21GB 로 맥 멈춤)', () => {
  it('세션 하나가 8GB 를 넘으면 — 그 세션만', () => {
    expect(memAlerts(sys(), report(21)).map((a) => a.id)).toEqual(['s1']);
    expect(memAlerts(sys(), report(5))).toEqual([]);
  });
  it('맥이 압박 중이면 4GB 부터', () => {
    expect(memAlerts(sys({ memPressure: 2 }), report(5)).map((a) => a.id)).toEqual(['s1']);
    expect(memAlerts(sys({ memFreePct: 10 }), report(5)).map((a) => a.id)).toEqual(['s1']);
    expect(memAlerts(sys({ memPressure: 4 }), report(3))).toEqual([]);
  });
  it('알림 줄 — [앱] 한 줄, 세션·크기·큰 것 이름·고칠 길', () => {
    const [a] = memAlerts(sys({ memFreePct: 8 }), report(21));
    const t = memAlertLine(a!, sys({ memFreePct: 8 }));
    expect(t.startsWith('[앱] ')).toBe(true);
    expect(t).not.toMatch(/\n/);
    for (const w of ['shop-store', '21.0GB', '8%', '--maxWorkers=2']) expect(t).toContain(w);
  });
});
