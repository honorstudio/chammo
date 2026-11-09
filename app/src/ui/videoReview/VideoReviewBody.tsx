// 영상 검토 몸통 — 영상 · 시간 눈금 · 명령 줄(재생·타임코드·글 칸) · 남긴 말. 머리와 파일 길만 데스크톱·폰이 다르다.
// 글 칸이 비어 있을 때 Space·←→ 는 영상 조작, 글자를 치면 멈추고 그 시각에 묶인다. 기획 docs/plans/2026-11-04-video-curation.md
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { echoOfSent, enterAction } from '../../domain/enterSend';
import { fmtFrames, fmtShort, fmtTenth, spriteCell, type VrSprite } from '../../domain/videoReview';
import { IconCheck, IconClose, IconPause, IconPencil, IconPlay, IconPlus, IconTrash } from '../Icons';
import { vrCopy as c } from './copy';
import { Ruler } from './Ruler';
import type { VrNotes } from './useVrNotes';
import './videoReview.css';

const THUMB_W = 176;
const STEP = { plain: 1, shift: 5, alt: 0.1 };
const FRAME_LABEL_W = 84;
const SHORT_LABEL_W = 40;

const hintKey = 'vr.holdHint';
const hintSeen = () => { try { return localStorage.getItem(hintKey) === '1'; } catch { return false; } };
const markHint = () => { try { localStorage.setItem(hintKey, '1'); } catch { /* 이번엔 그대로 */ } };

export function VideoReviewBody({ src, phone, fps, sprite, spriteUrl, veil, notes, onDuration, onClose, onVideoError, resumeAt }: {
  src: string | null; phone: boolean; fps?: number; sprite?: VrSprite; spriteUrl?: (sheet: number) => string; veil?: ReactNode;
  notes: VrNotes; onDuration?: (d: number) => void; onClose?: () => void; onVideoError?: () => void; resumeAt?: { current: number };
}) {
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [hint, setHint] = useState(() => phone && !hintSeen());
  const sent = useRef<{ text: string; at: number } | null>(null);
  const shown = scrub ?? t;
  const tc = (v: number) => (phone ? fmtTenth(v) : fmtFrames(v, fps));
  const editNote = editing ? notes.notes.find((n) => n.id === editing) : undefined;

  // 재생 중엔 화면 주기마다 타임코드를 따라간다(timeupdate 는 초당 네 번이라 프레임 표시가 튄다)
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => { if (video.current) setT(video.current.currentTime); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  // 그림 묶음은 미리 받아 둔다 — 처음 끌 때 망을 기다리지 않게
  useEffect(() => {
    if (!sprite || !spriteUrl) return;
    const first = new Image();
    first.src = spriteUrl(0);
  }, [sprite, spriteUrl]);

  const seek = (v: number) => {
    const el = video.current;
    const to = Math.max(0, Math.min(dur || v, v));
    if (el) el.currentTime = to;
    setT(to);
  };
  const toggle = () => {
    const el = video.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  };
  const pause = () => video.current?.pause();
  const clear = () => { setText(''); setEditing(null); };
  const commit = () => {
    const body = input.current?.value ?? text;
    if (!body.trim()) return;
    sent.current = { text: body, at: Date.now() };
    if (editing) { notes.edit(editing, body); setSel(editing); }
    else { pause(); const id = notes.add(shown, body); if (id) setSel(id); }
    clear();
  };
  const beginEdit = (id: string, body: string, at: number) => {
    pause();
    seek(at);
    setSel(id);
    setEditing(id);
    setText(body);
    input.current?.focus();
  };

  return (
    <div className={`vr ${phone ? 'phone' : 'pc'}`} onPointerUp={(e) => { if (!phone && !(e.target as HTMLElement).closest?.('input,button')) input.current?.focus(); }}>
      <div className="vr-pic">
        {src && (
          <video ref={video} key={src} src={src} playsInline preload="metadata" onClick={toggle}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              setDur(v.duration);
              setFailed(false);
              onDuration?.(v.duration);
              if (resumeAt?.current) { v.currentTime = resumeAt.current; setT(resumeAt.current); }
            }}
            onPlay={() => setPlaying(true)} onPause={(e) => { setPlaying(false); setT(e.currentTarget.currentTime); }} onEnded={() => setPlaying(false)}
            onSeeked={(e) => { if (scrub === null) setT(e.currentTarget.currentTime); }}
            onTimeUpdate={(e) => { if (resumeAt) resumeAt.current = e.currentTarget.currentTime; }}
            onError={() => { setFailed(true); onVideoError?.(); }} />
        )}
        {veil && <div className="vr-veil">{veil}</div>}
        {failed && !veil && <div className="vr-veil">{c.openFail()}</div>}
        {scrub !== null && sprite && spriteUrl && <Thumb t={scrub} dur={dur} sprite={sprite} url={spriteUrl} />}
      </div>
      <Ruler dur={dur} t={shown} notes={notes.notes} sel={sel} label={c.ruler()} labelW={!phone && fps ? FRAME_LABEL_W : SHORT_LABEL_W}
        fmtLabel={(v) => (!phone && fps ? fmtFrames(v, fps) : fmtShort(v))}
        onZoom={() => { setHint(false); markHint(); }}
        onScrub={(v) => { setScrub(v); if (!phone) { const el = video.current; if (el) el.currentTime = v; } }}
        onScrubEnd={(v) => { setScrub(null); seek(v); }} />
      <div className="vr-cmd">
        <button type="button" className="vr-play" aria-label={playing ? c.pause() : c.play()} title={playing ? c.pause() : c.play()} onPointerDown={(e) => e.preventDefault()} onClick={toggle} disabled={!dur}>{playing ? <IconPause /> : <IconPlay />}</button>
        <span className="vr-tc" aria-live="off">{tc(editNote ? editNote.t : shown)}</span>
        <input ref={input} className="vr-field" value={text} placeholder={c.placeholder()} aria-label={c.placeholder()} autoFocus={!phone} enterKeyHint="done"
          onChange={(e) => {
            const v = e.target.value;
            if (echoOfSent(v, text, sent.current, Date.now())) return;
            if (!text && v) pause();
            setText(v);
          }}
          onKeyDown={(e) => {
            const go = enterAction({ key: e.key, keyCode: e.keyCode, isComposing: e.nativeEvent.isComposing, shiftKey: e.shiftKey });
            if (go !== 'skip') { e.preventDefault(); if (go === 'send') commit(); else window.setTimeout(commit, 0); return; }
            if (e.key === 'Escape' && !e.nativeEvent.isComposing) { e.stopPropagation(); if (text || editing) clear(); else onClose?.(); return; }
            if (text || e.metaKey || e.ctrlKey) return;
            if (e.key === ' ') { e.preventDefault(); toggle(); return; }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              const d = e.altKey ? STEP.alt : e.shiftKey ? STEP.shift : STEP.plain;
              seek(shown + (e.key === 'ArrowLeft' ? -d : d));
            }
          }} />
        {editing && <button type="button" className="vr-add" aria-label={c.cancelEdit()} title={c.cancelEdit()} onPointerDown={(e) => e.preventDefault()} onClick={clear}><IconClose /></button>}
        <button type="button" className={`vr-add${text.trim() ? ' go' : ''}`} aria-label={editing ? c.saveEdit() : c.add()} title={editing ? c.saveEdit() : c.add()} disabled={!text.trim()} onPointerDown={(e) => e.preventDefault()} onClick={commit}>{editing ? <IconCheck /> : <IconPlus />}</button>
      </div>
      {notes.saveFailed && <div className="vr-warn" role="status">{c.saveFail()}</div>}
      {hint && dur > 0 && <div className="vr-hint">{c.holdHint()}</div>}
      <div className="vr-list">
        <div className="vr-h"><span className="vr-h-t">{c.colTime()}</span><span>{c.colNote()}</span></div>
        {notes.ready && !notes.notes.length && <div className="vr-empty">{c.empty()}</div>}
        {notes.notes.map((n) => (
          <div key={n.id} className={`vr-row${n.id === sel ? ' on' : ''}`} role="button" tabIndex={-1} onClick={() => { setSel(n.id); pause(); seek(n.t); }}>
            <em>{tc(n.t)}</em><span className="vr-tx" title={n.text}>{n.text}</span>
            {n.id === sel && (
              <span className="vr-acts">
                <button type="button" aria-label={c.edit()} title={c.edit()} onClick={(e) => { e.stopPropagation(); beginEdit(n.id, n.text, n.t); }}><IconPencil /></button>
                <button type="button" aria-label={c.del()} title={c.del()} onClick={(e) => { e.stopPropagation(); notes.remove(n.id); setSel(null); if (editing === n.id) clear(); }}><IconTrash /></button>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 끄는 동안 보여 주는 그림 — 영상은 안 찾는다(느린 망에서 손을 안 타게), 뗄 때 한 번만 찾는다 */
function Thumb({ t, dur, sprite, url }: { t: number; dur: number; sprite: VrSprite; url: (sheet: number) => string }) {
  const { sheet, col, row } = spriteCell(t, sprite);
  const h = Math.round((THUMB_W * sprite.ch) / sprite.cw);
  const at = dur > 0 ? t / dur : 0;
  return (
    <div className="vr-thumb" style={{ left: `clamp(4px, calc(${at * 100}% - ${THUMB_W / 2}px), calc(100% - ${THUMB_W + 4}px))`, width: THUMB_W, height: h, backgroundImage: `url("${url(sheet)}")`, backgroundSize: `${THUMB_W * sprite.cols}px ${h * sprite.rows}px`, backgroundPosition: `-${col * THUMB_W}px -${row * h}px` }}>
      <b>{fmtTenth(t)}</b>
    </div>
  );
}
