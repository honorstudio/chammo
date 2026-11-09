// 위 띠 '오늘 한 일' 칸 — 새벽 5시부터 끝낸 일·시간대별 막대·숫자 셋(시안 docs/design-drafts/inbox-today T3, 2026-11-05 사용자)
import { assistant, tr } from '../i18n';
import type { CodeToday, DayWindow } from './replay';
import type { TaskEvent } from './tasks';

const HOUR = 3600_000;

export type TodayWork = {
  done: number;
  /** 시간 칸(5시=0 … 다음 4시=23)별 끝낸 일 수 */
  hours: number[];
  /** 끝낸 일을 시킨 참모 수 — 시킨 기록이 없는 옛 일은 뺀다 */
  people: number;
};

/** 같은 일을 다시 닫으면 마지막 때 한 번만. 넘긴 큰 일(handover)은 쪼갠 일과 겹쳐서 안 센다 */
export function todayWork(events: TaskEvent[], w: DayWindow): TodayWork {
  const big = new Set<string>();
  const owner = new Map<string, string>();
  const lastDone = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'handover') big.add(e.task);
    else if (e.type === 'send' || e.type === 'own') {
      const who = e.fromName || e.from;
      if (who) owner.set(e.task, who);
    } else if (e.type === 'done') {
      const t = new Date(e.ts).getTime();
      if (t >= w.start && t < w.end) lastDone.set(e.task, t);
    }
  }
  const hours = new Array<number>(24).fill(0);
  const who = new Set<string>();
  let done = 0;
  for (const [task, t] of lastDone) {
    if (big.has(task)) continue;
    done += 1;
    hours[Math.floor((t - w.start) / HOUR)]! += 1;
    const o = owner.get(task);
    if (o) who.add(o);
  }
  return { done, hours, people: who.size };
}

/** 지금 시간 칸 — 막대에서 지금을 짙게 칠할 자리 */
export const nowSlot = (w: DayWindow, now: number) => Math.floor((now - w.start) / HOUR);

/** 개발자 칸 조건 — git 설정을 끄면 App 이 커밋을 안 세어 늘 0 이라 설정은 따로 안 본다 */
export const isCodeDay = (c: CodeToday) => c.commits + c.merges > 0;

export type TodayCard = {
  /** 아무것도 없음 — 아이콘이 흐려지고 칸엔 한 줄만 */
  empty: boolean;
  stats: { k: string; v: number }[];
  /** 개발자 칸 줄(저장소·줄 수) — 개발 안 하는 사람은 null */
  code: CodeToday | null;
  /** 보관함 파일 수를 읽어야 하나 — 개발자 칸엔 안 나와서 안 읽는다 */
  needsFiles: boolean;
};

/** files = 오늘 보관함에 들어온 파일 수(칸을 열 때 읽는다, 아직이면 null) */
export function todayCard(work: TodayWork, code: CodeToday, files: number | null): TodayCard {
  const done = { k: tr('끝낸 일', 'Done'), v: work.done };
  if (isCodeDay(code)) {
    return { empty: false, code, needsFiles: false, stats: [done, { k: tr('머지', 'Merges'), v: code.merges }, { k: tr('커밋', 'Commits'), v: code.commits }] };
  }
  return {
    empty: work.done === 0 && !files,
    code: null,
    needsFiles: true,
    stats: [done, { k: assistant(), v: work.people }, { k: tr('보관함 파일', 'Locker files'), v: files ?? 0 }],
  };
}
