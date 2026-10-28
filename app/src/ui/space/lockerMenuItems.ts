// 보관함 오른쪽 클릭·카드 ··· 메뉴 — domain/lockerMenu 가 정한 묶음을 앱 공용 메뉴(OrchDialogs ContextMenu) 줄로. 실행이 없는 항목은 뺀다
import { tr } from '../../i18n';
import type { LockerMenuKey } from '../../domain/lockerMenu';
import type { MenuItem } from '../OrchDialogs';

export type MenuDo = { run?: () => void; sub?: MenuItem['sub']; empty?: string; label?: string };

const LABEL: Record<LockerMenuKey, () => string> = {
  open: () => tr('열기', 'Open'),
  big: () => tr('크게 보기', 'Open large'),
  send: () => tr('참모에게 보내기', 'Send to assistant'),
  team: () => tr('팀 보관함에 올리기', 'Upload to team locker'),
  alias: () => tr('폴더에 바로가기', 'Add shortcut to folder'),
  move: () => tr('옮기기', 'Move to'),
  keep: () => tr('보관함에 넣기', 'Keep in the locker'),
  back: () => tr('보관함으로 되돌리기', 'Bring back to the locker'),
  rename: () => tr('이름 바꾸기', 'Rename'),
  vers: () => tr('이전 판', 'Earlier versions'),
  find: () => tr('다시 찾기', 'Find the original'),
  newFolder: () => tr('새 폴더', 'New folder'),
  newDoc: () => tr('새 문서', 'New document'),
  newSheet: () => tr('새 엑셀', 'New spreadsheet'),
  add: () => tr('파일 넣기', 'Add files'),
  reveal: () => tr('파인더에서 보기', 'Show in Finder'),
  trash: () => tr('휴지통으로', 'Move to Trash'),
  unlink: () => tr('바로가기 지우기(원본은 그대로)', 'Remove shortcut (original stays)'),
  close: () => tr('탭 닫기', 'Close tab'),
  connect: () => tr('맥 폴더 연결…', 'Link a Mac folder…'),
  reconnect: () => tr('다시 연결…', 'Relink…'),
  disconnect: () => tr('연결 풀기(원본은 그대로)', 'Unlink (original stays)'),
  untrash: () => tr('휴지통 되돌리기', 'Undo move to Trash'),
};
const DANGER = new Set<LockerMenuKey>(['trash', 'unlink', 'disconnect']);

export function menuItems(groups: LockerMenuKey[][], acts: Partial<Record<LockerMenuKey, MenuDo | undefined>>): MenuItem[] {
  const out: MenuItem[] = [];
  for (const g of groups) {
    let first = true;
    for (const k of g) {
      const d = acts[k];
      if (!d || (!d.run && !d.sub)) continue;
      out.push({ label: d.label ?? LABEL[k](), danger: DANGER.has(k), run: d.run, sub: d.sub, empty: d.empty, sep: first && out.length > 0 });
      first = false;
    }
  }
  return out;
}

/** '폴더에 바로가기' 다음 목록 — 내 폴더(여러 층은 › 로) */
export const folderItems = (folders: { rel: string }[], pick: (rel: string) => void): MenuItem[] =>
  folders.map((f) => ({ label: f.rel.split('/').join(' › '), run: () => pick(f.rel) }));
