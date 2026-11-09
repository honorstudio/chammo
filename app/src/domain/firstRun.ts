// 첫 설치 — 시작 → 준비(저절로) → Claude 로그인 → 끝. 판단만 여기, 부르기는 ui/FirstRun(ADR 0027, 시안 docs/design-drafts/onboarding C)
import { setupFailed, type EnvCheck } from './setup';

export type FrScreen = 'start' | 'prep' | 'login' | 'done';
export const FR_SCREENS: FrScreen[] = ['start', 'prep', 'login', 'done'];

/** tools = 맥 참모 도구(앱이 받는 파이썬). 윈도우는 git·파이썬을 winget 으로 */
export type ItemKey = 'tools' | 'git' | 'python' | 'claude' | 'browser' | 'folder';
export type ItemState = 'todo' | 'now' | 'ok' | 'skip' | 'fail';
export type FailKind = 'net' | 'other' | 'noWinget';
export type Item = { key: ItemKey; state: ItemState; fail?: FailKind };

export const itemsFor = (win: boolean): Item[] =>
  (win ? (['git', 'python', 'claude', 'browser', 'folder'] as const) : (['tools', 'claude', 'browser', 'folder'] as const)).map((key) => ({ key, state: 'todo' }));

/** 다음에 돌 항목 — 실패가 있으면 멈춘다(안 깔린 채 넘어가지 않게). 없으면 다 끝 */
export function nextItem(items: Item[]): Item | null | 'stuck' {
  if (items.some((i) => i.state === 'fail')) return 'stuck';
  return items.find((i) => i.state === 'todo' || i.state === 'now') ?? null;
}

export const allDone = (items: Item[]) => items.every((i) => i.state === 'ok' || i.state === 'skip');

/** 'n개 중 m개'의 m — 끝났거나 넘긴 수 */
export const doneCount = (items: Item[]) => items.filter((i) => i.state === 'ok' || i.state === 'skip').length;

export const setItem = (items: Item[], key: ItemKey, state: ItemState, fail?: FailKind): Item[] =>
  items.map((i) => (i.key === key ? { key, state, ...(fail ? { fail } : {}) } : i));

/** 실패한 항목을 다시 돌리게 */
export const retryItem = (items: Item[], key: ItemKey): Item[] => setItem(items, key, 'todo');

/** 넘길 수 있는 항목 — 윈도우 git·파이썬뿐(관리자 권한·winget 없는 회사 PC, win-env H3). 맥 참모 도구·Claude·브라우저·폴더는 필수 */
export const canSkip = (k: ItemKey) => k === 'git' || k === 'python';

/** 윈도우 git·파이썬을 직접 받는 줄이 필요한가 — winget 이 없을 때 */
export const needsManualGet = (win: boolean, key: ItemKey, c: Pick<EnvCheck, 'winget'> | null) => win && (key === 'git' || key === 'python') && c?.winget === false;

/** 끝난 숨은 터미널 글 → 왜 실패했나. 망 문제만 갈라 말한다(끊긴 줄·curl 코드·node 망 오류) */
export function failKind(text: string, online = true): FailKind {
  if (!online) return 'net';
  return /could not resolve|couldn.?t (resolve|connect)|failed to connect|timed? ?out|network|connection (reset|refused|closed)|ENOTFOUND|EAI_AGAIN|ECONNRE|curl: \((5|6|7|28|35|52|56)\)|Cannot reach the internet|인터넷/i.test(text) ? 'net' : 'other';
}

/** 항목이 정말 됐나 — 숨은 터미널 종료가 아니라 결과로 본다(실패 줄을 못 찍고 죽어도 맞게) */
export function itemOk(key: ItemKey, c: Pick<EnvCheck, 'claudePath' | 'clt' | 'python'> | null, oldClaude: boolean): boolean {
  if (!c) return false;
  if (key === 'claude') return !!c.claudePath && !oldClaude;
  if (key === 'git') return c.clt;
  if (key === 'python') return c.python !== false;
  return false;
}

/** 바닥 선 길이 0~1 — 준비는 항목 수만큼 자라고, 로그인이 끝나면 조금 더, 끝에서 1 */
export function lineLength(screen: FrScreen, items: Item[], loggedIn: boolean): number {
  if (screen === 'start') return 0;
  if (screen === 'done') return 1;
  if (screen === 'prep') return 0.05 + 0.6 * (doneCount(items) / Math.max(items.length, 1));
  return loggedIn ? 0.9 : 0.68;
}

/** 첫 화면 몇 번째 단계로 다시 시작하나 — 시작을 누른 적 있으면 준비부터(껐다 켜도 이어 하기). 다 된 항목은 준비가 바로 건너뛴다 */
/** 시작하기가 남기는 표시 — 다시 불러온 App 이 첫 참모를 한 번 띄운다(0.4.9, 끝 장 '참모에게 …' 뒤 빈 화면이던 것) */
export const FIRST_SPAWN_KEY = 'firstRunSpawn';
export const firstSpawnDue = (s: { wanted: boolean; setupDone: boolean; seen: boolean; hasEnv: boolean; orchs: number }): boolean =>
  s.wanted && s.setupDone && s.seen && s.hasEnv && s.orchs === 0;

export const resumeScreen = (started: boolean): FrScreen => (started ? 'prep' : 'start');

/** 로그인을 기다리는 한계 — 넘으면 숨은 터미널을 끄고 '다시 열기'만 남긴다(브라우저를 닫았거나 딴 일을 하러 갔다) */
export const LOGIN_LIMIT_MS = 5 * 60_000;

/** 로그인 뒤 저절로 다음 장으로 가기까지 — '계정 추가'를 누를 틈. 누르지 않으면 사람이 누를 게 없다 */
export const AUTO_NEXT_MS = 4_000;

export const loginCommand = (base: string, consoleAccount: boolean) => (consoleAccount ? base.replace(/\bauth login\b/, 'auth login --console') : base);

/** 숨은 터미널이 실패로 끝났나 — 맥·윈도우 공통 끝 줄(setupCommand) */
export const hiddenFailed = (text: string) => setupFailed(text);
