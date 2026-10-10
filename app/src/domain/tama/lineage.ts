// 세대 잇기(시안 docs/design-drafts/tama-next v1 E, 2026-10-10 사용자 "추천대로") — 끝 모습이 되면 은퇴하고
// 다음 알이 앞 세대 버릇을 물려받는다. 7일이 끝이 아니라 혈통 줄이 길어진다. 버릇 효과는 pet.ts 먹이 계산에 조금씩
import { tr } from '../../i18n';
import type { Counters, Egg, Slot } from './tree';

export type Quirk = 'tester' | 'merger' | 'delegate' | 'fighter' | 'tidy' | 'night' | 'mellow';
/** 은퇴한 세대 — inherited = 태어날 때 물려받은 것, quirk = 자기가 얻어 물려준 것 */
export type Ancestor = { egg: Egg; slot: Slot; bornAt: number; retiredAt: number; quirk: Quirk; inherited: Quirk[] };

/** 물려받는 버릇은 최근 셋까지 — 끝없이 쌓이면 먹이 계산이 너무 세진다 */
export const QUIRK_MAX = 3;
/** 끝 모습이 된 뒤 이만큼 지나면 저절로 은퇴(그 전엔 펫 모달 '은퇴' 버튼으로 바로) */
export const RETIRE_AFTER = 24 * 3_600_000;

const FINAL = new Set<Slot>(['m1', 'm2', 'jA', 'jB', 'p3']);
/** 더 진화할 데가 없는 모습 — 궁극체·합체 궁극체·반전 완전체 */
export const isFinal = (s: Slot) => FINAL.has(s);

/** 얻는 조건(그 대 평생 기록) — 위에서부터. 아무것도 안 맞으면 순둥이 */
const EARN: [Quirk, (c: Counters) => boolean][] = [
  ['tester', (c) => c.commits >= 10 && c.testCommits * 2 >= c.commits],
  ['merger', (c) => c.prMerges + c.shows >= 10],
  ['delegate', (c) => c.tasksDone >= 20],
  ['fighter', (c) => c.wins >= 20 && c.wins >= c.battles * 0.8],
  ['night', (c) => (c.nightFeeds ?? 0) >= 15],
  ['tidy', (c) => c.mistakes === 0],
];

/** 이번 대가 얻는 버릇 — 이미 가진 건 피하고 다음으로 맞는 것(조합을 모으게). 맞는 게 다 있으면 그중 처음 */
export function earnQuirk(life: Counters, have: Quirk[]): Quirk {
  const ok = EARN.filter(([, f]) => f(life)).map(([q]) => q);
  return ok.find((q) => !have.includes(q)) ?? ok[0] ?? 'mellow';
}

/** 다음 알이 받는 버릇 — 겹치면 새로 얻은 쪽 자리로, 오래된 것부터 빠진다 */
export const heirOf = (inherited: Quirk[], earned: Quirk): Quirk[] => [...inherited.filter((q) => q !== earned), earned].slice(-QUIRK_MAX);

export const QUIRK_NAME: Record<Quirk, () => string> = {
  tester: () => tr('테스트 좋아함', 'Loves tests'),
  merger: () => tr('머지 배부름', 'Merge glutton'),
  delegate: () => tr('심부름꾼', 'Errand runner'),
  fighter: () => tr('배틀광', 'Battle lover'),
  tidy: () => tr('깔끔쟁이', 'Neat freak'),
  night: () => tr('새벽형', 'Night owl'),
  mellow: () => tr('순둥이', 'Easygoing'),
};
/** 얻는 법 · 효과 — 버릇 알약 툴팁 */
export const QUIRK_HINT: Record<Quirk, () => string> = {
  tester: () => tr('테스트 든 커밋이 절반 넘게 · 테스트 든 커밋이 배 2칸', 'Over half the commits had tests · a tested commit fills 2'),
  merger: () => tr('머지·결과물 10번 · 머지·결과물이 배 3칸', '10 merges or results · merges and results fill 3'),
  delegate: () => tr('시킨 일 20개 끝냄 · 시킨 일이 배 2칸', '20 tasks done · a finished task fills 2'),
  fighter: () => tr('배틀 20승(8할 넘게) · 이긴 배틀이 훈련 1', '20 wins at 80%+ · each win counts as training'),
  night: () => tr('밤 10시~새벽 2시에 15번 먹음 · 그 시간 먹이 한 칸 더', 'Ate 15 times 10pm–2am · one extra at that hour'),
  tidy: () => tr('돌봄 실수 0 · 작은 커밋 두 번이면 똥 하나 치움', 'Zero care mistakes · two small commits clean a poop'),
  mellow: () => tr('다른 버릇이 안 맞을 때 · 배고픔이 14시간마다', 'When nothing else fits · gets hungry every 14 hours'),
};
