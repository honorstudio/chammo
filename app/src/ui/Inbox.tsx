// 결정 대기함 — 상단 바 종을 누르면 아래로 펼쳐지는 드롭다운. 작업 패널과 따로 논다.
// 여기서 바로 답장(그 세션 입력칸에 들어감)·열기·처리함
import { useState } from 'react';
import type { InboxItem } from '../domain/inbox';
import { IconCheck, IconClose, IconOpen, IconResume, IconSend } from './Icons';
import { tr } from '../i18n';

const KIND = (): Record<InboxItem['kind'], string> => ({
  ask: tr('물어봄', 'Question'), blocked: tr('확인창', 'Prompt'), decide: tr('결정', 'Decision'), login: tr('로그인 오류', 'Login error'),
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
  /** 로그인 오류로 멈춘 세션 이어서 돌리기 */
  onResume: (items: InboxItem[]) => Promise<void>;
};

function Row({ item, onReply, onOpen, onDismiss, blockedWhy, onResume }: { item: InboxItem } & Omit<Props, 'items'>) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [resuming, setResuming] = useState(false);
  const why = item.kind === 'blocked' || item.kind === 'login' ? null : item.target ? blockedWhy(item) : null;
  const canReply = item.kind !== 'blocked' && item.kind !== 'login' && !!item.target && !why;
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
      <div className="inbox-text">{item.text}</div>
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
        {item.kind === 'login' && (
          <button className="ib pri" title={tr('이어서 — 하던 거 다시 돌리기', 'Resume — pick up where it left off')} aria-label={tr('이어서', 'Resume')} disabled={resuming} onClick={() => { setResuming(true); void onResume([item]).finally(() => setResuming(false)); }}>
            <IconResume />
          </button>
        )}
        {item.target && <button className="ib" title={tr('그 세션 열기', 'Open that session')} aria-label={tr('열기', 'Open')} onClick={() => onOpen(item.target!)}><IconOpen /></button>}
        <button className="ib" title={tr('처리함 — 목록에서 치우기', 'Done — remove from list')} aria-label={tr('처리함', 'Done')} onClick={() => onDismiss(item)}><IconCheck /></button>
      </div>
    </div>
  );
}

function Inbox(props: Props) {
  const [all, setAll] = useState(false);
  if (props.items.length === 0) return <div className="inbox-empty">{tr('결정할 거 없어', 'Nothing to decide')}</div>;
  const stalls = props.items.filter((i) => i.kind === 'login');
  return (
    <div className="inbox">
      <div className="tasks-sec inbox-head">
        {tr('결정 대기', 'Decisions')} <span>{props.items.length}</span>
        {stalls.length > 1 && (
          <button className="ib pri inbox-all" title={tr(`로그인 오류 ${stalls.length}개 전부 이어서`, `Resume all ${stalls.length} login errors`)} aria-label={tr('전부 이어서', 'Resume all')} disabled={all} onClick={() => { setAll(true); void props.onResume(stalls).finally(() => setAll(false)); }}>
            <IconResume />
          </button>
        )}
      </div>
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
