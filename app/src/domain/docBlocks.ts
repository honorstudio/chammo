// 스페이스 문서 편집기의 노션 규칙 — 판단만 여기(편집기·DOM 은 ui/space). 2026-10-04 사용자 "노션 규칙들 다 보강해서 박으면 거의 완성"
import { dropSlot, type BlockRect, type DropSlot } from './drop';

/** 블록 손잡이를 끌 때 놓을 자리. 끄는 블록·그 자식 위는 빼고, 제자리(움직여도 그대로인 자리)는 null.
 *  웹 끌기(HTML5)는 앱 창의 파일 끌어다 놓기(Tauri)가 가로채서 안 된다 — 마우스를 직접 따라간다 */
export function moveSlot(rects: BlockRect[], dragged: string, own: string[], y: number): DropSlot | null {
  const mine = new Set(own);
  const slot = dropSlot(rects, y);
  if (!slot || mine.has(slot.id)) return null;
  const i = rects.findIndex((r) => r.id === dragged);
  const me = rects[i];
  if (!me) return slot;
  // 제자리: 끄는 블록 바로 앞에서 끝나는 블록의 뒤, 바로 뒤에서 시작하는 블록의 앞
  if (slot.place === 'after' && Math.abs(slot.y - me.top) < 1) return null;
  if (slot.place === 'before' && Math.abs(slot.y - me.bottom) < 1) return null;
  return slot;
}

type AnyBlock = { id?: string; children?: AnyBlock[] } & Record<string, unknown>;

/** ⌘D 복제할 블록 — 번호(id)를 자식까지 지워 새 블록으로 들어가게 */
export function duplicateBlock<B extends AnyBlock>(b: B): Omit<B, 'id'> {
  const { id: _id, children, ...rest } = b;
  return { ...rest, ...(children ? { children: children.map((c) => duplicateBlock(c)) } : {}) } as Omit<B, 'id'>;
}

type SlashItem = { key?: string; title: string; group?: string; aliases?: string[] };

/** 노션에서 부르는 한글 이름 — BlockNote 한글판에 없는 것만 더한다 */
const KO_ALIASES: Record<string, string[]> = {
  paragraph: ['텍스트', '글'],
  heading: ['큰 제목'],
  heading_2: ['중간 제목'],
  heading_3: ['작은 제목'],
  check_list: ['할 일', '할일', '투두', 'todo'],
  bullet_list: ['글머리', '점 목록'],
  numbered_list: ['번호'],
  toggle_list: ['토글'],
  quote: ['인용구'],
  code_block: ['코드'],
  divider: ['나누기', '줄'],
  table: ['테이블'],
  image: ['그림', '사진'],
  video: ['영상'],
  file: ['첨부'],
};

/** "/" 메뉴 — 기본 항목에 한글 이름을 더하고, 하위 페이지 항목은 '기본 블록' 묶음 끝에(그 묶음 이름 그대로 — 따로 두면 묶음이 둘로 갈라졌다) */
export function notionSlashItems<T extends SlashItem, P extends SlashItem>(defaults: T[], page?: P): (T | (P & { group?: string }))[] {
  const out: (T | (P & { group?: string }))[] = defaults.map((d) => (d.key && KO_ALIASES[d.key] ? { ...d, aliases: [...(d.aliases ?? []), ...KO_ALIASES[d.key]!] } : d));
  if (!page) return out;
  const basic = defaults.find((d) => d.key === 'paragraph')?.group;
  const at = basic ? out.map((d) => d.group).lastIndexOf(basic) + 1 : 0;
  out.splice(at, 0, { ...page, group: basic ?? page.group });
  return out;
}
