// 폰 보관함 링크 칸(시안 locker-links v1 B2, 사용자 11-06) — 붙여넣기 칸 + 날짜별 두 층 줄(제목 / 사이트 · 누가 어떻게 · 시각).
// 밀면 빼기(SwipeRow — 폰의 밀기 줄은 다 이것 하나, 익숙한 동작이라 아이콘), 길게 누르면 열기 · 주소 복사 · 목록에서 빼기, 뺀 뒤 되돌리기.
// 누르면 새 창(사파리) — 폰엔 참모 브라우저 칸이 없다. 빼기는 목록에서만(대화 그대로)
import { useState } from 'react';
import { tr } from '../../i18n';
import { lockerLinkAdd, lockerLinkHide } from '../../data/web';
import { cleanLinkInput, linkTitle, linkWhoHow, type LockerLink } from '../../domain/lockerLinks';
import { logDays } from '../../domain/lockerLog';
import { IconPlus, IconTrash } from '../Icons';
import { BottomSheet, IconBtn } from './kit';
import { SwipeRow } from './SwipeRow';

const hm = (ts: string) => { const d = new Date(ts); return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const titleOf = (l: LockerLink) => { const t = linkTitle(l); return t.title || `${t.host}${t.rest}`; };

export function PhoneLinks({ owner, links, whoOf, onChanged, onSay }: {
  owner: string;
  /** 모은 것 + 보여 준 주소(mergeLinks) */
  links: LockerLink[];
  whoOf: (by: string) => string;
  /** 넣기·빼기 뒤 다시 읽기 */
  onChanged: () => void;
  /** 아래 알림 한 줄(되돌리기 단추가 붙을 수 있다) */
  onSay: (text: string, undo?: () => void) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [held, setHeld] = useState<LockerLink | null>(null);
  const add = async () => {
    const url = cleanLinkInput(text);
    if (!url) { onSay(tr('주소꼴이 아니에요 — https:// 로 시작하는 주소 하나', 'Not an address — one https:// link')); return; }
    setBusy(true);
    try {
      await lockerLinkAdd(owner, url);
      setText('');
      onChanged();
    } catch (e) {
      onSay(tr(`못 넣었어요 — ${(e as Error).message}`, `Couldn't add — ${(e as Error).message}`));
    } finally {
      setBusy(false);
    }
  };
  const hide = (l: LockerLink) => void lockerLinkHide(owner, l.id, true).then(() => {
    onChanged();
    onSay(tr('목록에서 뺐어요', 'Removed from the list'), () => void lockerLinkHide(owner, l.id, false).then(onChanged, () => {}));
  }, (e: unknown) => onSay(tr(`못 뺐어요 — ${(e as Error).message}`, `Couldn't remove — ${(e as Error).message}`)));
  const open = (l: LockerLink) => { window.open(l.url, '_blank', 'noopener'); };
  const copy = (l: LockerLink) => void navigator.clipboard?.writeText(l.url).then(() => onSay(tr('주소를 복사했어요', 'Address copied')), () => {});
  const row = (l: LockerLink) => {
    const t = linkTitle(l);
    const sub = [t.title ? t.host : '', linkWhoHow(l, whoOf(l.by)), hm(l.ts)].filter(Boolean).join(' · ');
    return (
      <SwipeRow key={l.id} id={l.id} openId={openId} setOpenId={setOpenId} onMenu={() => setHeld(l)} menuLabel={tr(`${titleOf(l)} 메뉴`, `${titleOf(l)} menu`)}
        actions={[{ label: tr('목록에서 빼기', 'Remove from list'), icon: <IconTrash />, danger: true, onPress: () => hide(l) }]}>
        <button type="button" className="m-lk-row m-lkl-row" onClick={() => open(l)} title={l.url}>
          <span className="m-lk-mid">
            <span className="m-lk-nm m-lkl-nm">{t.title || t.host}{!t.title && t.rest && <span className="m-lkl-path">{t.rest}</span>}</span>
            <span className="m-file-meta">{sub}</span>
          </span>
        </button>
      </SwipeRow>
    );
  };
  return (
    <>
      <form className="m-lkl-paste" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input value={text} disabled={busy} onChange={(e) => setText(e.target.value)} placeholder={tr('주소 붙여넣기', 'Paste an address')} aria-label={tr('링크 넣기', 'Add a link')}
          inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        <IconBtn label={tr('넣기', 'Add')} disabled={busy || !text.trim()} onClick={() => void add()}><IconPlus /></IconBtn>
      </form>
      {links.length === 0 ? <p className="m-muted m-sm">{tr('아직 주고받은 링크가 없어요 — 대화에 주소가 오가면 여기 모여요', 'No links yet — addresses from your chats gather here')}</p> : logDays(links).map((g) => (
        <section key={g.label}>
          <div className="m-sect">{g.label}</div>
          <div className="m-lkl-list">{g.items.map(row)}</div>
        </section>
      ))}
      {held && (
        <BottomSheet label={titleOf(held)} kind="card" title={titleOf(held)} armMs={450} onClose={() => setHeld(null)}>
          {({ close, armed }) => (
            <>
              <button type="button" className="m-menu-item" onClick={() => { if (armed) { close(); open(held); } }}>{tr('열기', 'Open')}</button>
              <button type="button" className="m-menu-item" onClick={() => { if (armed) { close(); copy(held); } }}>{tr('주소 복사', 'Copy address')}</button>
              <button type="button" className="m-menu-item" onClick={() => { if (armed) { close(); hide(held); } }}>{tr('목록에서 빼기', 'Remove from list')}</button>
            </>
          )}
        </BottomSheet>
      )}
    </>
  );
}
