// 설정 모달 탭 — 항목을 메뉴별로 묶는다(2026-10-15 사용자 "메뉴별로 구분 지어서 탭 같은 형태로"). 이름은 i18n 이 붙는 ui 쪽에서
import type { FeatureSwitch } from './config';

// 2026-10-24 사용자: '폰과 메신저'(phone)를 '기기 관리'(devices)·'메신저'(messenger) 둘로, Chammo 계정은 계정 탭 맨 위로
export type SettingsTab = 'general' | 'agent' | 'features' | 'voice' | 'devices' | 'messenger' | 'accounts' | 'browser' | 'tools';

const ALL: SettingsTab[] = ['general', 'agent', 'features', 'voice', 'devices', 'messenger', 'accounts', 'browser', 'tools'];

/** 보이는 탭 — 윈도우도 같다(Claude 계정 바꿔 끼우기는 윈도우에선 로그인 파일 + 자격 증명 관리자) */
export function settingsTabs(_win: boolean): SettingsTab[] {
  return ALL;
}

/** 밖에서 받은 탭 이름 → 탭. 옛 이름 phone 은 기기 관리로(옛 판 참모·저장된 길), 모르는 이름은 없음 */
export function tabOf(name: string | undefined): SettingsTab | undefined {
  if (name === 'phone') return 'devices';
  return (ALL as string[]).includes(name ?? '') ? (name as SettingsTab) : undefined;
}

/** 켬·끔 기능이 사는 탭 */
export const FEATURE_TAB: Record<FeatureSwitch, SettingsTab> = {
  office: 'features',
  tama: 'features',
  gacha: 'features',
  review: 'features',
  voice: 'voice',
  autoRevive: 'agent',
  autoTidy: 'features',
  agentView: 'browser',
  computerUse: 'browser',
  usagePing: 'features',
  craftBasics: 'features',
  bubble: 'features',
  bubbleDesk: 'features',
};

/** 설정을 열자마자 돌릴 점검 작업 — 'update' 새 버전 띠의 업데이트, 'python' 서랍의 파이썬 설치하기 */
export type SetupStart = 'update' | 'python';

/** 열 때 처음 탭 — 작업을 들고 열면 도구 점검부터 */
export function firstTab(start: SetupStart | undefined): SettingsTab {
  return start ? 'tools' : 'general';
}

/** 설정 모달을 Esc 로 닫나 — 한글 조합 중 Esc 는 조합 취소, 안의 터미널(설치·로그인) Esc 는 Claude Code 몫 */
export function settingsEscCloses(e: { key: string; composing: boolean; inTerminal: boolean }): boolean {
  return e.key === 'Escape' && !e.composing && !e.inTerminal;
}
