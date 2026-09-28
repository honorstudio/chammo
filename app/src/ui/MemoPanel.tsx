// 세션 메모 — ⌘M 으로 창 위에 뜬다. 지금 뭐 하는지·보낼 프롬프트 초안·왜 그렇게 정했는지를 프로젝트별로 쌓는다.
// Enter 저장 · ⌥/Shift+Enter 줄바꿈 · Esc 닫기. 항목마다 세션에 보내기(입력칸에 글자만, Enter 는 직접)·복사·삭제
import { useEffect, useRef, useState } from 'react';
import type { MemoItem } from '../domain/memo';
import { IconCheck, IconClose, IconCopy, IconSend, IconTrash } from './Icons';
import { tr } from '../i18n';

type Props = {
  project: string;
  items: MemoItem[];
  onAdd: (text: string) => Promise<void>;
  onSend: (text: string) => void;
  onCopy: (text: string) => void;
  onRemove: (item: MemoItem) => void;
  onClose: () => void;
};

export function MemoPanel({ project, items, onAdd, onSend, onCopy, onRemove, onClose }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // 삭제는 두 번 눌러야 — 첫 번째는 3초 동안 '한 번 더'
  const [armed, setArmed] = useState<number | null>(null);
  useEffect(() => {
    if (armed === null) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => input.current?.focus(), []);
  // 입력칸은 글 길이만큼 늘어난다(최대 높이는 CSS) — 줄바꿈·긴 줄 둘 다
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [text]);
  // 최근 것이 아래 — 열리거나 새로 쌓이면 맨 아래로
  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [items.length]);

  // 보낸 프롬프트도 기록으로 남게 — 보내기는 저장하고 나서
  const save = async (thenSend = false) => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await onAdd(t);
      setText('');
      if (thenSend) onSend(t);
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      void save();
    }
  };

  return (
    <div className="memo" onMouseDown={(e) => e.stopPropagation()}>
      <div className="memo-head">
        <b>{tr('메모', 'Notes')}</b>
        <span className="dim">{project}</span>
        <button className="ib memo-close" title={tr('닫기 (Esc)', 'Close (Esc)')} aria-label={tr('닫기', 'Close')} onClick={onClose}><IconClose /></button>
      </div>
      <div className="memo-list" ref={list}>
        {items.length === 0 && <div className="memo-empty">{tr('아직 없어 — 지금 뭐 하는지, 보낼 프롬프트, 왜 그렇게 정했는지 적어 둬', "Nothing yet — jot down what you're doing, prompts to send, and why you decided things")}</div>}
        {items.map((it, i) => (
          <div key={i} className="memo-item">
            <span className="memo-ts">{it.ts}</span>
            <div className="memo-text">{it.text}</div>
            <span className="memo-acts">
              <button className="ib" title={tr('세션에 보내기 — 입력칸에 넣기만, Enter 는 직접', 'Send to session — only fills the input, press Enter yourself')} aria-label={tr('세션에 보내기', 'Send to session')} onClick={() => onSend(it.text)}><IconSend /></button>
              <button className="ib" title={tr('복사', 'Copy')} aria-label={tr('복사', 'Copy')} onClick={() => onCopy(it.text)}><IconCopy /></button>
              <button
                className={`ib danger ${armed === i ? 'armed' : ''}`}
                title={armed === i ? tr('한 번 더 누르면 삭제', 'Click again to delete') : tr('삭제', 'Delete')}
                aria-label={armed === i ? tr('한 번 더 누르면 삭제', 'Click again to delete') : tr('삭제', 'Delete')}
                onClick={() => { if (armed === i) { setArmed(null); onRemove(it); } else setArmed(i); }}
              >
                <IconTrash />
              </button>
              {armed === i && <span className="memo-armed">{tr('한 번 더', 'Again')}</span>}
            </span>
          </div>
        ))}
      </div>
      <div className="memo-input">
        <textarea
          ref={input}
          className="inp"
          rows={3}
          placeholder={tr('새 메모 — Enter 저장 · ⌥Enter 줄바꿈 · Esc 닫기', 'New note — Enter to save · ⌥Enter for new line · Esc to close')}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="memo-input-acts">
          <button className="ib" title={tr('저장하고 세션에 보내기', 'Save and send to session')} aria-label={tr('저장하고 세션에 보내기', 'Save and send to session')} disabled={busy || !text.trim()} onClick={() => void save(true)}><IconSend /></button>
          <button className="ib pri" title={tr('저장 (Enter)', 'Save (Enter)')} aria-label={tr('저장', 'Save')} disabled={busy || !text.trim()} onClick={() => void save()}><IconCheck /></button>
        </div>
      </div>
    </div>
  );
}
