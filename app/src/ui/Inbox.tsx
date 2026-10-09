// 결정 대기함 — 상단 바 종을 누르면 아래로 펼쳐지는 드롭다운. 작업 패널과 따로 논다.
// 여기서 바로 답장(그 세션 입력칸에 들어감)·열기·처리함. 물음은 줄 그대로 — 첫 줄만 굵게, 길면 앞 3줄 + 펼침(domain/askNote, 폰 카드와 같은 판단)
import { useState, type ReactNode } from 'react';
import type { InboxItem } from '../domain/inbox';
import { IconCheck, IconChevron, IconClose, IconOpen, IconSend } from './Icons';
import { askNote, foldNote } from '../domain/askNote';
import { tr } from '../i18n';

const KIND = (): Record<InboxItem['kind'], string> => ({
  ask: tr('물어봄', 'Question'), blocked: tr('확인창', 'Prompt'), decide: tr('결정', 'Decision'),
});

const time = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(tr('ko-KR', 'en-US'), { hour: '2-digit', minute: '2-digit' });
};

type Props = {
  items: InboxItem[];
  /** 답장을 못 넣는 이유(없으면 null) */
  blockedWhy: (item: InboxItem) => string | null;
  onReply: (item: InboxItem, text: string) => Promise<void>;
  onOpen: (target: string) => void;
  onDismiss: (item: InboxItem) => void;
  /** 로그인 풀림 카드(ui/LoginCard) — 맨 위에, 하나 */
  login?: ReactNode;
  /** 브라우저 연결 카드(ui/BrowserAttach) — 로그인 카드 다음 */
  browser?: ReactNode;
  browserCount?: number;
  /** 직접 답하기 카드(하위 세션이 사람 승인을 기다림) — 맨 위에 */
  direct?: ReactNode;
  directCount?: number;
};

function Row({ item, onReply, onOpen, onDismiss, blockedWhy }: { item: InboxItem } & Omit<Props, 'items' | 'direct' | 'login' | 'browser'>) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const note = askNote(item.text);
  const fold = foldNote(note, open);
  const why = item.kind === 'blocked' ? null : item.target ? blockedWhy(item) : null;
  const canReply = item.kind !== 'blocked' && !!item.target && !why;
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await onReply(item, text.trim());
      setText('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="inbox-item">
      <div className="card-top">
        <span className="tag needsInput">{KIND()[item.kind]}</span>
        <b>{item.project}{item.where && <span className="dim"> · {item.where}</span>}</b>
        <span className="dim">{time(item.ts)}</span>
      </div>
      {item.lead && <div className="inbox-lead">{item.lead}</div>}
      <div className={`inbox-text${open ? ' open' : ''}`}>
        <div className="inbox-q">{note.head}</div>
        {fold.body.map((l, i) => <div key={i} className="inbox-line">{l}</div>)}
        {fold.more && (
          <button className="ib inbox-more" aria-expanded={open} title={open ? tr('접기', 'Show less') : tr('더 보기', 'Show more')} aria-label={open ? tr('접기', 'Show less') : tr('더 보기', 'Show more')} onClick={() => setOpen(!open)}><IconChevron /></button>
        )}
        {note.answerLine && <div className="inbox-line inbox-answers">{note.answerLine}</div>}
      </div>
      {canReply && (
        <div className="inbox-reply">
          <input
            className="inp"
            placeholder={tr('답장 — 그 세션 입력칸에 들어가', "Reply — goes into that session's input")}
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send(); }}
          />
          <button className="ib pri" title={tr('보내기 (Enter)', 'Send (Enter)')} aria-label={tr('보내기', 'Send')} disabled={busy || !text.trim()} onClick={() => void send()}><IconSend /></button>
        </div>
      )}
      {why && <div className="inbox-why">{why}</div>}
      <div className="inbox-acts">
        {item.target && <button className="ib" title={tr('그 세션 열기', 'Open that session')} aria-label={tr('열기', 'Open')} onClick={() => onOpen(item.target!)}><IconOpen /></button>}
        <button className="ib" title={tr('처리함 — 목록에서 치우기', 'Done — remove from list')} aria-label={tr('처리함', 'Done')} onClick={() => onDismiss(item)}><IconCheck /></button>
      </div>
    </div>
  );
}

function Inbox(props: Props) {
  if (props.items.length === 0 && !props.direct && !props.login && !props.browser) return <div className="inbox-empty">{tr('결정할 거 없어', 'Nothing to decide')}</div>;
  return (
    <div className="inbox">
      <div className="tasks-sec inbox-head">
        {tr('결정 대기', 'Decisions')} <span>{props.items.length + (props.directCount ?? 0) + (props.login ? 1 : 0) + (props.browserCount ?? 0)}</span>
      </div>
      {props.login}
      {props.browser}
      {props.direct}
      {props.items.map((it) => <Row key={it.key} item={it} {...props} />)}
    </div>
  );
}

/** 종 아래 드롭다운. 결정이 들어오면 저절로 펼쳐지고, '나중에'나 종을 눌러야만 닫힌다.
 *  바깥 클릭·Esc 로 닫지 않는다 — 터미널을 누르거나 Claude 를 Esc 로 멈추다 결정을 놓치면 안 돼서 */
export function InboxPopover({ open, onClose, ...props }: Props & { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="inbox-pop" role="dialog" aria-label={tr('결정 대기', 'Decisions')}>
      <button className="ib inbox-later" title={tr('나중에 — 다음 새 결정이 올 때까지 접어 둠', 'Later — hide until the next new decision')} aria-label={tr('나중에', 'Later')} onClick={onClose}><IconClose /></button>
      <Inbox {...props} />

    </div>
  );
}
