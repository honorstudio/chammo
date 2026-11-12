// 폰 DM 보관함(11-06 사용자 "DM 보관함을 모바일에서 못 봄") — 대화 머리 폴더 아이콘. 데스크톱 '이 대화 파일'과 같은 목록(팀 보관함 줄 중 그 방 것, inRoom).
// 누르면 폰 보기, 길게 누르면(볼 길이 없는 줄은 누르면) 받기·공유 메뉴(11-12). 이름 바꾸기·지우기는 데스크톱에서
import { useCallback, useEffect, useState } from 'react';
import { teamThumbBlob, type PhoneTeamLocker, type TeamPhoneApi } from '../../data/web';
import { fmtBytes, inRoom, phoneSaveable, phoneView, thumbKind, whenText, type LockerItem } from '../../domain/teamLocker';
import { tr } from '../../i18n';
import { IconRefresh } from '../Icons';
import { FileMini } from '../team/RoomBits';
import { BottomSheet } from './kit';
import { usePress } from './PhoneLockerParts';
import { SaveButtons } from './ShareButton';

export function PhoneRoomFiles({ api, team, room, onOpen, onClose }: { api: TeamPhoneApi; team: string; room: string; onOpen: (i: LockerItem) => void; onClose: () => void }) {
  const [v, setV] = useState<PhoneTeamLocker | null>(null);
  const [err, setErr] = useState('');
  const [menu, setMenu] = useState<LockerItem | null>(null);
  const read = useCallback(() => {
    setErr('');
    void api.locker(team, 0).then((x) => { if ('items' in x) setV(x); }, (e: unknown) => setErr(String((e as Error)?.message ?? e).slice(0, 160)));
  }, [api, team]);
  useEffect(read, [read]);
  const files = v ? inRoom(v.items, room) : [];
  const title = tr('이 대화 파일', 'Files in this chat');
  return (
    <BottomSheet kind="full" label={title} title={title} titleClass="m-view-title" onClose={onClose}>
      <div className="m-view-body m-room-files">
        {!v && !err && <p className="m-muted" role="status">{tr('여는 중…', 'Opening…')}</p>}
        {err && (
          <>
            <p className="m-error" role="alert">{tr(`못 읽었어요 — ${err}`, `Couldn't read them — ${err}`)}</p>
            <button type="button" className="m-rt-btn m-ico" onClick={read} aria-label={tr('다시', 'Retry')} title={tr('다시', 'Retry')}><IconRefresh /></button>
          </>
        )}
        {v && !files.length && <p className="m-muted">{tr('이 대화에 주고받은 파일이 없어요', 'No files in this chat yet')}</p>}
        {files.length > 0 && <div className="tmx-lk-rows m-team-lk">{files.map((i) => <Row key={i.id} team={team} i={i} onOpen={onOpen} onMenu={() => setMenu(i)} />)}</div>}
      </div>
      {menu && (
        <BottomSheet kind="card" label={menu.name} title={menu.name} armMs={450} onClose={() => setMenu(null)}
          actions={phoneSaveable(menu, false) ? <SaveButtons team={{ team, id: menu.id }} /> : undefined}>
          <p className="m-tlk-ask m-menu-note">{menu.why || [fmtBytes(menu.size), whenText(menu.at)].filter(Boolean).join(' · ')}</p>
        </BottomSheet>
      )}
    </BottomSheet>
  );
}

function Row({ team, i, onOpen, onMenu }: { team: string; i: LockerItem; onOpen: (i: LockerItem) => void; onMenu: () => void }) {
  // 볼 길이 있는 줄은 누르면 보기, 없는 줄(zip 등)은 누르면 메뉴 — 길게 누르면 늘 메뉴(받기·공유)
  const press = usePress(phoneView(i) ? () => onOpen(i) : onMenu, onMenu);
  return (
    <button type="button" className={`tmx-lk-row ${i.why ? 'tlk-locked' : ''}`} title={i.why || undefined} {...press}>
      <FileMini className="tmx-ext" id={i.id} name={i.name} lazy get={thumbKind(i.name, i.size) && !i.why ? () => teamThumbBlob(team, i.id) : undefined} />
      <b>{i.name || tr('열 수 없는 파일', 'Unreadable file')}</b>
      <span className="d">{[fmtBytes(i.size), whenText(i.at)].filter(Boolean).join(' · ')}</span>
    </button>
  );
}
