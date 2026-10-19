// Craft 독(2026-10-17 사용자, 시안 v5) — 스페이스 탭 줄 홈·보관함 옆, 떠 있는 Craft 앱마다 그 앱 아이콘 하나(글자 없이, 이름은 title).
// 모서리 점 = 상태. 탭 X = 숨김(아이콘은 남고 10분 뒤 저장 후 끄기), 아이콘 누르기 = 다시 보기, 오른쪽 클릭 = 따로 창·끄기·최근 문서
import { tr } from '../i18n';

export type DockDot = 'human' | 'agent' | 'dirty' | '';
export type DockItem = { app: string; name: string; icon: string; dot: DockDot | string; hidden: boolean; recent: string[] };

/** 점의 뜻(title·aria 에 붙는 글) */
export function dotWord(dot: string): string {
  if (dot === 'human') return tr('직접 조작 중', 'You have control');
  if (dot === 'agent') return tr('참모가 다루는 중', 'Assistant is working');
  if (dot === 'dirty') return tr('저장 안 됨', 'Not saved');
  return '';
}

/** 아이콘 이름표 — 앱 이름(+ 상태) */
export const dockTitle = (it: DockItem) => [it.name, dotWord(it.dot)].filter(Boolean).join(' · ');

/** 아이콘을 못 구했을 때 — 이름 첫 글자 */
export const dockLetter = (it: DockItem) => (it.name.trim()[0] ?? '?').toUpperCase();

/** 최근 문서 메뉴 줄 — 파일 이름만(경로는 title) */
export const recentLabel = (path: string) => path.split('/').pop() || path;
