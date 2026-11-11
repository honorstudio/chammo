// 폰 팀 보관함 — 중계 팀 보관함 그대로(데스크톱 TeamLocker 와 같은 목록·폴더 구조, 10-28 사용자 "모바일 팀 보관함이 비어 있다"·"폰에서도 관리").
// 전엔 데스크톱에 '이 기기에 저장'한 팀 폴더만 봐서 늘 비었다. 읽기는 폰 서버(/api/team-locker — 본 판 그대로면 same, 보는 동안 4초),
// 바꾸기·올리기도 데스크톱과 같은 길로 서버가 한다. 영구 지우기는 데스크톱 팀 보관함 휴지통에서만
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { teamThumbBlob, type PhoneLockerOp, type PhoneTeamLocker as View, type PhoneTeamUps, type TeamPhoneApi } from '../../data/web';
import { FileMini } from '../team/RoomBits';
import { keyWaitNote, lockedFiles, upNote, baseOf, crumbsOf, extOf, fmtBytes, thumbKind, inPlace, kidFolders, moveTargets, parentOf, phoneView, renamedPath, usageText, whenText, type LockerItem } from '../../domain/teamLocker';
import { partsOf } from '../../domain/teamPhoneUp';
import { teamViewMemo } from '../../domain/teamViewMemo';
import { machine, tr } from '../../i18n';
import { FolderTile, PathCrumbs } from '../space/FolderTile';
import { IconFolder, IconFolderPlus, IconMore, IconPlus, IconTrash } from '../Icons';
import { BottomSheet } from './BottomSheet';
import { IconBtn } from './kit';
import { usePress } from './PhoneLockerParts';
import { ProfilesCtx } from '../team/useProfiles';
import { lookOf } from '../../domain/teamProfile';
import { sayTarget, type Convo, type TeamFile } from '../../domain/teamChat';
import { chatSendPlan, chatTargets, sendNote } from '../../domain/teamSendChat';

/** 팀마다 마지막 목록 — 대화·팀 홈 칸을 갔다 와도 바로 그린다 */
const memo = teamViewMemo<View>();

type Menu = { kind: 'file'; item: LockerItem } | { kind: 'folder'; key: string; n: number };
type Ask =
  | { kind: 'name'; what: 'file'; item: LockerItem }
  | { kind: 'name'; what: 'folder'; key: string }
  | { kind: 'name'; what: 'mkdir' }
  | { kind: 'move'; what: 'file'; item: LockerItem }
  | { kind: 'move'; what: 'folder'; key: string }
  | { kind: 'rm-folder'; key: string; n: number }
  | { kind: 'chat'; item: LockerItem };
type OpBody = PhoneLockerOp extends infer T ? (T extends unknown ? Omit<T, 'team'> : never) : never;

const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 160);
const nameOf = (i: LockerItem) => i.name || tr('열 수 없는 파일', 'Unreadable file');

/** 팀챗에 보내기(11-09) — PhoneTeam 의 사람 손 문을 지나는 보내기(누른 시각 at) */
type ChatSay = (to: string, text: string, at: number, extra?: { files?: TeamFile[] }) => Promise<unknown> | null;

/** onOpen = 그림·PDF·영상 줄을 누르면 크게 보기·재생(PhoneTeam 의 보기 창). 길게 누르면 메뉴.
 *  chats·say = 길게 누르기 메뉴 '팀챗에 보내기'(11-09 사용자 "팀 보관함에서 팀챗으로 안 옮겨져") — 고른 대화에 그 파일을 가리키는 첨부로, 보내면 onChatSent 가 그 대화를 연다 */
export function PhoneTeamLocker({ api, teamId, onOpen, chats, say, onChatSent }: { api: TeamPhoneApi; teamId: string; onOpen?: (i: LockerItem) => void; chats?: Convo[]; say?: ChatSay; onChatSent?: (c: Convo) => void }) {
  const [v, setV] = useState<View | null>(() => memo.get(teamId)?.v ?? null);
  const [ups, setUps] = useState<PhoneTeamUps['uploads']>([]);
  const [sending, setSending] = useState<{ key: string; name: string; sent: number; total: number }[]>([]);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [place, setPlace] = useState('');
  const [trash, setTrash] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  /** + — 폰 기본 첨부 창(iOS: 사진 보관함·사진 찍기·파일 선택). 우리 모달은 한 단계 더라 뺐다(11-06 사용자) */
  const pick = useRef<HTMLInputElement>(null);
  const rev = useRef(0);
  /** 읽는 중인 팀 id(빈 값 = 쉼) — 팀마다 따로라 앞 팀을 읽는 중에도 새 팀은 바로 읽는다 */
  const busy = useRef('');
  // 지금 보는 팀 — 읽는 사이 팀이 바뀌면(머리 팀 줄) 늦게 온 앞 팀 목록·판 번호를 새 팀 화면에 앉히지 않는다(11-02 팀 여러 개:
  // 앞 팀 판 번호를 들고 새 팀을 물으면 맥이 '그대로'로 답해 앞 팀 목록이 굳었다)
  const cur = useRef(teamId);
  cur.current = teamId;
  /** 받는 중에 '꼭 새로'가 오면(바꾼 직후) 끝난 뒤 한 번 더 */
  const again = useRef(false);
  const going = useRef(0);

  const read = useCallback((force = false) => {
    if (busy.current === teamId) { if (force) again.current = true; return; }
    busy.current = teamId;
    void api.locker(teamId, force ? 0 : rev.current).then((x) => {
      if (cur.current !== teamId) return;
      setUps(x.uploads ?? []);
      const live = (x.uploads ?? []).filter((u) => !u.error).length;
      const finished = live < going.current;
      going.current = live;
      if (finished) again.current = true; // 데스크톱이 다 올렸다 — 새 줄이 생겼다
      if ('same' in x) return;
      memo.put(teamId, x);
      rev.current = x.rev;
      setV(memo.get(teamId)?.v ?? x);
      setErr('');
    }, (e: unknown) => { if (cur.current === teamId) setErr(errText(e)); }).finally(() => {
      if (busy.current !== teamId) return; // 앞 팀 읽기 — 새 팀 읽기를 건드리지 않는다
      busy.current = '';
      if (again.current) { again.current = false; read(true); }
    });
  }, [api, teamId]);

  useEffect(() => {
    const m = memo.get(teamId);
    setV(m?.v ?? null);
    rev.current = m?.v.rev ?? 0;
    setPlace('');
    setTrash(false);
    read();
    const t = window.setInterval(() => read(), 4000);
    return () => window.clearInterval(t);
  }, [teamId, read]);

  const run = (op: OpBody, done?: () => void) => {
    void api.lockerOp({ team: teamId, ...op } as PhoneLockerOp).then(() => { done?.(); read(true); }, (e: unknown) => setNote(tr(`못 했어요 — ${errText(e)}`, `Couldn't do that — ${errText(e)}`)));
  };

  // 올리기 — 지금 보는 폴더에, 하나씩 차례로. 상한(1GB)을 넘는 파일은 한 줄 안내
  const upload = async (files: File[]) => {
    const to = place;
    for (const f of files) {
      if (partsOf(f.size) === null) { setNote(tr(`${f.name} — 1GB 넘는 파일은 ${machine()} 팀 보관함에서 올려 줘요`, `${f.name} — files over 1GB have to be uploaded from the team locker on your ${machine()}`)); continue; }
      const key = `${f.name}:${f.size}:${Date.now()}`;
      setSending((s) => [...s, { key, name: f.name, sent: 0, total: f.size }]);
      try {
        await api.lockerPut(teamId, f, to, (n) => setSending((s) => s.map((x) => (x.key === key ? { ...x, sent: n } : x))));
      } catch (e) {
        setNote(tr(`${f.name} 못 올렸어요 — ${errText(e)}`, `${f.name} couldn't be uploaded — ${errText(e)}`));
      }
      setSending((s) => s.filter((x) => x.key !== key));
      read(true);
    }
  };

  /** 고른 대화에 보내기 — 다시 받거나 올리지 않고 팀 보관함 파일을 가리킨다. 잠긴·다른 대화 파일은 chatSendPlan 이 뺀다 */
  const sendChat = (item: LockerItem, c: Convo, at: number) => {
    if (!say) return;
    const { refs, skip } = chatSendPlan([item], c.room, teamId);
    if (!refs.length) { setNote(sendNote(skip) || tr('보낼 파일이 없어요', 'Nothing to send')); return; }
    const p = say(sayTarget(c), '', at, { files: refs });
    if (!p) { setNote(tr('직접 누른 것만 보내요 — 다시 눌러 줘', 'Only sends what you tap — try again')); return; }
    setNote(tr(`${c.name}에 보내는 중…`, `Sending to ${c.name}…`));
    void p.then(() => { setNote(''); onChatSent?.(c); }, (e: unknown) => setNote(tr(`${c.name}에 못 보냈어요 — ${errText(e)}`, `Couldn't send to ${c.name} — ${errText(e)}`)));
  };

  if (!v) return err ? <div className="tmx-none" role="alert">{tr(`팀 보관함을 못 읽었어요 — ${err}`, `Couldn't read the team locker — ${err}`)}</div> : <div className="tmx-none" role="status">{tr('팀 보관함 여는 중…', 'Opening team locker…')}</div>;

  const folders = trash ? [] : kidFolders(v.items, place);
  const files = trash ? inPlace(v.items, '', true) : inPlace(v.items, place);
  const use = usageText(v.usage);
  const here = folders.length + files.length + sending.length + ups.length;
  const nIn = (key: string) => kidFolders(v.items, parentOf(key)).find((f) => f.key === key)?.n ?? 0;

  return (
    <div className="m-team-lk-wrap">
      <div className="m-tlk-bar">
        {trash ? <b className="m-tlk-title">{tr('휴지통', 'Trash')}</b> : <span className="m-tlk-use" title={use.text}>{use.text}</span>}
        <span className="m-tlk-sp" />
        {!trash && place && <IconBtn label={tr('이 폴더', 'This folder')} onClick={() => setMenu({ kind: 'folder', key: place, n: nIn(place) })}><IconMore /></IconBtn>}
        <IconBtn label={trash ? tr('팀 보관함으로', 'Back to team locker') : tr('휴지통', 'Trash')} onClick={() => { setTrash((x) => !x); setPlace(''); }}>{trash ? <IconFolder /> : <IconTrash />}</IconBtn>
        {!trash && <IconBtn label={tr('새 폴더', 'New folder')} onClick={() => setAsk({ kind: 'name', what: 'mkdir' })}><IconFolderPlus /></IconBtn>}
        {!trash && <IconBtn label={tr('올리기', 'Upload')} onClick={() => pick.current?.click()}><IconPlus /></IconBtn>}
        {/* 고른 목록은 배열로 옮긴 뒤 칸을 비운다 — 같은 파일을 다시 골라도 change 가 온다 */}
        <input ref={pick} type="file" multiple hidden onChange={(e) => { const f = Array.from(e.currentTarget.files ?? []); e.currentTarget.value = ''; if (f.length) void upload(f); }} />
      </div>
      {!trash && place && <PathCrumbs root={tr('팀 보관함', 'Team locker')} crumbs={crumbsOf(place)} onGo={setPlace} dropOf={() => ({})} back={() => setPlace(parentOf(place))} />}
      {!trash && keyWaitNote(lockedFiles(v.items), 'file') && <span className="tmx-hint m-tlk-note">{keyWaitNote(lockedFiles(v.items), 'file')}</span>}
      {(note || (err && v)) && <span className="tmx-hint m-tlk-note" role="alert" onClick={() => setNote('')}>{note || tr(`새로 못 받았어요 — ${err}`, `Couldn't refresh — ${err}`)}</span>}
      {folders.length > 0 && (
        <div className="lk-fgrid m-team-lk-folders">
          {folders.map((f) => <FolderTile key={f.key} name={f.name} title={f.key} tail={<span className="lk-count">{f.n}</span>} onOpen={() => setPlace(f.key)} />)}
        </div>
      )}
      {(files.length > 0 || sending.length > 0 || ups.length > 0) && (
        <div className="tmx-lk-rows m-team-lk">
          {!trash && sending.map((s) => <div key={s.key} className="tmx-lk-row tlk-up"><span className="tmx-ext">{extOf(s.name) || tr('파일', 'File')}</span><b>{s.name}</b><span className="d">{tr(`보내는 중 ${s.total ? Math.floor((s.sent / s.total) * 100) : 0}%`, `Sending ${s.total ? Math.floor((s.sent / s.total) * 100) : 0}%`)}</span></div>)}
          {!trash && ups.filter((u) => (u.folder ?? '') === place).map((u, k) => <div key={`u${k}`} className="tmx-lk-row tlk-up"><span className="tmx-ext">{extOf(u.name) || tr('파일', 'File')}</span><b>{u.name}</b><span className="d">{u.error ? tr(`못 올렸어요 — ${u.error}`, `Couldn't upload — ${u.error}`) : upNote(u) || tr(`올리는 중 ${u.total ? Math.floor((u.done / u.total) * 100) : 0}%`, `Uploading ${u.total ? Math.floor((u.done / u.total) * 100) : 0}%`)}</span></div>)}
          {files.map((i) => <Row key={i.id} teamId={teamId} item={i} trash={trash} onOpen={onOpen} onMenu={() => setMenu({ kind: 'file', item: i })} />)}
        </div>
      )}
      {!here && <div className="tmx-none">{trash ? tr('휴지통이 비었어요', 'Trash is empty') : place ? tr('비어 있어요', 'Empty') : tr('팀 보관함이 비었어요 — 위 더하기로 사진·파일을 올려요', 'The team locker is empty — use the plus above to add photos and files')}</div>}

      {menu && <MenuSheet menu={menu} trash={trash} chat={!!(say && chats)} onClose={() => setMenu(null)}
        onPick={(a) => {
          if (menu.kind === 'file') {
            if (a === 'chat') setAsk({ kind: 'chat', item: menu.item });
            else if (a === 'rename') setAsk({ kind: 'name', what: 'file', item: menu.item });
            else if (a === 'move') setAsk({ kind: 'move', what: 'file', item: menu.item });
            else run({ op: a === 'restore' ? 'restore' : 'trash', id: menu.item.id });
          } else if (a === 'rename') setAsk({ kind: 'name', what: 'folder', key: menu.key });
          else if (a === 'move') setAsk({ kind: 'move', what: 'folder', key: menu.key });
          else if (menu.n > 0) setAsk({ kind: 'rm-folder', key: menu.key, n: menu.n });
          else run({ op: 'folder-trash', from: menu.key }, () => setPlace(parentOf(menu.key)));
        }} />}
      {ask?.kind === 'name' && <NameSheet title={ask.what === 'mkdir' ? tr('새 폴더', 'New folder') : tr('이름 바꾸기', 'Rename')} start={ask.what === 'file' ? ask.item.name : ask.what === 'folder' ? baseOf(ask.key) : ''} cta={ask.what === 'mkdir' ? tr('만들기', 'Create') : tr('바꾸기', 'Rename')}
        onClose={() => setAsk(null)}
        onOk={(name) => {
          const n = name.trim().replace(/\//g, '-');
          if (ask.what === 'file') run({ op: 'rename', id: ask.item.id, name: n });
          else if (ask.what === 'folder') { const to = renamedPath(ask.key, n); run({ op: 'folder-rename', from: ask.key, to }, () => { if (place === ask.key) setPlace(to); }); }
          else run({ op: 'mkdir', folder: place ? `${place}/${n}` : n });
          setAsk(null);
        }} />}
      {ask?.kind === 'move' && <MoveSheet targets={ask.what === 'file' ? moveTargets(v.items, { from: ask.item.folder }) : moveTargets(v.items, { dirs: [ask.key] })} onClose={() => setAsk(null)}
        onPick={(t) => {
          if (ask.what === 'file') run({ op: 'move', id: ask.item.id, folder: t });
          else { const to = t ? `${t}/${baseOf(ask.key)}` : baseOf(ask.key); run({ op: 'folder-rename', from: ask.key, to }, () => { if (place === ask.key) setPlace(to); }); }
          setAsk(null);
        }} />}
      {ask?.kind === 'chat' && <ChatSheet chats={chatTargets(chats ?? [])} onClose={() => setAsk(null)} onPick={(c, at) => { const it = ask.item; setAsk(null); sendChat(it, c, at); }} />}
      {ask?.kind === 'rm-folder' && (
        <BottomSheet label={tr('폴더 지우기', 'Delete folder')} kind="card" title={tr(`${baseOf(ask.key)} 지우기`, `Delete ${baseOf(ask.key)}`)} onClose={() => setAsk(null)}>
          <p className="m-tlk-ask">{tr(`안의 파일 ${ask.n}개도 휴지통으로 가요 — 30일 안엔 휴지통에서 복원할 수 있어요`, `The ${ask.n} files inside go to the trash too — you can restore them from the trash within 30 days`)}</p>
          <div className="m-new-row">
            <button type="button" className="m-btn" onClick={() => setAsk(null)}>{tr('취소', 'Cancel')}</button>
            <button type="button" className="m-send" onClick={() => { const k = ask.key; run({ op: 'folder-trash', from: k }, () => setPlace(parentOf(k))); setAsk(null); }}>{tr('휴지통으로', 'Move to trash')}</button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

/** 파일 한 줄 — 그림·PDF 는 누르면 크게 보기, 길게 누르면 메뉴. 볼 길이 없는 파일(문서·엑셀)·휴지통은 눌러도 메뉴 */
function Row({ teamId, item, trash, onOpen, onMenu }: { teamId: string; item: LockerItem; trash: boolean; onOpen?: (i: LockerItem) => void; onMenu: () => void }) {
  const open = !trash && onOpen && phoneView(item) ? () => onOpen(item) : onMenu;
  const press = usePress(open, onMenu);
  // 올린 사람 = 프로필 이름(데스크톱 TeamLocker 와 같은 lookOf)
  const { board } = useContext(ProfilesCtx);
  const by = item.byMember ? lookOf(board, item.byMember, item.by).name : item.by;
  const d = [fmtBytes(item.size), whenText(item.at), by].filter(Boolean).join(' · ');
  return (
    <button type="button" className={`tmx-lk-row ${item.why ? 'tlk-locked' : ''}`} title={item.why || undefined} {...press}>
      <FileMini className="tmx-ext" id={item.id} name={item.name} lazy get={thumbKind(item.name, item.size) && !item.why && !trash ? () => teamThumbBlob(teamId, item.id) : undefined} /><b>{nameOf(item)}</b><span className="d">{d}</span>
    </button>
  );
}

type Act = 'chat' | 'rename' | 'move' | 'trash' | 'restore';
/** 줄·폴더 메뉴 — 낯선 동작이라 글자. 뜬 직후 0.45초는 손가락 밑 항목을 안 받는다 */
function MenuSheet({ menu, trash, chat = false, onClose, onPick }: { menu: Menu; trash: boolean; chat?: boolean; onClose: () => void; onPick: (a: Act) => void }) {
  const title = menu.kind === 'file' ? nameOf(menu.item) : baseOf(menu.key);
  // 팀챗에 보내기 = 파일만(잠긴 파일·폴더·휴지통엔 없다)
  const send: [Act, string][] = chat && menu.kind === 'file' ? [['chat', tr('팀챗에 보내기', 'Send to a team chat')]] : [];
  const acts: [Act, string][] = trash ? [['restore', tr('복원', 'Restore')]] : menu.kind === 'file' && menu.item.why ? [['trash', tr('휴지통으로', 'Move to trash')]] : [...send, ['rename', tr('이름 바꾸기', 'Rename')], ['move', tr('옮기기', 'Move')], ['trash', tr('휴지통으로', 'Move to trash')]];
  return (
    <BottomSheet label={title} kind="card" title={title} armMs={450} onClose={onClose}>
      {({ close, armed }) => acts.map(([a, label]) => <button key={a} type="button" className="m-menu-item" onClick={() => { if (armed) { close(); onPick(a); } }}>{label}</button>)}
    </BottomSheet>
  );
}

function NameSheet({ title, start, cta, onClose, onOk }: { title: string; start: string; cta: string; onClose: () => void; onOk: (name: string) => void }) {
  const [val, setVal] = useState(start);
  const ok = val.trim() && val.trim() !== start;
  return (
    <BottomSheet label={title} title={title} onClose={onClose}>
      <form className="m-new m-lk-name" onSubmit={(e) => { e.preventDefault(); if (ok) onOk(val); }}>
        <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder={tr('이름', 'Name')} aria-label={tr('이름', 'Name')} maxLength={200} />
        <div className="m-new-row">
          <button type="button" className="m-btn" onClick={onClose}>{tr('취소', 'Cancel')}</button>
          <button type="submit" className="m-send" disabled={!ok}>{cta}</button>
        </div>
      </form>
    </BottomSheet>
  );
}

/** 어디로 — 맨 위 + 모든 폴더(층은 들여쓰기, 이름만). 지금 자리·자기 안쪽은 moveTargets 가 뺐다 */
function MoveSheet({ targets, onClose, onPick }: { targets: string[]; onClose: () => void; onPick: (to: string) => void }) {
  return (
    <BottomSheet label={tr('어디로 옮길까요', 'Move where?')} title={tr('어디로 옮길까요', 'Move where?')} onClose={onClose}>
      {targets.map((t) => (
        <button key={t || '/'} type="button" className="m-menu-item" style={{ paddingLeft: 16 + (t ? t.split('/').length : 0) * 18 }} onClick={() => onPick(t)}>
          {t ? baseOf(t) : tr('팀 보관함(맨 위)', 'Team locker (top)')}
        </button>
      ))}
    </BottomSheet>
  );
}

/** 어느 대화에 — 팀챗 먼저, 그다음 DM(chatTargets). 누른 손가락이 사람 손 문을 연다(누른 시각) */
function ChatSheet({ chats, onClose, onPick }: { chats: Convo[]; onClose: () => void; onPick: (c: Convo, at: number) => void }) {
  return (
    <BottomSheet label={tr('어느 대화에 보낼까요', 'Send to which chat?')} title={tr('어느 대화에 보낼까요', 'Send to which chat?')} onClose={onClose}>
      {chats.length ? chats.map((c) => (
        <button key={c.key} type="button" className="m-menu-item" onClick={(e) => onPick(c, e.nativeEvent.isTrusted ? Date.now() : 0)}>{c.name}</button>
      )) : <p className="m-tlk-ask">{tr('보낼 대화가 없어요', 'No chats yet')}</p>}
    </BottomSheet>
  );
}
