import { BlockColorsItem, DragHandleMenu, RemoveBlockItem, SideMenu, TableColumnHeaderItem, TableRowHeaderItem } from '@blocknote/react';
import { tr } from '../../i18n';
import { IconDrop, IconHeadCol, IconHeadRow, IconTrash } from '../Icons';

// 문서 블록 손잡이 메뉴 — 아이콘만(2026-11-09 사용자 "글 늘리지 마"). 이름은 aria-label·title 로.
// 삭제는 BlockNote 그대로 '고른 블록(blockPick) 안이면 고른 것 전부'
const ico = (label: string, icon: React.ReactNode) => <span className="doc-hm-ico" role="img" aria-label={label} title={label}>{icon}</span>;

const DocHandleMenu = () => (
  <DragHandleMenu>
    <RemoveBlockItem>{ico(tr('삭제', 'Delete'), <IconTrash />)}</RemoveBlockItem>
    <BlockColorsItem>{ico(tr('색', 'Color'), <IconDrop />)}</BlockColorsItem>
    <TableRowHeaderItem>{ico(tr('첫 행을 머리로', 'Header row'), <IconHeadRow />)}</TableRowHeaderItem>
    <TableColumnHeaderItem>{ico(tr('첫 열을 머리로', 'Header column'), <IconHeadCol />)}</TableColumnHeaderItem>
  </DragHandleMenu>
);

export const DocSideMenu = () => <SideMenu dragHandleMenu={DocHandleMenu} />;
