// 부하 칩 호버 카드에 무엇을 어떤 순서로 — 문제 있는 자원을 위로(높음 먼저), 괜찮은 건 한 줄씩(C안, 2026-11-01 사용자).
// 숫자·상태만 고른다. 화면 글은 ui/LoadChip 이 tr 로
import { resources, type Lv, type LoadReport, type SessionLoad, type SysLoad, worst } from './load';

export type CardItem = { key: 'cpu' | 'mem' | 'disk'; lv: Lv; num?: string; clean?: boolean };
export type Card = { lv: Lv; bad: CardItem[]; good: CardItem[]; sessions: SessionLoad[]; rest: { cpu: number; rssKb: number } | null };

const RANK: Record<Lv, number> = { high: 0, warn: 1, ok: 2 };

export function loadCard(sys: SysLoad, report: LoadReport | null): Card {
  const r = resources(sys);
  const items: CardItem[] = [
    { key: 'cpu', lv: r.cpu.lv, num: `${r.cpu.ratio.toFixed(1)}×` },
    { key: 'mem', lv: r.mem.lv, ...(r.mem.freePct !== undefined ? { num: `${100 - r.mem.freePct}%` } : {}) },
    ...(r.disk ? [{ key: 'disk' as const, lv: r.disk.lv, num: `${r.disk.usedPct}%`, clean: r.disk.lv !== 'ok' }] : []),
  ];
  const bad = items.filter((x) => x.lv !== 'ok').sort((a, b) => RANK[a.lv] - RANK[b.lv]);
  const good = items.filter((x) => x.lv === 'ok');
  const sessions = report ? [...report.sessions].sort((a, b) => b.cpu - a.cpu).slice(0, 3) : [];
  const rest = report ? { cpu: Math.round(report.rest.cpu + report.outside.cpu), rssKb: report.rest.rssKb + report.outside.rssKb } : null;
  return { lv: worst(...items.map((x) => x.lv)), bad, good, sessions, rest };
}
