import { invoke } from '@tauri-apps/api/core';
import { useRef, useState } from 'react';
import { composeSend } from '../../domain/space';
import { assistant, tr } from '../../i18n';
import { IconSend } from '../Icons';
import { markSent, removeComment, usePending } from './pending';

/**
 * 오른쪽 아래 "보낼 것" — 고친 게 있으면 종이비행기가 떠서 살짝 날갯짓하고, 마우스를 올리면 그 자리에서 카드로 쫙 펼쳐진다
 * (무엇이 어떤 모양으로 갈지 + 줄 코멘트 + 한 줄 메모 + 보내기). 누르면 펼친 채 고정(메모 쓰는 중) — 2026-09-30 사용자 "구리다, 보내질 것처럼"
 */
export function SendFab({ send, sendTo }: { send: (text: string) => Promise<void>; sendTo?: string }) {
  const { docs, comments } = usePending();
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [memo, setMemo] = useState('');
  const [sending, setSending] = useState(false);
  const [flown, setFlown] = useState(false); // 보낸 직후 날아가는 움직임
  const [err, setErr] = useState('');
  const leave = useRef(0);
  const lines = docs.reduce((k, p) => k + p.diff.added.length + p.diff.removed.length, 0);
  const count = lines + comments.length;
  if (!count && !pinned && !flown) return null;
  const to = sendTo ?? assistant();
  const open = hover || pinned;
  const preview = composeSend(docs, memo, comments);
  const sendAll = async () => {
    if (!preview) return;
    setSending(true); setErr('');
    try {
      await send(preview);
      void invoke('space_log_append', { line: JSON.stringify({ ts: new Date().toISOString(), who: '사용자', kind: 'send', to, docs: docs.map((d) => d.path), comments: comments.length, memo: memo.trim() }) }).catch(() => {});
      markSent();
      setMemo(''); setPinned(false); setHover(false);
      setFlown(true);
      window.setTimeout(() => setFlown(false), 900);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSending(false);
    }
  };
  return (
    <div className={`sfab ${open ? 'open' : ''} ${flown ? 'flown' : ''} ${count ? 'has' : ''}`}
      onMouseEnter={() => { window.clearTimeout(leave.current); setHover(true); }}
      onMouseLeave={() => { leave.current = window.setTimeout(() => setHover(false), 220); }}>
      {/* 접혔을 땐 종이비행기 + 개수만. 올리면 이 버튼 자체가 그 자리에서 창으로 늘어난다(2026-09-30 사용자) */}
      <button className="sfab-pill" onClick={() => { setPinned((p) => !p); setHover(true); }} aria-expanded={open}
        title={tr(`${to}에게 보낼 것 ${count} — 올리면 펼쳐진다`, `${count} to send to ${to} — hover to expand`)}>
        <span className="sfab-plane"><IconSend /></span>
        {flown ? <span className="sfab-count">{tr('보냄', 'Sent')}</span> : count > 0 && <span className="sfab-count">{count}</span>}
      </button>
      <div className="sfab-card" role="dialog" aria-label={tr('보낼 것', 'To send')} aria-hidden={!open}>
        <div className="sfab-head"><b>{tr(`${to}에게 이렇게 가요`, `This goes to ${to}`)}</b><span>{tr(`고친 줄 ${lines} · 코멘트 ${comments.length}`, `${lines} lines · ${comments.length} comments`)}</span></div>
        <pre className="sfab-preview">{preview || tr('(아직 보낼 게 없어요)', '(Nothing to send yet)')}</pre>
        {comments.length > 0 && (
          <ul className="sfab-comments">
            {comments.map((c) => (
              <li key={c.id}><span className="q">{c.quote}</span><span className="t">{c.text}</span>
                <button onClick={() => removeComment(c.id)}>{tr('빼기', 'Remove')}</button></li>
            ))}
          </ul>
        )}
        <div className="sfab-foot">
          <input value={memo} onFocus={() => setPinned(true)} onChange={(e) => setMemo(e.target.value)} placeholder={tr('한 줄 메모(없어도 돼요)', 'One-line note (optional)')}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void sendAll(); if (e.key === 'Escape') { setPinned(false); setHover(false); } }} />
          <button className="sfab-go" disabled={sending || !preview} onClick={() => void sendAll()}>
            <IconSend />{sending ? tr('보내는 중', 'Sending') : tr('보내기', 'Send')}
          </button>
        </div>
        {err && <div className="sfab-err">{err}</div>}
      </div>
    </div>
  );
}
