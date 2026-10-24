// 설정(config.json)을 화면에 비추는 판단 — 언어·비서 이름을 localStorage 로 비추기, 기능 켜기로 입구 가리기
import type { Lang } from '../i18n';
import type { Shortcut } from './shortcuts';

/** 애니메이션 — auto 는 OS '동작 줄이기'·맥 부하가 높을 때 저절로 줄인다(domain/animCalm), reduce 는 늘 줄이기, off 는 전환까지 0 */
export type Animation = 'auto' | 'reduce' | 'off';
export type Features = { office: boolean; tama: boolean; gacha: boolean; review: boolean; voice: boolean; autoRevive: boolean; autoTidy: boolean; agentView: boolean; computerUse: boolean; usagePing: boolean; animation: Animation };
/** 켬·끔 칸만(애니메이션은 세 갈래라 빠진다) — 설정 화면 체크 줄·scripts/app feature 가 다루는 것 */
export type FeatureSwitch = Exclude<keyof Features, 'animation'>;
/** 입구 기능은 다 켬. autoRevive(재시작 뒤 스스로 되살리기)는 무인 기계에서만 켜는 것이라 기본 꺼짐. autoTidy(끝난 세션 자동 정리)는 켬. agentView(세션 브라우저 앱에서 보기)는 켬. computerUse(화면 조종 모든 프로젝트)는 사용자 화면을 움직여서 끔. usagePing(익명 사용 통계)은 켬 — 설정 > 기능에서 끈다 */
export const ALL_ON: Features = { office: true, tama: true, gacha: true, review: true, voice: true, autoRevive: false, autoTidy: true, agentView: true, computerUse: false, usagePing: true, animation: "auto" };
const ANIMATIONS: readonly Animation[] = ['auto', 'reduce', 'off'];

/** 설정을 아직 못 읽었으면 입구는 다 켠 것으로 — 옛 설치가 잠깐이라도 입구를 잃지 않게 */
export const featuresOf = (c: { features?: Partial<Features> } | null | undefined): Features => {
  const f = { ...ALL_ON, ...(c?.features ?? {}) };
  return ANIMATIONS.includes(f.animation) ? f : { ...f, animation: 'auto' }; // 손으로 고친 설정 파일의 모르는 값
};

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
