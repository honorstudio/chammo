// 보관함 링크 칸(시안 locker-links v1 B, 사용자 11-06) — 늘 열린 붙여넣기 칸 + 날짜별 두 층 줄(제목 / 사이트 · 누가 어떻게). 올리면 복사·빼기,
// 파일처럼 ⌘·⇧·네모로 여러 개 골라 Backspace·아래 줄, 오른쪽 클릭 = 열기·기본 브라우저로·복사·빼기. 빼기는 목록에서만(대화 그대로) + 되돌리기.
// 누르면 부르는 쪽(onOpen)이 시안 칸 링크와 같은 길로 — 참모 브라우저 새 탭(보여 준 세션 것이면 그 세션 브라우저)
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { tr } from '../../i18n';
import { cleanLinkInput, linkTitle, linkWhoHow, type LockerLink } from '../../domain/lockerLinks';
import { logDays } from '../../domain/lockerLog';
import { IconButton } from '../kit/IconButton';
import { IconCheck, IconClose, IconCopy, IconEnter, IconTrash } from '../Icons';
import { useOrchActions } from '../orchActions';
import { usePick } from './usePick';

export type LinkActs = {
  /** at = 누른 줄(스페이스 안 — 시안 칸 링크 다리가 자리를 본다) */
  onOpen: (l: LockerLink, at: Element) => void;
  /** 기본 브라우저(크롬 등)로 */
  onOpenOut: (l: LockerLink) => void;
  onAdd: (url: string) => Promise<unknown>;
  /** hide = true 빼기 · false 되돌리기 */
  onHide: (ids: string[], hide: boolean) => Promise<unknown>;
};

const hm = (ts: string) => { const d = new Date(ts); return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function LinksView({ head, links, whoOf, acts }: { head: ReactNode; links: LockerLink[]; whoOf: (by: string) => string; acts: LinkActs }) {
  const box = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [undo, setUndo] = useState<string[] | null>(null);
  const order = links.map((l) => l.id);
  const pick = usePick({ box, order, reset: 'links', skip: '[data-pick], button, input, .lk-selbar', touch: () => setUndo(null) });
  const { sel, end } = pick;
  const act = useOrchActions();
  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), 10000);
    return () => window.clearTimeout(t);
  }, [undo]);
  const add = async () => {
    const url = cleanLinkInput(text);
    if (!url) { setBad(true); return; }
    setBusy(true);
    try { await acts.onAdd(url); setText(''); setBad(false); } catch { setBad(true); } finally { setBusy(false); }
  };
  const hide = (ids: string[]) => { if (ids.length) void acts.onHide(ids, true).then(() => { end(); setUndo(ids); }, () => {}); };
  const copy = (urls: string[], key: string) => void (navigator.clipboard?.writeText(urls.join('\n')) ?? Promise.reject(new Error('no clipboard'))).then(() => {
    setCopied(key);
    window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
  }, () => {});
  // Backspace·Delete = 고른 것 빼기, Esc = 풀기 — 이 칸 안 포커스일 때만(입력칸 밖)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    const t = e.target as HTMLElement | null;
    if (!t || !box.current?.contains(t) || t.closest('input, textarea')) return;
    if (e.key === 'Escape' && sel.keys.length) { end(); return; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && sel.keys.length && !e.isComposing) { e.preventDefault(); hide(sel.keys); }
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const urlsOf = (ids: string[]) => links.filter((l) => ids.includes(l.id)).map((l) => l.url);
  const menu = (x: React.MouseEvent, l: LockerLink) => {
    if (!act) return;
    if (pick.many(l.id)) {
      act.openMenu(x, [
        { label: tr(`${sel.keys.length}개 주소 복사`, `Copy ${sel.keys.length} addresses`), run: () => copy(urlsOf(sel.keys), 'sel') },
        { label: tr(`${sel.keys.length}개 목록에서 빼기`, `Remove ${sel.keys.length} from list`), sep: true, run: () => hide(sel.keys) },
      ]);
      return;
    }
    pick.right(l.id);
    const at = x.currentTarget;
    act.openMenu(x, [
      { label: tr('열기', 'Open'), run: () => acts.onOpen(l, at) },
      { label: tr('기본 브라우저로 열기', 'Open in default browser'), run: () => acts.onOpenOut(l) },
      { label: tr('주소 복사', 'Copy address'), run: () => copy([l.url], l.id) },
      { label: tr('목록에서 빼기', 'Remove from list'), sep: true, run: () => hide([l.id]) },
    ]);
  };
  const row = (l: LockerLink) => {
    const t = linkTitle(l);
    const sub = [t.title ? t.host : '', linkWhoHow(l, whoOf(l.by))].filter(Boolean).join(' · ');
    return (
      <div key={l.id} className={`lkl-row ${pick.picked(l.id) ? 'picked' : ''}`} data-pick={l.id} role="button" tabIndex={0} title={l.url}
        onClick={(x) => { if (!pick.press(x, l.id)) acts.onOpen(l, x.currentTarget); }} onKeyDown={(x) => { if (x.key === 'Enter' && x.target === x.currentTarget) acts.onOpen(l, x.currentTarget); }}
        onContextMenu={(x) => menu(x, l)}>
        <span className="lkl-mid">
          {t.title ? <b>{t.title}</b> : <b>{t.host}<span className="lkl-path">{t.rest}</span></b>}
          <span className="lkl-sub">{sub}</span>
        </span>
        <span className="lkl-time">{hm(l.ts)}</span>
        <span className="lkl-acts">
          <IconButton size="s" label={copied === l.id ? tr('복사함', 'Copied') : tr('주소 복사', 'Copy address')} onClick={(x) => { x.stopPropagation(); copy([l.url], l.id); }}>{copied === l.id ? <IconCheck /> : <IconCopy />}</IconButton>
          <IconButton size="s" label={tr('목록에서 빼기', 'Remove from list')} onClick={(x) => { x.stopPropagation(); hide([l.id]); }}><IconTrash /></IconButton>
        </span>
      </div>
    );
  };
  const n = sel.keys.length;
  return (
    <div className="lk-page-wrap lkl" tabIndex={-1} data-select-all="" ref={box} onMouseDown={pick.noShiftSelect} onPointerDown={pick.bandStart}>
      {head}
      <form className={`lkl-paste ${bad ? 'bad' : ''}`} onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input value={text} disabled={busy} placeholder={tr('주소 붙여넣기', 'Paste an address')} aria-label={tr('링크 넣기', 'Add a link')} inputMode="url" spellCheck={false}
          onChange={(e) => { setText(e.target.value); setBad(false); }} onKeyDown={(e) => { if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault(); }} />
        {text.trim() && <span className="lkl-key" aria-hidden="true"><IconEnter /></span>}
      </form>
      {bad && <div className="lkl-bad" role="alert">{tr('주소꼴이 아니에요 — https:// 로 시작하는 주소 하나', 'Not an address — one https:// link')}</div>}
      {links.length === 0
        ? <div className="cv-blank">{tr('아직 주고받은 링크가 없어요 — 대화에 주소가 오가면 여기 모여요', 'No links yet — addresses from your chats gather here')}</div>
        : logDays(links).map((g) => (
          <section key={g.label} className="lk-day">
            <div className="lk-sub">{g.label}</div>
            <div className="lkl-list">{g.items.map(row)}</div>
          </section>
        ))}
      {pick.band && <div className="lk-band" style={pick.band} aria-hidden="true" />}
      {n > 0 ? (
        <div className="lk-selbar" role="toolbar" aria-label={tr('고른 것', 'Selection')}>
          <b className="lk-selcount">{tr(`${n}개 고름`, `${n} selected`)}</b>
          <span className="lk-sp" />
          <IconButton label={copied === 'sel' ? tr('복사함', 'Copied') : tr('주소 복사', 'Copy addresses')} onClick={() => copy(urlsOf(sel.keys), 'sel')}>{copied === 'sel' ? <IconCheck /> : <IconCopy />}</IconButton>
          <IconButton label={tr('목록에서 빼기', 'Remove from list')} onClick={() => hide(sel.keys)}><IconTrash /></IconButton>
          <IconButton label={tr('고른 것 풀기', 'Clear selection')} title={tr('고른 것 풀기 (Esc)', 'Clear selection (Esc)')} onClick={end}><IconClose /></IconButton>
        </div>
      ) : undo && (
        <div className="lk-selbar lk-undo" role="status">
          <span className="lk-ask"><b>{tr(`링크 ${undo.length}개를 목록에서 뺐어`, `Removed ${undo.length} from the list`)}</b></span>
          <span className="lk-sp" />
          <button className="btn" onClick={() => { void acts.onHide(undo, false); setUndo(null); }}>{tr('되돌리기', 'Undo')}</button>
          <IconButton label={tr('닫기', 'Close')} onClick={() => setUndo(null)}><IconClose /></IconButton>
        </div>
      )}
    </div>
  );
}
