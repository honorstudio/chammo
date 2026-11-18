// 보호자 '오늘 만든 것' 카드(계획서 H) — 아이 기록(kids_log)의 앱 줄('만들기 이름: 할 일' · '고치기 이름: 할 일')과 작품 목록·오늘 쓴 시간으로.
// 고친 과정이 이 컨셉이 키우려는 힘이라 단계를 차례대로 보인다("공룡 → 두 마리 → 빨간색"). 맥에 새로 쌓는 건 없다
import { tr } from '../i18n';
import type { KidsRow } from './kids';

export type KidsTodayWork = { name: string; title: string; steps: string[] };
export type KidsToday = { works: KidsTodayWork[]; usedMin?: number; limitMin?: number; talks: number };

const STEP_CHARS = 24;
const STEPS = 6;
const ORDER = /^(만들기|고치기) ([^:]+): (.+)$/;

const cut = (s: string) => { const c = [...s.trim()]; return c.length > STEP_CHARS ? c.slice(0, STEP_CHARS - 1).join('') + '…' : c.join(''); };

/** 오늘(dayStart 부터) 한 것 — 없으면 null */
export function kidsToday(rows: KidsRow[], works: { name: string; title: string; mtime: number }[], time: { usedMs: number; limitMs: number } | undefined, dayStart: number): KidsToday | null {
  const today = rows.filter((r) => r.ts >= dayStart);
  const by = new Map<string, { steps: string[]; last: number }>();
  for (const r of today) {
    const m = r.who === 'app' ? ORDER.exec(r.text) : null;
    if (!m) continue;
    const w = by.get(m[2]!) ?? { steps: [], last: 0 };
    w.steps.push(cut(m[3]!));
    w.last = r.ts;
    by.set(m[2]!, w);
  }
  for (const w of works) if (w.mtime >= dayStart && !by.has(w.name)) by.set(w.name, { steps: [], last: w.mtime });
  const talks = today.filter((r) => r.who === 'kid').length;
  const usedMin = time ? Math.round(time.usedMs / 60_000) : undefined;
  if (!by.size && !talks && !usedMin) return null;
  const list = [...by.entries()]
    .sort((a, b) => b[1].last - a[1].last)
    .map(([name, w]) => ({ name, title: works.find((x) => x.name === name)?.title || name, steps: w.steps.length > STEPS ? [w.steps[0]!, ...w.steps.slice(-(STEPS - 1))] : w.steps }));
  return { works: list, usedMin, limitMin: time ? Math.round(time.limitMs / 60_000) : undefined, talks };
}

/** 접힌 한 줄 */
export function kidsTodayLine(t: KidsToday, child: string): string {
  const parts = [tr(`오늘 ${child || '아이'}`, `Today · ${child || 'Child'}`)];
  if (t.usedMin !== undefined) parts.push(t.limitMin ? `${t.usedMin}/${t.limitMin}${tr('분', ' min')}` : `${t.usedMin}${tr('분', ' min')}`);
  const w = t.works[0];
  if (w) parts.push(`${w.title}${w.steps.length ? `: ${w.steps.join(' → ')}` : ''}${t.works.length > 1 ? tr(` 외 ${t.works.length - 1}`, ` +${t.works.length - 1}`) : ''}`);
  else parts.push(tr(`말 ${t.talks}번`, `${t.talks} talks`));
  return parts.join(' · ');
}
