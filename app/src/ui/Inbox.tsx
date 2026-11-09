// 결정 대기함 — 상단 바 종을 누르면 종에서 나온 말풍선으로 한 장씩(시안 docs/design-drafts/inbox-today v2, 2026-11-05 사용자 'C 한 장씩').
// 여기서 바로 답장(그 세션 입력칸에 들어감)·열기·처리함. InboxRow(줄 모양)는 홈 결정 펼침·보관함 '내가 볼 차례'가 그대로 쓴다
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { gateReply, replyHint, type InboxItem } from '../domain/inbox';
import { closesOnOutside, whenText, type DeckPage } from '../domain/inboxDeck';
import { useDeck } from './useDeck';
import { IconCheck, IconChevron, IconNext, IconOpen, IconPrev, IconSend } from './Icons';
import { IconButton } from './kit/IconButton';
import { askNote, foldNote } from '../domain/askNote';
import { tr } from '../i18n';

const KIND = (): Record<InboxItem['kind'], string> => ({
  ask: tr('물어봄', 'Question'), blocked: tr('확인창', 'Prompt'), decide: tr('결정', 'Decision'),
});

const PLAIN_HINT = () => tr('답을 적어 주세요', 'Type your answer');

const time = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(tr('ko-KR', 'en-US'), { hour: '2-digit', minute: '2-digit' });
};

type Acts = {
  /** 답장을 못 넣는 이유(없으면 null) */
  blockedWhy: (item: InboxItem) => string | null;
  onReply: (item: InboxItem, text: string) => Promise<void>;
  onOpen: (target: string) => void;
  onDismiss: (item: InboxItem) => void;
};

/** 답장 칸 — 줄(InboxRow)·한 장(InboxCard)이 같이 쓴다. 실패하면 친 글은 남기고 그 줄에 까닭(2026-11-01 ux-daily M15) */
function useReply(item: InboxItem, onReply: Acts['onReply']) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState('');
  const send = async (t = text.trim()) => {
    if (!t) return;
    setBusy(true);
    setFail('');
    try {
      await onReply(item, t);
      setText('');
    } catch (e: unknown) {
      setFail(tr(`답장 실패: ${e instanceof Error ? e.message : String(e)}`, `Reply failed: ${e instanceof Error ? e.message : String(e)}`));
    } finally {
      setBusy(false);
    }
  };
  return { text, setText, busy, fail, send };
}

function ReplyBox({ item, r, hint }: { item: InboxItem; r: ReturnType<typeof useReply>; hint: string }) {
  return <>
    <div className="inbox-reply">
      <input className="inp" placeholder={hint} value={r.text} disabled={r.busy} onChange={(e) => r.setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void r.send(); }} />
      <button className="ib pri" title={tr('보내기 (Enter)', 'Send (Enter)')} aria-label={tr('보내기', 'Send')} disabled={r.busy || !r.text.trim()} onClick={() => void r.send()}><IconSend /></button>
    </div>
    {/* 보내기 관문(… 보내도 돼?) — 참모가 '보내도 돼를 누르면'이라 안내하는데 단추가 없었다(QA 12). 되돌리기 어려운 동작이라 글자 단추 */}
    {item.gate && (
      <div className="inbox-gate">
        <button className="btn pri" disabled={r.busy} onClick={() => void r.send(gateReply(true))}>{tr('보내도 돼', 'OK to send')}</button>
        <button className="btn" disabled={r.busy} onClick={() => void r.send(gateReply(false))}>{tr('보내지 마', 'Do not send')}</button>
      </div>
    )}
  </>;
}

function ItemActs({ item, onOpen, onDismiss }: { item: InboxItem } & Pick<Acts, 'onOpen' | 'onDismiss'>) {
  return (
    <div className="inbox-acts">
      {item.target && <button className="ib" title={tr('그 세션 열기', 'Open that session')} aria-label={tr('열기', 'Open')} onClick={() => onOpen(item.target!)}><IconOpen /></button>}
      <button className="ib" title={tr('처리함 — 목록에서 치우기', 'Done — remove from list')} aria-label={tr('처리함', 'Done')} onClick={() => onDismiss(item)}><IconCheck /></button>
    </div>
  );
}

/** 물음 한 줄 — 홈 결정 펼침(그 자리에서 답장)·보관함 '내가 볼 차례'가 쓴다 */
/** plain = 보관함 프로젝트 '내가 볼 차례' 카드 안 — 머리줄(종류·폴더 이름·시각)은 카드 제목이 대신하고 자리글은 사람 말로 */
export function InboxRow({ item, onReply, onOpen, onDismiss, blockedWhy, plain }: { item: InboxItem; plain?: boolean } & Acts) {
  const r = useReply(item, onReply);
  const [open, setOpen] = useState(false);
  const note = askNote(item.text);
  const fold = foldNote(note, open);
  const why = item.kind === 'blocked' ? null : item.target ? blockedWhy(item) : null;
  const canReply = item.kind !== 'blocked' && !!item.target && !why;
  return (
    <div className="inbox-item">
      {!plain && (
        <div className="card-top">
          <span className="tag needsInput">{KIND()[item.kind]}</span>
          <b>{item.project}{item.where && <span className="dim"> · {item.where}</span>}</b>
          <span className="dim">{time(item.ts)}</span>
        </div>
      )}
      {item.lead && <div className="inbox-lead">{item.lead}</div>}
      <div className={`inbox-text${open ? ' open' : ''}`}>
        <div className="inbox-q">{note.head}</div>
        {fold.body.map((l, i) => <div key={i} className="inbox-line">{l}</div>)}
        {fold.more && (
          <button className="ib inbox-more" aria-expanded={open} title={open ? tr('접기', 'Show less') : tr('더 보기', 'Show more')} aria-label={open ? tr('접기', 'Show less') : tr('더 보기', 'Show more')} onClick={() => setOpen(!open)}><IconChevron /></button>
        )}
        {note.answerLine && <div className="inbox-line inbox-answers">{note.answerLine}</div>}
      </div>
      {canReply && <ReplyBox item={item} r={r} hint={plain ? PLAIN_HINT() : replyHint(item)} />}
      {why && <div className="inbox-why">{why}</div>}
      {r.fail && !why && <div className="inbox-why" role="alert">{r.fail}</div>}
      <ItemActs item={item} onOpen={onOpen} onDismiss={onDismiss} />
    </div>
  );
}

/** 대기함 한 장 — 물음은 줄임 없이 끝까지(11-05 사용자 "질문이 잘려 보이는 게 있음"). 운영 줄은 노란 표식만, 그냥 물음은 표식 없음 */
export function InboxCard({ item, onReply, onOpen, onDismiss, blockedWhy }: { item: InboxItem } & Acts) {
  const r = useReply(item, onReply);
  const note = askNote(item.text);
  const why = item.kind === 'blocked' ? null : item.target ? blockedWhy(item) : null;
  const canReply = item.kind !== 'blocked' && !!item.target && !why;
  const mark = item.gate ? tr('발송', 'Send') : item.kind === 'decide' ? KIND().decide : null;
  return (
    <div className="ibx-card">
      <div className="ibx-who">
        <span className="dc-av" aria-hidden="true">{(item.project || '?').slice(0, 1)}</span>
        <b>{item.project}{item.where && <span className="dim"> · {item.where}</span>}</b>
        {mark && <span className="dc-risk dc-warn">{mark}</span>}
        <em>{whenText(item.ts, Date.now())}</em>
      </div>
      {item.lead && <div className="ibx-lead">{item.lead}</div>}
      <div className="ibx-q">{note.head}</div>
      {note.body.map((l, i) => <div key={i} className="ibx-line">{l}</div>)}
      {note.answerLine && <div className="ibx-line inbox-answers">{note.answerLine}</div>}
      {canReply && <ReplyBox item={item} r={r} hint={replyHint(item)} />}
      {why && <div className="inbox-why">{why}</div>}
      {r.fail && !why && <div className="inbox-why" role="alert">{r.fail}</div>}
      <ItemActs item={item} onOpen={onOpen} onDismiss={onDismiss} />
    </div>
  );
}

/** 대기함 한 장 — rank 0 결제·삭제 · 1 운영·결정·사람 승인 · 2 그냥 물음(domain/inboxDeck), who = 아래 줄 머리글자 */
export type InboxPage = DeckPage & { who: string; node: ReactNode };

/** 종에서 나온 말풍선 — 한 장씩, 아래 줄에 남은 카드 머리글자·넘기기. 제목 막대·닫기 X 없음.
 *  닫힘(2026-11-05 사용자 '나눠서'): 그냥 물음만 있으면 바깥을 누르거나 Esc 로 닫힌다. 결제·운영 카드가 하나라도 있으면
 *  바깥 클릭·Esc 로 안 닫히고 종을 다시 눌러야 닫힌다 — 터미널을 누르거나 Claude 를 Esc 로 멈추다 결정을 놓치면 안 돼서 */
export function InboxPopover({ open, onClose, pages }: { open: boolean; onClose: () => void; pages: InboxPage[] }) {
  const { deck, at, cur, go, arming } = useDeck(pages, open);
  const box = useRef<HTMLDivElement>(null);
  const loose = closesOnOutside(deck);
  useEffect(() => {
    if (!open || !loose) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t && (box.current?.contains(t) || t.closest('.bell'))) return; // 종은 App 이 열고 닫는다
      onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key); };
  }, [open, loose, onClose]);
  if (!open) return null;
  const others = deck.filter((_, i) => i !== at);
  return (
    <div ref={box} className={`inbox-pop${cur?.rank === 0 ? ' pay' : ''}`} role="dialog"
      aria-label={deck.length ? tr(`결정 대기 ${at + 1} / ${deck.length}`, `Decision ${at + 1} of ${deck.length}`) : tr('결정 대기', 'Decisions')}>
      <div className="ibx-body">
      {!cur ? <div className="inbox-empty">{tr('결정할 거 없어', 'Nothing to decide')}</div> : <>
        <div key={cur.key} className={`ibx-page${arming ? ' arming' : ''}`}>{cur.node}</div>
        {others.length > 0 && (
          <div className="ibx-foot">
            {others.slice(0, 4).map((p) => <span key={p.key} className="dc-av" aria-hidden="true">{(p.who || '?').slice(0, 1)}</span>)}
            <span className="ibx-more">{tr(`${others.length}개 더`, `${others.length} more`)}</span>
            <IconButton size="s" className="ibx-nav" label={tr('이전 물음', 'Previous')} onClick={() => go(-1)}><IconPrev /></IconButton>
            <IconButton size="s" label={tr('다음 물음', 'Next')} onClick={() => go(1)}><IconNext /></IconButton>
          </div>
        )}
      </>}
      </div>
    </div>
  );
}
