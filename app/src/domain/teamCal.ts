// 팀 캘린더(chammo-relay ADR 0011, 시안 .shots/team-cal/v2) — 기록 모양·반복 펼치기·달력 칸·홈 블록 목록·만들기 칸.
// 봉하기·합치기·판 맞추기는 Rust team_app 이 한다. 여기는 화면이 그릴 것만(데스크톱·폰 같이 쓴다)
import { tr } from '../i18n';

export type Label = 'blue' | 'green' | 'orange' | 'purple' | 'gray';
export const LABELS: Label[] = ['blue', 'green', 'orange', 'purple', 'gray'];
/** 반복 — 사용자 10-30 결정 ②: 매주·격주·매월 + 이 날만 빼기 */
export type Repeat = { every: 'week' | '2week' | 'month'; until?: string; skip?: string[] };
/** 봉한 기록 안(v1). 하루 종일 = start·end 가 날짜(end 미포함), 시간 = UTC ISO */
export type CalData = {
  v?: number; title: string; allDay: boolean; start: string; end: string; tz?: string;
  people?: string[]; label?: Label; place?: string; note?: string;
  repeat?: Repeat;
  /** 완료(사용자 10-30 결정 ③) — 누가·언제 */
  done?: { by: string; at: number } | null;
  made?: { by: string; at: number };
  edits?: { by: string; at: number; f: string[] }[];
  [more: string]: unknown;
};
/** Rust team_app_store::Shown */
export type CalItem = { id: string; rev: number; data: CalData; by: string; at: number; del: boolean; deletedAt: number | null; why: string; /** 누른 즉시 그린 것(서버가 아직 안 받음) */ pending?: boolean };
export type CalSnap = { team: string; rev: number; ver: number; items: CalItem[]; me: string; cached: boolean };
export type CalWrite = { snap: CalSnap; rev: number; lost: string[]; by: string; gone: boolean };

export const TITLE_MAX = 200;
export const NOTE_MAX = 2000;
const PLACE_MAX = 200;
const PEOPLE_MAX = 30;
const REPEAT_MAX = 400;

const pad = (n: number) => String(n).padStart(2, '0');
/** 이 기기 시간대 날짜 'YYYY-MM-DD' */
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y ?? 1970, (m || 1) - 1, d || 1);
};
export const addDays = (s: string, n: number) => {
  const d = dateOf(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** 월 칸 — 일요일 시작, 그 달을 다 담는 5주 또는 6주 */
export function monthCells(year: number, month0: number): string[] {
  const first = new Date(year, month0, 1);
  const start = addDays(ymd(first), -first.getDay());
  const days = new Date(year, month0 + 1, 0).getDate();
  const n = Math.ceil((first.getDay() + days) / 7) * 7;
  return Array.from({ length: n }, (_, i) => addDays(start, i));
}

/** 그날이 든 일~토 */
export const weekDays = (s: string) => {
  const start = addDays(s, -dateOf(s).getDay());
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
};

/** 화면에 그릴 한 번(반복이면 그 회차) */
export type Occ = {
  id: string; key: string; day: string; endDay: string; startMs: number; endMs: number;
  allDay: boolean; title: string; label: Label; done: boolean; repeat: boolean; item: CalItem;
};

/** 회차 시작들 — 반복 없으면 하나 */
function starts(d: CalData, from: string, to: string): Date[] {
  const base = d.allDay ? dateOf(d.start) : new Date(d.start);
  if (Number.isNaN(base.getTime())) return [];
  if (!d.repeat) return [base];
  const out: Date[] = [];
  const skip = new Set(d.repeat.skip ?? []);
  const until = d.repeat.until ?? '9999-12-31';
  for (let i = 0; i < REPEAT_MAX; i++) {
    const s = new Date(base);
    if (d.repeat.every === 'month') {
      s.setMonth(base.getMonth() + i);
      if (s.getDate() !== base.getDate()) continue; // 31일이 없는 달
    } else s.setDate(base.getDate() + i * (d.repeat.every === '2week' ? 14 : 7));
    const day = ymd(s);
    if (day > until || day >= to) break;
    if (!skip.has(day) && day >= addDays(from, -62)) out.push(s);
  }
  return out;
}

/** 범위 [from, to) 에 걸친 회차 — 지운 것·못 연 것은 빼고, 날짜 → 하루 종일 먼저 → 시작 시각 순 */
export function occurrences(items: CalItem[], from: string, to: string, o: { hideDone?: boolean } = {}): Occ[] {
  const out: Occ[] = [];
  for (const it of items) {
    const d = it.data;
    if (it.del || it.why || !d || typeof d.start !== 'string') continue;
    // 반복 일정엔 완료가 없다(사용자 10-30) — 옛 기록에 done 이 있어도 숨기지 않는다(한 번 완료가 앞으로 전부를 숨기던 것, 0.4.5 리뷰)
    const done = !!d.done && !d.repeat;
    if (o.hideDone && done) continue;
    const len = d.allDay ? dateOf(d.end).getTime() - dateOf(d.start).getTime() : new Date(d.end).getTime() - new Date(d.start).getTime();
    for (const s of starts(d, from, to)) {
      const startMs = s.getTime();
      const endMs = startMs + Math.max(len, 0);
      const day = ymd(s);
      // 하루 종일 end 는 미포함 — 걸친 마지막 날은 하루 앞
      const endDay = d.allDay ? addDays(ymd(new Date(endMs)), -1) : ymd(new Date(Math.max(endMs - 1, startMs)));
      if (endDay < from || day >= to) continue;
      out.push({ id: it.id, key: `${it.id}@${day}`, day, endDay: endDay < day ? day : endDay, startMs, endMs, allDay: !!d.allDay, title: d.title || tr('(제목 없음)', '(No title)'), label: LABELS.includes(d.label as Label) ? (d.label as Label) : 'blue', done, repeat: !!d.repeat, item: it });
    }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : Number(b.allDay) - Number(a.allDay) || a.startMs - b.startMs || a.title.localeCompare(b.title)));
}

/** 날짜 칸마다 — 여러 날 일정은 걸친 날마다 */
export function byDay(occ: Occ[], days: string[]): Map<string, Occ[]> {
  const m = new Map<string, Occ[]>();
  for (const day of days) m.set(day, occ.filter((o) => o.day <= day && day <= o.endDay));
  return m;
}

/** 홈 블록 '다가오는 일정' — 오늘부터 span 일 안, 날짜별로 묶고 개수 상한 */
export function upcoming(items: CalItem[], today: string, span: number, limit: number): { day: string; occ: Occ[] }[] {
  const occ = occurrences(items, today, addDays(today, span), { hideDone: true }).filter((o) => o.endDay >= today).slice(0, limit);
  const out: { day: string; occ: Occ[] }[] = [];
  for (const o of occ) {
    const day = o.day < today ? today : o.day;
    const g = out.find((x) => x.day === day);
    if (g) g.occ.push(o);
    else out.push({ day, occ: [o] });
  }
  return out;
}

/** 만들기·고치기 칸(화면 입력 그대로) */
export type Draft = {
  title: string; allDay: boolean; date: string; endDate: string; from: string; to: string;
  people: string[]; label: Label; place: string; note: string; repeat: '' | Repeat['every']; until: string;
};

/** 칸 채우기 — 저장된 일정에서, 없으면 그날 하루 종일 */
export function draftOf(it: CalItem | null, day: string): Draft {
  if (!it) return { title: '', allDay: true, date: day, endDate: day, from: '09:00', to: '10:00', people: [], label: 'blue', place: '', note: '', repeat: '', until: '' };
  const d = it.data;
  const s = d.allDay ? dateOf(d.start) : new Date(d.start);
  const e = d.allDay ? dateOf(addDays(d.end, -1)) : new Date(d.end);
  return {
    title: d.title ?? '', allDay: !!d.allDay, date: ymd(s), endDate: ymd(e), from: hm(s), to: hm(e),
    people: (d.people ?? []).slice(), label: LABELS.includes(d.label as Label) ? (d.label as Label) : 'blue',
    place: d.place ?? '', note: d.note ?? '', repeat: d.repeat?.every ?? '', until: d.repeat?.until ?? '',
  };
}

const at = (day: string, t: string) => {
  const [h, m] = t.split(':').map(Number);
  const d = dateOf(day);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
};

/** 칸 → 봉할 기록. 고치기면 before 의 모르는 칸(made·edits·새 판 칸·완료·건너뛴 날)을 그대로 넘긴다 */
export function cleanDraft(f: Draft, before?: CalData): { data?: CalData; error?: string } {
  const title = f.title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  if (!title) return { error: tr('제목을 적어 주세요', 'Add a title') };
  let start: string, end: string;
  if (f.allDay) {
    const last = f.endDate && f.endDate >= f.date ? f.endDate : f.date;
    if (f.endDate && f.endDate < f.date) return { error: tr('끝나는 날이 시작보다 앞이에요', 'The end is before the start') };
    start = f.date;
    end = addDays(last, 1);
  } else {
    const s = at(f.date, f.from);
    const e = at(f.date, f.to);
    if (e.getTime() <= s.getTime()) return { error: tr('끝나는 시각이 시작보다 앞이에요', 'The end is before the start') };
    start = s.toISOString();
    end = e.toISOString();
  }
  const repeat: Repeat | undefined = f.repeat ? { every: f.repeat, ...(f.until ? { until: f.until } : {}), ...(before?.repeat?.skip?.length ? { skip: before.repeat.skip } : {}) } : undefined;
  const data: CalData = {
    ...(before ?? {}),
    v: 1, title, allDay: f.allDay, start, end,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    people: f.people.slice(0, PEOPLE_MAX), label: f.label,
    place: f.place.trim().slice(0, PLACE_MAX), note: f.note.slice(0, NOTE_MAX),
  };
  if (repeat) {
    data.repeat = repeat;
    delete data.done;
  } else delete data.repeat;
  return { data };
}

/** 반복 일정의 이 날만 빼기 */
export const skipDay = (d: CalData, day: string): CalData => (d.repeat ? { ...d, repeat: { ...d.repeat, skip: [...new Set([...(d.repeat.skip ?? []), day])].sort() } } : d);

/** 완료 켜기·끄기 — 반복 일정엔 못 건다(사용자 10-30: 반복엔 완료 체크를 안 보인다) */
export const withDone = (d: CalData, me: string, on: boolean): CalData => ({ ...d, done: on && !d.repeat ? { by: me, at: Date.now() } : null });

/** 쓰기 문지기 — 지금 팀 기록장에 있는 일정만 고친다. 팀을 바꾼 뒤 앞 팀 일정을 새 팀 열쇠로 쓰지 않게(0.4.5 리뷰) */
export const calPutOk = (snap: CalSnap | null, team: string, it: CalItem | null): boolean =>
  it ? !!snap && snap.team === team && snap.items.some((x) => x.id === it.id) : !snap || snap.team === team;

/** 새 기록 id — 서버 길(1~64자 글자·숫자·-_) */
export const newCalId = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** 같은 칸을 덮었을 때 한 줄 — 칸 이름 */
export function lostLine(lost: string[], who: string): string {
  if (!lost.length) return '';
  if (lost.includes('*')) return tr(`방금 ${who}님이 고친 일정이었어요`, `${who} had just edited this`);
  const name: Record<string, () => string> = {
    title: () => tr('제목', 'title'), start: () => tr('시간', 'time'), end: () => tr('시간', 'time'), allDay: () => tr('시간', 'time'),
    note: () => tr('메모', 'note'), place: () => tr('장소', 'place'), people: () => tr('담당', 'people'), label: () => tr('색', 'color'),
    repeat: () => tr('반복', 'repeat'), done: () => tr('완료', 'done'),
  };
  const f = [...new Set(lost.map((k) => (name[k] ? name[k]() : k)))].join('·');
  return tr(`${who}님이 바꾼 ${f}을(를) 덮었어요`, `Replaced the ${f} ${who} had changed`);
}
