// 펫 일기(시안 docs/design-drafts/tama-next v1 A, 2026-10-10 사용자 "추천대로") — 새벽 5시(하루 끝)에 그날 먹은 것으로 한 장.
// 글은 모델 호출 없이 문장틀 + 낱말 조합(돈 안 드는 판). 파일엔 재료(DiaryDay)만 두고 글은 볼 때 그린다 — 언어를 바꾸거나 틀을 고쳐도 지난 일기가 따라온다
import { getLang, josa, tr } from '../../i18n';
import { MONSTER_NAME, type MonsterKind, type Monsters } from './monsters';
import type { TamaEvent } from './pet';
import type { TamaFile } from './store';
import type { Egg, Slot } from './tree';

type Kind = TamaEvent['type'];
/** 하루치 재료. day = 'YYYY-MM-DD'(새벽 5시에 시작하는 날), 시각은 몇 시(0~23)만 */
export type DiaryDay = {
  day: string;
  egg: Egg; slot: Slot; gen: number;
  fed: number;
  kinds: Partial<Record<Kind, number>>;
  /** 가장 많이 본 프로젝트와 횟수 */
  top?: [string, number];
  /** 제일 많이 먹여 준 참모 이름 */
  keeper?: string;
  ciFail: number;
  ciLate?: number;
  /** 빨간불이 가장 많았던 저장소 — 내일은 조용했으면 */
  quiet?: string;
  first?: number; last?: number;
  slain: MonsterKind[]; met: MonsterKind[];
  retired?: true;
};

const H = 3_600_000;
const BACKFILL = 7;
const KEEP = 120;
const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (start: number) => { const d = new Date(start); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** t 가 속한 날의 시작(새벽 5시) */
const dayStartOf = (t: number) => { const d = new Date(t - 5 * H); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 5).getTime(); };
const nextDay = (start: number, n = 1) => { const d = new Date(start); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 5).getTime(); };
const most = (m: Map<string, number>): [string, number] | undefined => [...m].sort((a, b) => b[1] - a[1])[0];
const add = (m: Map<string, number>, k: string | undefined) => { if (k) m.set(k, (m.get(k) ?? 0) + 1); };

type Writer = { egg: Egg; slot: Slot; gen: number };
type In = { events: TamaEvent[]; start: number; writer: Writer; who: (id: string) => string | null; monsters?: Monsters; retiredAt?: number };

/** 그날 재료. 먹은 것·몬스터·은퇴가 하나도 없으면 null(빈 날은 일기를 안 쓴다) */
export function summarizeDay({ events, start, writer, who, monsters, retiredAt }: In): DiaryDay | null {
  const end = nextDay(start);
  const inDay = (t: number) => t >= start && t < end;
  const day = events.filter((e) => inDay(e.t) && !e.echo && e.type !== 'work').sort((a, b) => a.t - b.t);
  const fed = day.filter((e) => e.type !== 'ci');
  const kinds: DiaryDay['kinds'] = {};
  const proj = new Map<string, number>(), by = new Map<string, number>(), red = new Map<string, number>();
  let ciFail = 0, ciLate: number | undefined;
  for (const e of day) {
    if (e.type === 'ci') {
      if (!e.pass) { ciFail++; ciLate = new Date(e.t).getHours(); add(red, e.label); }
      continue;
    }
    kinds[e.type] = (kinds[e.type] ?? 0) + 1;
    add(proj, e.proj);
    add(by, e.by ? who(e.by) ?? undefined : undefined);
  }
  const slain = (monsters?.log ?? []).filter((l) => !l.fled && inDay(l.end)).map((l) => l.kind);
  const met = [...(monsters?.live ?? []), ...(monsters?.log ?? [])].filter((m) => m.at !== undefined && inDay(m.at!) && !slain.includes(m.kind)).map((m) => m.kind);
  const retired = retiredAt !== undefined && inDay(retiredAt);
  if (!fed.length && !ciFail && !slain.length && !met.length && !retired) return null;
  const top = most(proj);
  return {
    day: dayKey(start), ...writer, fed: fed.length, kinds,
    ...(top && top[1] >= 2 ? { top } : {}),
    ...(most(by) ? { keeper: most(by)![0] } : {}),
    ciFail, ...(ciLate !== undefined ? { ciLate, quiet: most(red)?.[0] } : {}),
    ...(fed.length ? { first: new Date(fed[0]!.t).getHours(), last: new Date(fed[fed.length - 1]!.t).getHours() } : {}),
    slain: [...new Set(slain)], met: [...new Set(met)],
    ...(retired ? { retired: true as const } : {}),
  };
}

/** 새벽 5시가 지나면 어제 한 장 — 꺼져 있던 날은 7일까지 채운다. 쓸 애 = 키우는 애, 없으면 마지막 은퇴한 애 */
export function addDiary(f: TamaFile, events: TamaEvent[], now: number, who: (id: string) => string | null): TamaFile {
  const today = dayStartOf(now);
  const have = f.diary ?? [];
  const lastKey = have[have.length - 1]?.day;
  const lineage = f.lineage ?? [];
  const anc = lineage[lineage.length - 1];
  const live = f.pet && !f.pet.dead ? f.pet : null;
  const writer: Writer | null = live ? { egg: live.egg, slot: live.slot, gen: lineage.length + 1 } : anc ? { egg: anc.egg, slot: anc.slot, gen: lineage.length } : null;
  if (!writer) return f;
  const pages: DiaryDay[] = [];
  for (let s = nextDay(today, -BACKFILL); s < today; s = nextDay(s)) {
    if (lastKey ? dayKey(s) <= lastKey : s !== nextDay(today, -1)) continue;
    const p = summarizeDay({ events, start: s, writer, who, monsters: f.monsters, retiredAt: live ? undefined : anc?.retiredAt });
    if (p) pages.push(p);
  }
  return pages.length ? { ...f, diary: [...have, ...pages].slice(-KEEP) } : f;
}

// ── 글 ──

/** 날짜로 정하는 주사위 — 같은 날은 언제 그려도 같은 글 */
function dice(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return <T,>(xs: T[]): T => { h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; return xs[h % xs.length]!; };
}
const ko = () => getLang() !== 'en';
const subj = (w: string) => (ko() ? josa(w, '이', '가') : w);
const obj = (w: string) => (ko() ? josa(w, '을', '를') : w);
/** 몇 시를 말로 — 23 → '밤 11시' */
const clock = (h: number) => (!ko() ? `${h}:00` : h < 5 ? `새벽 ${h}시` : h < 12 ? `오전 ${h}시` : h < 18 ? `오후 ${h === 12 ? 12 : h - 12}시` : `밤 ${h - 12}시`);

export function renderDiary(d: DiaryDay): { date: string; weather: string; lines: string[] } {
  const pick = dice(d.day);
  const [y, m, dd] = d.day.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, dd, 12).toLocaleDateString(ko() ? 'ko-KR' : 'en-US', { month: ko() ? 'long' : 'short', day: 'numeric', weekday: 'short' }).replace(/\((.)\)/, '($1)');
  const k = d.kinds;
  const weather = d.slain.length ? tr('비 온 뒤 갬', 'Clearing after rain')
    : d.ciFail >= 3 || d.met.length >= 2 ? tr('비', 'Rain')
    : d.ciFail || d.met.length ? tr('흐림', 'Cloudy')
    : d.fed >= 8 ? tr('맑음', 'Sunny') : tr('구름 조금', 'A few clouds');
  const lines: string[] = [];
  const n = d.fed;
  lines.push(pick(
    n >= 12 ? [tr(`오늘 밥을 ${n}번이나 먹었다. 배가 빵빵하다.`, `Ate ${n} times today. So full.`), tr(`${n}번 먹었다. 이러다 굴러다니겠다.`, `${n} meals. I might start rolling.`)]
    : n >= 5 ? [tr(`오늘 밥 ${n}번 먹었다.`, `Ate ${n} times today.`), tr(`${n}번 먹었다. 딱 좋았다.`, `${n} meals. Just right.`)]
    : n >= 1 ? [tr(`오늘은 ${n}번밖에 못 먹었다.`, `Only ${n} meals today.`), tr(`${n}번 먹었다. 조금 출출하다.`, `${n} meals. A little hungry.`)]
    : [tr('오늘은 아무것도 못 먹었다. 다들 바빴나 보다.', 'Nothing to eat today. Everyone must be busy.')],
  ));
  const treats: string[] = [];
  if (k.pr) treats.push(pick([tr(`머지 특식을 ${k.pr}번 먹었다. 최고였다.`, `Had ${k.pr} merge treats. The best.`), tr(`머지가 ${k.pr}번 — 특식 날이었다.`, `${k.pr} merges — a feast day.`)]));
  if (k.show) treats.push(pick([tr(`결과물을 ${k.show}개 구경했다. 눈이 즐거웠다.`, `Saw ${k.show} results. Pretty.`), tr(`새로 만든 걸 ${k.show}개 봤다.`, `Got to see ${k.show} new things.`)]));
  if (k.task) treats.push(pick([tr(`시킨 일 ${k.task}개가 끝났다.`, `${k.task} tasks got done.`), tr(`맡긴 일이 ${k.task}개 돌아왔다. 냠냠.`, `${k.task} tasks came back. Yum.`)]));
  if (k.commit) treats.push(pick([tr(`커밋을 ${k.commit}개 받아먹었다.`, `Gobbled ${k.commit} commits.`), tr(`커밋 ${k.commit}개, 꼭꼭 씹어 먹었다.`, `${k.commit} commits, chewed well.`)]));
  if (k.slay) treats.push(tr('몬스터를 이기고 간식도 받았다.', 'Beat a monster and got a snack.'));
  if (k.talk) treats.push(pick([tr(`말을 ${k.talk}번 걸어 줬다.`, `Got talked to ${k.talk} times.`), tr(`수다를 ${k.talk}번 떨었다.`, `Chatted ${k.talk} times.`)]));
  if (k.doc) treats.push(tr('문서를 고쳐 줘서 목욕도 했다.', 'Docs got fixed, so I had a bath.'));
  if (k.review) treats.push(tr('시안 검토로 같이 놀았다.', 'Played together over a design review.'));
  lines.push(...treats.slice(0, 2));
  if (d.top) lines.push(pick([tr(`${d.top[0]} 일을 ${d.top[1]}번 봤다.`, `Saw ${d.top[0]} work ${d.top[1]} times.`), tr(`하루 종일 ${d.top[0]} 얘기뿐이었다.`, `It was all ${d.top[0]} today.`), tr(`오늘의 주인공은 ${d.top[0]}.`, `Today's star: ${d.top[0]}.`)]));
  if (d.keeper) lines.push(k.pr ? tr(`머지할 때 ${d.keeper}랑 같이 만세 했다.`, `Cheered with ${d.keeper} at the merge.`) : pick([tr(`제일 많이 챙겨 준 건 ${d.keeper}.`, `${d.keeper} looked after me the most.`), tr(`${d.keeper} 덕에 든든했다.`, `Felt safe thanks to ${d.keeper}.`)]));
  if (d.ciFail) lines.push(pick([tr(`${clock(d.ciLate!)}쯤 빨간불이 ${d.ciFail}번 — 조마조마했다.`, `Red lights ${d.ciFail} times around ${clock(d.ciLate!)}. Nervous.`), tr(`빨간불(CI)이 ${d.ciFail}번 켜졌다. 조금 무서웠다.`, `CI went red ${d.ciFail} times. A bit scary.`)]));
  if (d.slain.length) lines.push(tr(`${obj(d.slain.map((x) => MONSTER_NAME[x]()).join(', '))} 물리쳤다!`, `Beat the ${d.slain.map((x) => MONSTER_NAME[x]()).join(', ')}!`));
  if (d.met.length) lines.push(tr(`${subj(MONSTER_NAME[d.met[0]!]())} 나타났다. 내일은 꼭 잡아야지.`, `A ${MONSTER_NAME[d.met[0]!]()} showed up. Must catch it tomorrow.`));
  if (d.last !== undefined && (d.last >= 23 || d.last < 5)) lines.push(tr('밤늦게까지 먹었다. 졸리다.', 'Ate late into the night. Sleepy.'));
  else if (d.first !== undefined && d.first < 9) lines.push(tr('아침 일찍부터 밥이 들어왔다.', 'Food came early in the morning.'));
  if (d.retired) lines.push(tr('오늘 은퇴했다. 다음 알에게 버릇을 물려준다.', 'Retired today. Passing a habit to the next egg.'));
  lines.push(d.quiet ? tr(`내일은 ${d.quiet} 쪽이 조용했으면.`, `Hope ${d.quiet} is quiet tomorrow.`)
    : pick([tr('내일도 많이 먹고 싶다.', 'Want to eat lots tomorrow too.'), tr('내일은 뭘 먹을까.', "Wonder what's for tomorrow."), tr('오늘도 좋은 하루였다.', 'It was a good day.')]));
  return { date, weather, lines };
}
