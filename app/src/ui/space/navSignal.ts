// 스페이스 뒤로·앞으로 신호 — ⌘[ ⌘](App 단축키)·마우스 뒤로/앞으로 단추 → SpaceView. detail = -1(뒤로) | 1(앞으로)
export const SPACE_NAV = 'space-nav';

// 스페이스 명령 신호 — ⌘W(탭 닫기)·⌘T(새 문서)·⌘⇧H(홈 고정 탭)·⌘⇧L(보관함 고정 탭) (App 단축키·메뉴) → SpaceView. 2026-10-12 사용자
export const SPACE_CMD = 'space-cmd';
export type SpaceCmd = 'closeTab' | 'newDoc' | 'home' | 'locker';
export const spaceCmd = (c: SpaceCmd) => window.dispatchEvent(new CustomEvent<SpaceCmd>(SPACE_CMD, { detail: c }));
