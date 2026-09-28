// 설정(config.json)을 화면에 비추는 판단 — 언어·비서 이름을 localStorage 로 비추기, 기능 켜기로 입구 가리기
import type { Lang } from '../i18n';
import type { Shortcut } from './shortcuts';

export type Features = { office: boolean; tama: boolean; gacha: boolean; review: boolean; voice: boolean };
export const ALL_ON: Features = { office: true, tama: true, gacha: true, review: true, voice: true };

/** 설정을 아직 못 읽었으면 다 켠 것으로 — 옛 설치가 잠깐이라도 입구를 잃지 않게 */
export const featuresOf = (c: { features?: Partial<Features> } | null | undefined): Features => ({ ...ALL_ON, ...(c?.features ?? {}) });

type Stored = { lang: string | null; assistantName: string | null };
export type MirrorPlan = {
  /** localStorage 에 쓸 것(null = 지우기). 비었으면 쓸 게 없다 */
  writes: Partial<Record<keyof Stored, string | null>>;
  /** 지금 떠 있는 화면이 설정과 다르다 — 한 번 다시 연다(언어·이름은 뜰 때 정해서) */
  reload: boolean;
};

/**
 * 앱이 뜬 뒤 설정을 읽으면: main.tsx 가 동기로 읽는 localStorage 에 언어·비서 이름을 비춰 두고,
 * 이번에 뜬 화면(runningLang·저장돼 있던 이름)이 설정과 다르면 다시 연다
 */
export function mirrorPlan(c: { language: string; assistantName: string }, stored: Stored, runningLang: Lang): MirrorPlan {
  const writes: MirrorPlan['writes'] = {};
  let reload = false;
  if (c.language === 'ko' || c.language === 'en') {
    if (stored.lang !== c.language) writes.lang = c.language;
    if (runningLang !== c.language) reload = true;
  }
  const name = c.assistantName.trim() || null;
  const had = stored.assistantName?.trim() || null;
  if (name !== had) {
    writes.assistantName = name;
    reload = true;
  }
  return { writes, reload };
}

/** 꺼 둔 기능의 단축키·메뉴는 아무 일도 안 한다(메뉴에서도 빠지지만, 켜고 끈 뒤 메뉴가 늦게 바뀌는 사이를 막는다) */
export function allowed(sc: Shortcut, f: Features): boolean {
  if (sc.type === 'goto') {
    if (sc.to === 'office') return f.office;
    if (sc.to === 'tama') return f.tama;
    if (sc.to === 'review') return f.review;
  }
  if (sc.type === 'widget') return f.tama;
  return true;
}
