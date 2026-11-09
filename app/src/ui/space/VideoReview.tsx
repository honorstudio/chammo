// 영상 검토 — 데스크톱 검토 탭. 시안 검토(CurationMode)와 같은 자리·같은 보내기 길, 몸통은 폰과 같이 쓴다.
// 영상은 원본을 바로(docUrl). 띄우면 폰용 준비물도 뒤에서 만든다(저우선) — 폰이 먼저 열어도 기다림이 짧게
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { reviewEscCloses } from '../../domain/curation';
import { orchVars } from '../../domain/orchTheme';
import { docUrl } from '../../domain/reader';
import { IconClose, IconMaximize, IconRestore, IconSend } from '../Icons';
import { vrCopy as c } from '../videoReview/copy';
import { useVrNotes, type VrIo } from '../videoReview/useVrNotes';
import { VideoReviewBody } from '../videoReview/VideoReviewBody';

type Prep = { state: string; fps?: number | null; record?: string };

export function VideoReview({ path, onClose, onSend, sendTo, color, big = false, onBig, by }: { path: string; onClose: () => void; onSend?: (text: string) => Promise<void>; sendTo: string; color?: string; big?: boolean; onBig?: () => void; by?: { name: string; avatar: React.ReactNode } }) {
  const [prep, setPrep] = useState<Prep | null>(null);
  const [dur, setDur] = useState<number | undefined>();
  const [sent, setSent] = useState<'idle' | 'sending' | 'sent' | 'fail'>('idle');

  // 준비 시작 + fps 받기 — fps 는 그림 묶음을 만든 뒤에 나와서 준비되는 동안만 다시 본다
  useEffect(() => {
    let live = true;
    let timer = 0;
    const look = () => {
      invoke<Prep>('video_review_prep', { path }).then((p) => {
        if (!live) return;
        setPrep(p);
        if (p.state === 'making' || p.state === 'idle') timer = window.setTimeout(look, 2000);
      }, () => {});
    };
    look();
    return () => { live = false; window.clearTimeout(timer); };
  }, [path]);

  const io = useMemo<VrIo>(() => ({
    load: () => invoke<string>('read_curation_state', { path }),
    save: async (md, json) => {
      await invoke('save_curation', { path, text: md });
      await invoke('save_curation_state', { path, json });
    },
  }), [path]);
  const notes = useVrNotes(path, 'desktop', io, { duration: dur, fps: prep?.fps ?? undefined, recordPath: prep?.record });

  // Esc — 글 칸은 몸통이 먼저 받는다(비우기 → 닫기). 초점이 칸 밖이면 여기서. 채팅 입력칸·위에 뜬 창에선 안 닫는다(시안 검토와 같은 규칙)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      const editable = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (reviewEscCloses({ key: e.key, composing: e.isComposing, inReview: !!t?.closest('.cur-mode'), editable, overlay: !!document.querySelector('.od-back, .dash-preview') })) closeRef.current();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const send = async () => {
    if (!onSend || !notes.notes.length) return;
    setSent('sending');
    try { await onSend(notes.text()); setSent('sent'); } catch { setSent('fail'); }
  };
  useEffect(() => { setSent((s) => (s === 'sent' ? 'idle' : s)); }, [notes.notes]);

  const name = path.split(/[\\/]/).pop() ?? path;
  const sendLabel = c.send(sendTo);
  return (
    <div className={`cur-mode ${big ? 'big' : 'in-tab'}`} style={color ? orchVars(color) as React.CSSProperties : undefined}>
      <header className="vr-top">
        <b title={path}>{name}</b>
        {by && <span title={by.name}>{by.avatar}</span>}
        <span className="sp" />
        {sent === 'sent' && <span className="vr-st" role="status">{c.sent()}</span>}
        {sent === 'fail' && <span className="vr-st" role="status">{c.sendFail()}</span>}
        {onSend && <button type="button" className={`vr-send ${sent === 'fail' ? 'fail' : ''}`} aria-label={sendLabel} title={sendLabel} disabled={!notes.notes.length || sent === 'sending'} onClick={() => void send()}><IconSend />{notes.notes.length}</button>}
        {onBig && <button type="button" aria-label={big ? c.restore() : c.large()} title={big ? c.restore() : c.large()} onClick={onBig}>{big ? <IconRestore /> : <IconMaximize />}</button>}
        <button type="button" aria-label={c.close()} title={c.close()} onClick={onClose}><IconClose /></button>
      </header>
      <VideoReviewBody src={docUrl(path)} phone={false} fps={prep?.fps ?? undefined} notes={notes} onDuration={setDur} onClose={onClose} />
    </div>
  );
}
