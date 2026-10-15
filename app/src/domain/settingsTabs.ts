// 설정 모달 탭 — 항목을 메뉴별로 묶는다(2026-10-15 사용자 "메뉴별로 구분 지어서 탭 같은 형태로"). 이름은 i18n 이 붙는 ui 쪽에서
import type { FeatureSwitch } from './config';

export type SettingsTab = 'general' | 'agent' | 'features' | 'voice' | 'phone' | 'accounts' | 'browser' | 'tools';

const ALL: SettingsTab[] = ['general', 'agent', 'features', 'voice', 'phone', 'accounts', 'browser', 'tools'];

/** 보이는 탭 — 윈도우는 계정 바꿔 끼우기(맥 키체인)가 없다 */
export function settingsTabs(win: boolean): SettingsTab[] {
  return win ? ALL.filter((t) => t !== 'accounts') : ALL;
}

/** 켬·끔 기능이 사는 탭 */
export const FEATURE_TAB: Record<FeatureSwitch, SettingsTab> = {
  office: 'features',
  tama: 'features',
  gacha: 'features',
  review: 'features',
  voice: 'voice',
  autoRevive: 'agent',
  agentView: 'browser',
  computerUse: 'browser',
};

/** 열 때 처음 탭 — 새 버전 띠의 '업데이트'로 열면 도구 점검부터 */
export function firstTab(start: 'update' | undefined): SettingsTab {
  return start === 'update' ? 'tools' : 'general';
}

/** 설정 모달을 Esc 로 닫나 — 한글 조합 중 Esc 는 조합 취소, 안의 터미널(설치·로그인) Esc 는 Claude Code 몫 */
export function settingsEscCloses(e: { key: string; composing: boolean; inTerminal: boolean }): boolean {
  return e.key === 'Escape' && !e.composing && !e.inTerminal;
}
