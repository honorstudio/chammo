// 다마고치를 없애며 쌓인 걸 옮긴다(사용자 11-06 확정) — 일한 시간·커밋은 코인으로, 해금한 모습은 가진 캐릭터로. 한 번만(gacha.json tamaMoved)
import { chrIdOf } from './catalog/characters';
import type { GachaFile } from './gacha';
import type { TamaFile } from './tama/store';

/** 일한 30분 = 1코인(훈련 1칸과 같은 단위), 커밋 5개 = 1코인 */
const MIN_PER_COIN = 30;
const COMMITS_PER_COIN = 5;
const TRAIN_MIN = 30;

/** 펫이 키워진 기간 — 그 안의 일한 시간은 평생 기록(훈련)에 이미 들어 있다 */
const spans = (t: TamaFile, now: number): [number, number][] => [
  ...t.box.map((b): [number, number] => [b.bornAt, b.boxedAt]),
  ...(t.pet ? [[t.pet.bornAt, now] as [number, number]] : []),
];

export function tamaCoins(t: TamaFile, commits: number, now: number): { minutes: number; commits: number; coins: number } {
  const lives = [...t.box, ...(t.pet ? [t.pet] : [])];
  const inPets = lives.reduce((n, p) => n + (p.life.training ?? 0) * TRAIN_MIN, 0);
  const ranges = spans(t, now);
  const outside = t.work.filter((w) => !ranges.some(([a, z]) => w.t >= a && w.t <= z)).reduce((n, w) => n + w.minutes, 0);
  const minutes = inPets + outside;
  return { minutes, commits, coins: Math.floor(minutes / MIN_PER_COIN) + Math.floor(commits / COMMITS_PER_COIN) };
}

/** 커밋을 어디서부터 셀까 — 처음 키운 때. 은퇴·죽은 세대는 숫자가 파일에 안 남아 git 으로 센다 */
export function firstPetAt(t: TamaFile): number | null {
  const all = [...t.box.map((b) => b.bornAt), ...(t.lineage ?? []).map((a) => a.bornAt), ...t.graves.map((g) => g.bornAt), ...(t.pet ? [t.pet.bornAt] : [])];
  return all.length ? Math.min(...all) : null;
}

/** 옮기기 — 이미 했으면 같은 걸 돌려준다. 곰 한 마리는 누구나(캐릭터가 하나도 없는 사람이 없게). 별은 안 깎고, NEW 도 안 띄운다 */
export function moveFromTama(f: GachaFile, t: TamaFile, commits: number, now: number): GachaFile {
  if (f.tamaMoved) return f;
  const { coins } = tamaCoins(t, commits, now);
  const owned = { ...f.owned };
  let chars = 0;
  for (const d of t.dex) {
    const id = chrIdOf(d);
    if (!id) continue;
    chars++;
    if (!owned[id]) owned[id] = 1;
  }
  if (!owned['chr.bear']) owned['chr.bear'] = 1;
  return { ...f, coins: f.coins + coins, owned, tamaMoved: { at: now, coins, chars } };
}
