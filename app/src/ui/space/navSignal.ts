import type { SetupStart } from '../../domain/settingsTabs';
// 스페이스 뒤로·앞으로 신호 — ⌘[ ⌘](App 단축키)·마우스 뒤로/앞으로 단추 → SpaceView. detail = -1(뒤로) | 1(앞으로)
export const SPACE_NAV = 'space-nav';

// 스페이스 명령 신호 — ⌘W(탭 닫기)·⌘T(새 문서)·⌘⇧H(홈 고정 탭)·⌘⇧L(보관함 고정 탭) (App 단축키·메뉴) → SpaceView. 2026-10-12 사용자
// dash = 홈 대시보드(띠 맨 위 집, scripts/app open home), dashToggle = ⌘`(⌘₩) 홈 켜기·보던 화면으로
export const SPACE_CMD = 'space-cmd';
export type SpaceCmd = 'closeTab' | 'newDoc' | 'home' | 'locker' | 'dash' | 'dashToggle';
export const spaceCmd = (c: SpaceCmd) => window.dispatchEvent(new CustomEvent<SpaceCmd>(SPACE_CMD, { detail: c }));

// 설정 열기 신호 — 앱 서랍 '설치하기'(파이썬 없음) → App 이 설정을 그 작업과 함께 연다(점검 줄의 설치 터미널). detail = SetupStart
export const OPEN_SETUP = 'open-setup';
export const openSetup = (s: SetupStart) => window.dispatchEvent(new CustomEvent<SetupStart>(OPEN_SETUP, { detail: s }));
