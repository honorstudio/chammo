// 그림 팩 모음 — 팩 파일마다 따로 그리고 여기서 합친다(이름이 겹치면 뒤 팩이 이긴다 — 시험이 겹침을 막는다)
import { HALLOWEEN } from './halloween';
import { HOME } from './home';
import { MEME } from './meme';
import { PALS } from './pals';
import type { Pack } from './types';

export const PACKS: Pack[] = [HALLOWEEN, HOME, PALS, MEME];
const merge = <K extends keyof Pack>(k: K) => Object.assign({}, ...PACKS.map((p) => p[k] ?? {})) as NonNullable<Pack[K]>;
export const PACK: { [K in keyof Pack]-?: NonNullable<Pack[K]> } = {
  furn: merge('furn'), hat: merge('hat'), window: merge('window'), desk: merge('desk'), light: merge('light'), fx: merge('fx'),
  title: merge('title'), friend: merge('friend'), action: merge('action'), skin: merge('skin'), scene: merge('scene'),
};
