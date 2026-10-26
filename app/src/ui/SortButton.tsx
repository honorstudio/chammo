// 정렬 단추 — 머리 아이콘 하나, 누르면 기준(이름·날짜·크기·올린 사람)과 방향(오름·내림) 메뉴. 팀 보관함·참모 보관함이 같이 쓴다(10-26 사용자)
import { useState, type MouseEvent } from 'react';
import { firstDesc, sortName, type SortKey, type SortState } from '../domain/sortList';
import { tr } from '../i18n';
import { IconSort } from './Icons';
import { IconButton } from './kit/IconButton';
import { ContextMenu, type MenuItem } from './OrchDialogs';

export function SortButton<K extends SortKey>({ keys, value, onChange }: { keys: readonly K[]; value: SortState<K>; onChange: (v: SortState<K>) => void }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const dir = value.desc ? tr('내림차순', 'descending') : tr('오름차순', 'ascending');
  const items: MenuItem[] = [
    ...keys.map((k) => ({ label: sortName(k), checked: value.key === k, run: () => onChange({ key: k, desc: k === value.key ? value.desc : firstDesc(k) }) })),
    { label: tr('오름차순', 'Ascending'), checked: !value.desc, sep: true, run: () => onChange({ ...value, desc: false }) },
    { label: tr('내림차순', 'Descending'), checked: value.desc, run: () => onChange({ ...value, desc: true }) },
  ];
  const open = (e: MouseEvent<HTMLElement>) => { const r = e.currentTarget.getBoundingClientRect(); setAt({ x: Math.round(r.left), y: Math.round(r.bottom + 4) }); };
  return (
    <>
      <IconButton tone="line" label={tr('정렬', 'Sort')} title={tr(`정렬 — ${sortName(value.key)} ${dir}`, `Sort — ${sortName(value.key)} ${dir}`)} aria-haspopup="menu" pressed={!!at} onClick={open}><IconSort /></IconButton>
      {at && <ContextMenu x={at.x} y={at.y} items={items} onClose={() => setAt(null)} />}
    </>
  );
}
