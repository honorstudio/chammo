// Craft 독(2026-10-17 사용자, 시안 v5) — 스페이스 탭 줄 홈·보관함 옆, 떠 있는 Craft 앱마다 그 앱 아이콘 하나(글자 없이, 이름은 title).
// 모서리 점 = 상태. 탭 X = 숨김(아이콘은 남고 10분 뒤 저장 후 끄기), 아이콘 누르기 = 다시 보기, 오른쪽 클릭 = 따로 창·끄기·최근 문서
import { tr } from '../i18n';

export type DockDot = 'human' | 'agent' | 'dirty' | '';
/** app = 인스턴스 키('photocraft'·'photocraft-2'), by = 띄운 세션 id(사람이 연 것은 빈 글) */
export type DockItem = { app: string; name: string; icon: string; dot: DockDot | string; hidden: boolean; recent: string[]; by?: string };

/** 점의 뜻(title·aria 에 붙는 글) */
export function dotWord(dot: string): string {
  if (dot === 'human') return tr('직접 조작 중', 'You have control');
  if (dot === 'agent') return tr('참모가 다루는 중', 'Assistant is working');
  if (dot === 'dirty') return tr('저장 안 됨', 'Not saved');
  return '';
}

/** 아이콘 이름표 — 앱 이름(+ 쓰는 세션 별명 + 상태). 같은 앱이 여럿 떠도 누구 것인지 보이게(owner = 그 세션 별명) */
export const dockTitle = (it: DockItem, owner?: string) => [it.name, owner, dotWord(it.dot)].filter(Boolean).join(' · ');

/** 아이콘 모서리 번호 — 같은 앱이 둘 이상 떠 있을 때만(1·2·3), 아니면 빈 글 */
export function dockNo(items: DockItem[], it: DockItem): string {
  const base = (k: string) => k.replace(/-[23]$/, '');
  if (items.filter((x) => base(x.app) === base(it.app)).length < 2) return '';
  return /-([23])$/.exec(it.app)?.[1] ?? '1';
}

/** 아이콘을 못 구했을 때 — 이름 첫 글자 */
export const dockLetter = (it: DockItem) => (it.name.trim()[0] ?? '?').toUpperCase();

/** 최근 문서 메뉴 줄 — 파일 이름만(경로는 title) */
export const recentLabel = (path: string) => path.split('/').pop() || path;
