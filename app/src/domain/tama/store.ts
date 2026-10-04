// 다마고치 저장 파일(~/.honor-orchestrator/tama.json). 메인 창이 계산해서 쓰고, 위젯 창은 읽기만 한다
import { advance, hatch, STAGE_AT, type Pet, type TamaEvent } from './pet';
import { fuseTarget, ZERO, type Egg, type Slot } from './tree';

export type WorkBin = { t: number; minutes: number };
export type Grave = { egg: Egg; slot: Slot; bornAt: number; diedAt: number; /** 처음부터 다시로 떠나보냄 */ left?: boolean };
/** 보관함의 펫 — 넣은 시각부터 꺼낼 때까지 시간이 멈춘다 */
export type BoxedPet = Pet & { boxedAt: number };
export const BOX_SIZE = 3;

export type TamaFile = {
  pet: Pet | null;
  /** 세션이 일한 시간 — 앱이 폴링하며 10분 칸으로 모은다(git 처럼 다시 읽어 올 출처가 없어서 여기 쌓는다) */
  work: WorkBin[];
  /** 본 모습 `계열.자리` */
  dex: string[];
  graves: Grave[];
  box: BoxedPet[];
  /** 사람이 바꾼 횟수(알 고르기·넣기·꺼내기·처음부터). 메인 창 1분 계산이 그 사이 바뀐 걸 덮어쓰지 않게 비교한다 */
  rev?: number;
  /** 딴 업적 id → 딴 시각 (domain/tama/badges) */
  badges?: Record<string, number>;
  /** 지금 세션이 일하는 중인가 — 메인 창이 쓰고 위젯이 훈련 표시등으로 읽는다 */
  busy?: boolean;
  /** 돌보는 참모(마지막으로 먹인 참모) — 메인 창이 쓰고 위젯 막대가 그 프사를 그린다 */
  keeper?: { name: string; color: string };
};

export const EMPTY_FILE: TamaFile = { pet: null, work: [], dex: [], graves: [], box: [] };

const BIN = 10 * 60_000;
const KEEP = 30 * 24 * 3_600_000;

/** 예전 파일에 없던 기록 칸(숨은 진화 숫자 등)은 0 으로 채운다 */
const upgrade = <P extends Pet>(p: P): P => ({ ...p, streak: p.streak ?? 0, c: { ...ZERO, ...p.c }, life: { ...ZERO, ...p.life } });

export function parseTamaFile(text: string): TamaFile {
  try {
    const f = JSON.parse(text) as Partial<TamaFile>;
    return { ...EMPTY_FILE, ...f, pet: f.pet ? upgrade(f.pet) : null, work: f.work ?? [], dex: f.dex ?? [], graves: f.graves ?? [], box: (f.box ?? []).map(upgrade) };
  } catch {
    return EMPTY_FILE;
  }
}

export function addWork(f: TamaFile, t: number, minutes: number): TamaFile {
  if (minutes <= 0) return f;
  const bin = Math.floor(t / BIN) * BIN;
  const work = f.work.filter((w) => w.t > t - KEEP);
  const last = work[work.length - 1];
  if (last && last.t === bin) work[work.length - 1] = { t: bin, minutes: last.minutes + minutes };
  else work.push({ t: bin, minutes });
  return { ...f, work };
}

/** 폴링 한 번 사이 세션들이 일한 분. 간격은 10초까지만 — 맥이 잠든 동안을 일한 시간으로 세지 않게 */
export const workMinutes = (busy: number, elapsedMs: number) => (busy * Math.min(elapsedMs, 10_000)) / 60_000;

const seen = (dex: string[], p: Pet) => (dex.includes(`${p.egg}.${p.slot}`) ? dex : [...dex, `${p.egg}.${p.slot}`]);

const bumped = (f: TamaFile) => (f.rev ?? 0) + 1;
const buried = (f: TamaFile): Grave[] => {
  const p = f.pet;
  return p?.dead ? [...f.graves, { egg: p.egg, slot: p.dead.slot, bornAt: p.bornAt, diedAt: p.dead.at }] : f.graves;
};

/** 새 알 고르기. 죽은 펫이 있으면 무덤으로 */
export function pickEgg(f: TamaFile, egg: Egg, now: number, luck: number): TamaFile {
  const pet = hatch(egg, now, luck);
  return { ...f, pet, graves: buried(f), dex: seen(f.dex, pet), rev: bumped(f) };
}

/** 보관함에 넣기. 꽉 찼거나 넣을 펫이 없으면(죽음 포함) null */
export function archive(f: TamaFile, now: number): TamaFile | null {
  if (!f.pet || f.pet.dead || f.box.length >= BOX_SIZE) return null;
  return { ...f, pet: null, box: [...f.box, { ...f.pet, boxedAt: now }], rev: bumped(f) };
}

/** 넣어 둔 만큼 모든 시각을 뒤로 민다 — 진화 시계·굶주림·무활동이 그동안 안 흐른 것처럼. 넣어 둔 동안의 기록은 안 먹는다 */
function thaw(b: BoxedPet, now: number): Pet {
  const { boxedAt, ...p } = b;
  const d = now - boxedAt;
  return { ...p, bornAt: p.bornAt + d, lastActive: p.lastActive + d, recent: p.recent.map((t) => t + d), lastOverfeed: p.lastOverfeed + d, updatedAt: now };
}

/** 보관함에서 꺼내기. 키우던 펫이 살아 있으면 그 자리에 대신 넣는다(자리 바꾸기) */
export function retrieve(f: TamaFile, index: number, now: number): TamaFile | null {
  const b = f.box[index];
  if (!b) return null;
  const box = f.box.filter((_, i) => i !== index);
  if (f.pet && !f.pet.dead) box.splice(index, 0, { ...f.pet, boxedAt: now });
  const pet = thaw(b, now);
  return { ...f, pet, box, graves: buried(f), dex: seen(f.dex, pet), rev: bumped(f) };
}

/** 합체 — 보관함 index 번째와 키우는 애가 짝이면 키우던 애가 합체 궁극체가 된다(보관함 쪽은 사라짐). 짝이 아니면 null */
export function fuse(f: TamaFile, index: number, now: number): TamaFile | null {
  const b = f.box[index];
  if (!b || !f.pet || f.pet.dead) return null;
  const slot = fuseTarget(f.pet, b);
  if (!slot) return null;
  const pet: Pet = { ...f.pet, slot, c: { ...ZERO, luck: f.pet.c.luck }, lastActive: now, updatedAt: Math.max(f.pet.updatedAt, now) };
  return { ...f, pet, box: f.box.filter((_, i) => i !== index), dex: seen(f.dex, pet), rev: bumped(f) };
}

/** 처음부터 다시 — 키우던 펫은 떠나보내고(무덤에 남김) 알 고르기로 */
export function restart(f: TamaFile, now: number): TamaFile {
  const p = f.pet;
  const graves = p && !p.dead ? [...f.graves, { egg: p.egg, slot: p.slot, bornAt: p.bornAt, diedAt: now, left: true }] : buried(f);
  return { ...f, pet: null, graves, rev: bumped(f) };
}

/**
 * 기록을 먹여 지금으로. 앱이 오래 꺼져 있었어도 거쳐 간 모습을 도감에 남기려고 매 정시·진화 시각마다 끊어서 돌린다
 * (advance 는 나눠 돌려도 결과가 같다)
 */
export function step(f: TamaFile, events: TamaEvent[], now: number): TamaFile {
  if (!f.pet) return f;
  // 작업 칸은 닫힌 뒤(칸 끝 시각)에 먹인다 — 채워지는 중에 먹이면 그 뒤로 더해진 분이 사라진다
  const all: TamaEvent[] = [...events, ...f.work.map((w) => ({ t: w.t + BIN, type: 'work' as const, minutes: w.minutes }))];
  let pet = f.pet;
  const stops = new Set<number>([now, ...STAGE_AT.map((x) => pet.bornAt + x)]);
  for (let t = Math.ceil(pet.updatedAt / 3_600_000) * 3_600_000; t < now; t += 3_600_000) stops.add(t);
  let dex = seen(f.dex, pet);
  for (const t of [...stops].filter((x) => x > pet.updatedAt && x <= now).sort((a, b) => a - b)) {
    pet = advance(pet, all, t);
    dex = seen(dex, pet);
    if (pet.dead) break;
  }
  return { ...f, pet: pet.updatedAt === now ? pet : advance(pet, all, now), dex };
}
