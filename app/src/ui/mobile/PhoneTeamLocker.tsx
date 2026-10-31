// 폰 팀 보관함 — 중계 팀 보관함 그대로(데스크톱 TeamLocker 와 같은 목록·폴더 구조, 10-28 사용자 "모바일 팀 보관함이 비어 있다"·"폰에서도 관리").
// 전엔 데스크톱에 '이 기기에 저장'한 팀 폴더만 봐서 늘 비었다. 읽기는 폰 서버(/api/team-locker — 본 판 그대로면 same, 보는 동안 4초),
// 바꾸기·올리기도 데스크톱과 같은 길로 서버가 한다. 영구 지우기는 데스크톱 팀 보관함 휴지통에서만
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhoneLockerOp, PhoneTeamLocker as View, PhoneTeamUps, TeamPhoneApi } from '../../data/web';
import { baseOf, crumbsOf, extOf, fmtBytes, inPlace, kidFolders, moveTargets, parentOf, renamedPath, usageText, whenText, type LockerItem } from '../../domain/teamLocker';
import { partsOf } from '../../domain/teamPhoneUp';
import { teamViewMemo } from '../../domain/teamViewMemo';
import { machine, tr } from '../../i18n';
import { FolderTile, PathCrumbs } from '../space/FolderTile';
import { IconFolder, IconMore, IconPlus, IconTrash } from '../Icons';
import { BottomSheet } from './BottomSheet';
import { IconBtn } from './kit';
import { usePress } from './PhoneLockerParts';

/** 팀마다 마지막 목록 — 대화·팀 홈 칸을 갔다 와도 바로 그린다 */
const memo = teamViewMemo<View>();

type Menu = { kind: 'file'; item: LockerItem } | { kind: 'folder'; key: string; n: number };
type Ask =
  | { kind: 'name'; what: 'file'; item: LockerItem }
  | { kind: 'name'; what: 'folder'; key: string }
  | { kind: 'name'; what: 'mkdir' }
  | { kind: 'move'; what: 'file'; item: LockerItem }
  | { kind: 'move'; what: 'folder'; key: string }
  | { kind: 'rm-folder'; key: string; n: number };
type OpBody = PhoneLockerOp extends infer T ? (T extends unknown ? Omit<T, 'team'> : never) : never;

const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 160);
const nameOf = (i: LockerItem) => i.name || tr('열 수 없는 파일', 'Unreadable file');

export function PhoneTeamLocker({ api, teamId }: { api: TeamPhoneApi; teamId: string }) {
  const [v, setV] = useState<View | null>(() => memo.get(teamId)?.v ?? null);
  const [ups, setUps] = useState<PhoneTeamUps['uploads']>([]);
  const [sending, setSending] = useState<{ key: string; name: string; sent: number; total: number }[]>([]);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [place, setPlace] = useState('');
  const [trash, setTrash] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [adding, setAdding] = useState(false);
  const rev = useRef(0);
  const busy = useRef(false);
  /** 받는 중에 '꼭 새로'가 오면(바꾼 직후) 끝난 뒤 한 번 더 */
  const again = useRef(false);
  const going = useRef(0);

  const read = useCallback((force = false) => {
    if (busy.current) { if (force) again.current = true; return; }
    busy.current = true;
    void api.locker(teamId, force ? 0 : rev.current).then((x) => {
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
    }, (e: unknown) => setErr(errText(e))).finally(() => {
      busy.current = false;
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
  const upload = async (files: FileList) => {
    const to = place;
    for (const f of Array.from(files)) {
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
        {!trash && <IconBtn label={tr('추가', 'Add')} onClick={() => setAdding(true)}><IconPlus /></IconBtn>}
      </div>
      {!trash && place && <PathCrumbs root={tr('팀 보관함', 'Team locker')} crumbs={crumbsOf(place)} onGo={setPlace} dropOf={() => ({})} back={() => setPlace(parentOf(place))} />}
      {(note || (err && v)) && <span className="tmx-hint m-tlk-note" role="alert" onClick={() => setNote('')}>{note || tr(`새로 못 받았어요 — ${err}`, `Couldn't refresh — ${err}`)}</span>}
      {folders.length > 0 && (
        <div className="lk-fgrid m-team-lk-folders">
          {folders.map((f) => <FolderTile key={f.key} name={f.name} title={f.key} tail={<span className="lk-count">{f.n}</span>} onOpen={() => setPlace(f.key)} />)}
        </div>
      )}
      {(files.length > 0 || sending.length > 0 || ups.length > 0) && (
        <div className="tmx-lk-rows m-team-lk">
          {!trash && sending.map((s) => <div key={s.key} className="tmx-lk-row tlk-up"><span className="tmx-ext">{extOf(s.name) || tr('파일', 'File')}</span><b>{s.name}</b><span className="d">{tr(`보내는 중 ${s.total ? Math.floor((s.sent / s.total) * 100) : 0}%`, `Sending ${s.total ? Math.floor((s.sent / s.total) * 100) : 0}%`)}</span></div>)}
          {!trash && ups.map((u, k) => <div key={`u${k}`} className="tmx-lk-row tlk-up"><span className="tmx-ext">{extOf(u.name) || tr('파일', 'File')}</span><b>{u.name}</b><span className="d">{u.error ? tr(`못 올렸어요 — ${u.error}`, `Couldn't upload — ${u.error}`) : tr(`올리는 중 ${u.total ? Math.floor((u.done / u.total) * 100) : 0}%`, `Uploading ${u.total ? Math.floor((u.done / u.total) * 100) : 0}%`)}</span></div>)}
          {files.map((i) => <Row key={i.id} item={i} onMenu={() => setMenu({ kind: 'file', item: i })} />)}
        </div>
      )}
      {!here && <div className="tmx-none">{trash ? tr('휴지통이 비었어요', 'Trash is empty') : place ? tr('비어 있어요', 'Empty') : tr('팀 보관함이 비었어요 — 위 더하기로 사진·파일을 올려요', 'The team locker is empty — use the plus above to add photos and files')}</div>}

      {menu && <MenuSheet menu={menu} trash={trash} onClose={() => setMenu(null)}
        onPick={(a) => {
          if (menu.kind === 'file') {
            if (a === 'rename') setAsk({ kind: 'name', what: 'file', item: menu.item });
            else if (a === 'move') setAsk({ kind: 'move', what: 'file', item: menu.item });
            else run({ op: a === 'restore' ? 'restore' : 'trash', id: menu.item.id });
          } else if (a === 'rename') setAsk({ kind: 'name', what: 'folder', key: menu.key });
          else if (a === 'move') setAsk({ kind: 'move', what: 'folder', key: menu.key });
          else if (menu.n > 0) setAsk({ kind: 'rm-folder', key: menu.key, n: menu.n });
          else run({ op: 'folder-trash', from: menu.key }, () => setPlace(parentOf(menu.key)));
        }} />}
      {adding && <AddSheet onClose={() => setAdding(false)} onFiles={(f) => void upload(f)} onFolder={() => setAsk({ kind: 'name', what: 'mkdir' })} />}
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
      {ask?.kind === 'rm-folder' && (
        <BottomSheet label={tr('폴더 지우기', 'Delete folder')} kind="card" title={tr(`${baseOf(ask.key)} 지우기`, `Delete ${baseOf(ask.key)}`)} onClose={() => setAsk(null)}>
          <p className="m-tlk-ask">{tr(`안의 파일 ${ask.n}개도 휴지통으로 가요 — 30일 안엔 휴지통에서 되살릴 수 있어요`, `The ${ask.n} files inside go to the trash too — you can restore them from the trash within 30 days`)}</p>
          <div className="m-new-row">
            <button type="button" className="m-btn" onClick={() => setAsk(null)}>{tr('취소', 'Cancel')}</button>
            <button type="button" className="m-send" onClick={() => { const k = ask.key; run({ op: 'folder-trash', from: k }, () => setPlace(parentOf(k))); setAsk(null); }}>{tr('휴지통으로', 'Move to trash')}</button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

/** 파일 한 줄 — 누르거나 길게 누르면 메뉴(폰에선 아직 팀 파일을 못 연다) */
function Row({ item, onMenu }: { item: LockerItem; onMenu: () => void }) {
  const press = usePress(onMenu, onMenu);
  const d = [fmtBytes(item.size), whenText(item.at), item.by].filter(Boolean).join(' · ');
  return (
    <button type="button" className={`tmx-lk-row ${item.why ? 'tlk-locked' : ''}`} title={item.why || undefined} {...press}>
      <span className="tmx-ext">{extOf(item.name) || tr('파일', 'File')}</span><b>{nameOf(item)}</b><span className="d">{d}</span>
    </button>
  );
}

type Act = 'rename' | 'move' | 'trash' | 'restore';
/** 줄·폴더 메뉴 — 낯선 동작이라 글자. 뜬 직후 0.45초는 손가락 밑 항목을 안 받는다 */
function MenuSheet({ menu, trash, onClose, onPick }: { menu: Menu; trash: boolean; onClose: () => void; onPick: (a: Act) => void }) {
  const title = menu.kind === 'file' ? nameOf(menu.item) : baseOf(menu.key);
  const acts: [Act, string][] = trash ? [['restore', tr('되살리기', 'Restore')]] : menu.kind === 'file' && menu.item.why ? [['trash', tr('휴지통으로', 'Move to trash')]] : [['rename', tr('이름 바꾸기', 'Rename')], ['move', tr('옮기기', 'Move')], ['trash', tr('휴지통으로', 'Move to trash')]];
  return (
    <BottomSheet label={title} kind="card" title={title} armMs={450} onClose={onClose}>
      {({ close, armed }) => acts.map(([a, label]) => <button key={a} type="button" className="m-menu-item" onClick={() => { if (armed) { close(); onPick(a); } }}>{label}</button>)}
    </BottomSheet>
  );
}

/** 더하기 — 사진·파일 올리기(지금 보는 폴더에) · 새 폴더 */
function AddSheet({ onClose, onFiles, onFolder }: { onClose: () => void; onFiles: (f: FileList) => void; onFolder: () => void }) {
  const photo = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const pick = (el: HTMLInputElement | null, close: () => void) => {
    if (!el) return;
    el.onchange = () => { if (el.files?.length) onFiles(el.files); close(); };
    el.click();
  };
  return (
    <BottomSheet label={tr('팀 보관함에 더하기', 'Add to team locker')} kind="card" title={tr('팀 보관함에', 'To team locker')} onClose={onClose}>
      {({ close }) => (
        <>
          <button type="button" className="m-menu-item" onClick={() => pick(photo.current, close)}>{tr('사진 올리기', 'Upload photo')}</button>
          <button type="button" className="m-menu-item" onClick={() => pick(file.current, close)}>{tr('파일 올리기', 'Upload file')}</button>
          <button type="button" className="m-menu-item" onClick={() => { close(); onFolder(); }}>{tr('새 폴더', 'New folder')}</button>
          <input ref={photo} type="file" accept="image/*,video/*" multiple hidden />
          <input ref={file} type="file" multiple hidden />
        </>
      )}
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
