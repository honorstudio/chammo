// 폴더 타일·경로 줄 — 참모 보관함(LockerPage)과 팀 보관함(TeamLocker)이 같은 조각을 쓴다(10-28 사용자 "왜 기존 보관함 방식으로 안 함? 진짜 파인더처럼").
// 누르면 들어가고, 오른쪽 클릭·이름 칸·끌기·고르기·끌어 놓을 자리(data-…-folder)는 부르는 쪽이 준다
import { useState, type ReactNode } from 'react';
import { tr } from '../../i18n';
import { IconBack, IconFolder } from '../Icons';
import { IconButton } from '../kit/IconButton';
import './locker.css';

/** 끌어 놓는 자리·끌기 사건 — 참모 보관함 data-locker-folder · 팀 보관함 data-team-folder, dragPath·dragTeam */
type Attrs = Record<string, string | undefined>;
type Drag = { onPointerDown?: (e: React.PointerEvent) => void };
/** 고르기(usePick) — press 가 ⌘·⇧ 누름을 고르기로 받았으면 true(그러면 안 들어간다) */
export type TilePick = { picked: boolean; press: (e: React.MouseEvent) => boolean; drag: Drag };

export function FolderTile({ name, title, tail, icon, drop, pick, pickKey, cls, fresh, onOpen, onRename, onCancel, onMenu }: {
  name: string;
  title?: string;
  /** 오른쪽 끝 — 개수(그 밖은 '원본 없음' 같은 표) */
  tail?: ReactNode;
  icon?: ReactNode;
  drop?: Attrs;
  pick?: TilePick;
  /** 고르기 열쇠(data-pick) — 없으면 네모 고르기에 안 잡힌다 */
  pickKey?: string;
  cls?: string;
  /** 방금 만든 폴더 — 바로 이름 칸 */
  fresh?: boolean;
  onOpen: () => void;
  onRename?: (name: string) => void;
  /** 이름 칸이 바뀐 것 없이 닫힘(빈 글·Esc) — 새 폴더 이름 칸이면 그 타일을 거둔다 */
  onCancel?: () => void;
  /** rename = 그 자리 이름 칸 열기 */
  onMenu?: (e: React.MouseEvent, rename: () => void) => void;
}) {
  const [naming, setNaming] = useState<string | null>(fresh ? name : null);
  const done = () => { const n = naming?.trim(); if (n && n !== name) onRename?.(n); else onCancel?.(); setNaming(null); };
  const ic = <span className="lk-fic">{icon ?? <IconFolder />}</span>;
  return (
    <div className={['lk-fcard', cls, pick?.picked ? 'picked' : ''].filter(Boolean).join(' ')} data-pick={pickKey} {...drop} onContextMenu={onMenu ? (x) => onMenu(x, () => setNaming(name)) : undefined}>
      {naming !== null ? (
        <div className="lk-fbtn">
          {ic}
          <input className="lk-rename" autoFocus value={naming} aria-label={tr('폴더 이름 바꾸기', 'Rename folder')} onChange={(x) => setNaming(x.target.value)} onBlur={done}
            onPointerDown={(x) => x.stopPropagation()} onKeyDown={(x) => { if (x.key === 'Enter' && !x.nativeEvent.isComposing) done(); if (x.key === 'Escape') { x.stopPropagation(); setNaming(null); onCancel?.(); } }} />
        </div>
      ) : (
        <button className="lk-fbtn" {...pick?.drag} onClick={(x) => { if (!pick?.press(x)) onOpen(); }} title={title ?? name}>
          {ic}<b>{name}</b>{tail}
        </button>
      )}
    </div>
  );
}

/** 경로 줄 — 맨 위 › 자료 › 10월. 칸을 누르면 거기로, 끌어 놓으면 그 폴더로(dropOf 가 준 자리). back 을 주면 맨 앞에 뒤로(위 폴더) */
export function PathCrumbs({ root, crumbs, count, onGo, dropOf, back }: {
  root: string;
  crumbs: { key: string; name: string }[];
  count?: number;
  onGo: (key: string) => void;
  /** 그 칸(빈 글 = 맨 위)을 끌어 놓는 자리로 — 못 놓는 칸이면 빈 속성 */
  dropOf: (key: string) => Attrs;
  back?: () => void;
}) {
  const last = crumbs.length - 1;
  return (
    <nav className="lk-crumb" aria-label={tr('경로', 'Path')}>
      {back && <IconButton size="s" label={tr('뒤로', 'Back')} onClick={back}><IconBack /></IconButton>}
      <button className={last < 0 ? 'cur' : ''} {...dropOf('')} onClick={() => onGo('')}>{root}</button>
      {crumbs.map((c, i) => (
        <span key={c.key} className="lk-crumb-i">
          <span aria-hidden="true">›</span>
          <button className={i === last ? 'cur' : ''} {...dropOf(c.key)} onClick={() => onGo(c.key)} title={c.name}>{c.name}</button>
        </span>
      ))}
      {count !== undefined && <span className="lk-count">{count}</span>}
    </nav>
  );
}
