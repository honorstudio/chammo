// 내 프로필(시안 team-settings v1 P) — 메신저 목록 맨 아래 '내 칸' → 상태 카드(세 가지 + 짧은 글, 고르면 바로) → 프로필 편집(이름·사진) → 자르기.
// 팀 설정의 내 줄도 같은 카드를 연다. 저장은 Rust team_profile(내가 든 팀마다 암호 덩어리로) — 팀원 화면은 바뀜 알림으로 곧 따라온다
import { useEffect, useRef, useState } from 'react';
import { teamProfileSet } from '../../data/teamProfileApi';
import { clampOffset, cropRect, NAME_MAX, NOTE_MAX, statusLine, statusName, STATUSES, type Look, type Status } from '../../domain/teamProfile';
import { personColor } from '../../domain/teamChat';
import { tr } from '../../i18n';
import { IconCamera, IconClose, IconZoomIn, IconZoomOut } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { Person } from './TeamFaces';
import './profile.css';

/** 떠 있는 카드 자리 — 누른 칸 아래(모자라면 위), 창 안으로 */
export type At = { left: number; top?: number; bottom?: number };
export function atOf(el: Element, width = 260): At {
  const r = el.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
  return window.innerHeight - r.bottom > 380 ? { left, top: r.bottom + 6 } : { left, bottom: Math.max(8, window.innerHeight - r.top + 6) };
}

function Card({ at, onClose, children, label }: { at: At; onClose: () => void; children: React.ReactNode; label: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div className="tmp-scrim" onClick={onClose} />
      <div className="tmp-card" role="dialog" aria-label={label} style={at}>{children}</div>
    </>
  );
}

/** 그림 고르기 — 숨은 파일 칸. 고르면 data URL. open() 은 사람이 누른 그 자리에서 불러야 열린다 */
export function usePick(onPicked: (src: string) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/heic" hidden onChange={(e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      const r = new FileReader();
      r.onload = () => typeof r.result === 'string' && onPicked(r.result);
      r.readAsDataURL(f);
    }} />
  );
  return { input, open: () => ref.current?.click() };
}

const VIEW = 220;
const OUT = 256;

/** 자르기 — 끌어 옮기고 막대로 확대. 칸 안(동그라미·둥근 네모)만 256px 그림으로 */
export function Crop({ src, square = false, onDone, onCancel }: { src: string; square?: boolean; onDone: (dataUrl: string) => void; onCancel: () => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.onerror = () => setErr(tr('열 수 없는 그림이에요. png, jpeg, webp만 돼요', "Can't open this image. Use png, jpeg or webp"));
    i.src = src;
  }, [src]);
  const size = img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
  const o = size ? clampOffset(size, VIEW, zoom, off) : off;
  const r = size ? cropRect(size, VIEW, zoom, o) : null;
  const scale = r ? VIEW / r.sw : 1;
  const done = () => {
    if (!img || !r) return;
    const c = document.createElement('canvas');
    c.width = OUT;
    c.height = OUT;
    const g = c.getContext('2d');
    if (!g) return;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, OUT, OUT);
    const webp = c.toDataURL('image/webp', 0.9);
    onDone(webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/png'));
  };
  return (
    <>
      <b>{tr('사진 자르기', 'Crop photo')}</b>
      <div className={`tmp-crop ${square ? 'square' : ''}`}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: o.x, oy: o.y }; }}
        onPointerMove={(e) => { const d = drag.current; if (d) setOff({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }); }}
        onPointerUp={() => { drag.current = null; }}
        onWheel={(e) => setZoom((z) => Math.min(4, Math.max(1, z - e.deltaY * 0.002)))}>
        {img && r && <img src={src} alt="" style={{ width: img.naturalWidth, transform: `scale(${scale}) translate(${-r.sx}px, ${-r.sy}px)` }} />}
      </div>
      <div className="tmp-zoom">
        <IconZoomOut />
        <input type="range" min={1} max={4} step={0.01} value={zoom} aria-label={tr('확대', 'Zoom')} onChange={(e) => setZoom(Number(e.target.value))} />
        <IconZoomIn />
      </div>
      {err && <span className="tmp-hint" role="alert">{err}</span>}
      <div className="tmp-row end">
        <button className="tmx-btn tmx-sm" onClick={onCancel}>{tr('취소', 'Cancel')}</button>
        <button className="tmx-btn tmx-sm pri" disabled={!img} onClick={done}>{tr('쓰기', 'Use')}</button>
      </div>
    </>
  );
}

/** 상태 카드 → 프로필 편집 → 자르기, 한 떠 있는 카드 안에서 */
export function MyProfileCard({ me, rosterName, sub, at, onClose, onSaved }: { me: Look; rosterName: string; /** 카드 머리 둘째 줄(팀 · 역할) */ sub: string; at: At; onClose: () => void; onSaved: () => void }) {
  const [page, setPage] = useState<'status' | 'edit' | 'crop'>('status');
  const [status, setStatus] = useState<Status | ''>(me.status);
  const [note, setNote] = useState(me.note);
  const [name, setName] = useState(me.name);
  const [photo, setPhoto] = useState(me.photo);
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pick = usePick((src) => { setRaw(src); setPage('crop'); });
  const save = (c: Parameters<typeof teamProfileSet>[0], then?: () => void) => {
    setBusy(true);
    setErr(null);
    void teamProfileSet(c).then((failed) => {
      if (failed.length) setErr(tr(`일부 팀엔 못 바꿨어요: ${failed.join(' / ')}`, `Not changed in some teams: ${failed.join(' / ')}`));
      onSaved();
      then?.();
    }, (e: unknown) => setErr(String(e))).finally(() => setBusy(false));
  };
  const pickStatus = (s: Status) => { setStatus(s); save({ status: s, note }); };
  const saveNote = () => { if (note.trim() !== me.note) save({ status: status || 'free', note: note.trim() }); };
  const face = (size: number) => <Person name={name || rosterName} color={personColor(rosterName)} size={size} photo={photo} status={page === 'status' ? status : ''} />;
  const errLine = err && <span className="tmp-hint" role="alert">{err}</span>;
  return (
    <Card at={at} onClose={onClose} label={tr('내 프로필', 'My profile')}>
      {pick.input}
      {page === 'status' && (
        <>
          <div className="tmp-card-h">{face(40)}<span className="tmp-card-tx"><b>{me.name}</b><small>{sub}</small></span></div>
          <div role="radiogroup" aria-label={tr('상태', 'Status')}>
            {STATUSES.map((s) => (
              <button key={s} role="radio" aria-checked={status === s} className="tmp-st" disabled={busy} onClick={() => pickStatus(s)}><i className={s} />{statusName(s)}</button>
            ))}
          </div>
          <input className="tmp-in" value={note} maxLength={NOTE_MAX} placeholder={tr('상태 글 (예: 4시까지 회의)', 'Status note (e.g. In a meeting till 4)')} aria-label={tr('상태 글', 'Status note')}
            onChange={(e) => setNote(e.target.value)} onBlur={saveNote} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          <span className="tmp-hint">{tr(`${NOTE_MAX}자까지 · 팀원 모두에게 바로 보여요`, `Up to ${NOTE_MAX} characters · teammates see it right away`)}</span>
          {errLine}
          <div className="tmp-sep" />
          <button className="tmp-st" onClick={() => setPage('edit')}>{tr('프로필 편집', 'Edit profile')}</button>
        </>
      )}
      {page === 'edit' && (
        <>
          <div className="tmp-row between"><b>{tr('프로필 편집', 'Edit profile')}</b><IconButton label={tr('닫기', 'Close')} onClick={onClose}><IconClose /></IconButton></div>
          <div className="tmp-big">{face(84)}<IconButton label={tr('사진 바꾸기', 'Change photo')} onClick={pick.open} disabled={busy}><IconCamera /></IconButton></div>
          <span className="tmx-fl">{tr('이름', 'Name')}</span>
          <input className="tmp-in" value={name} maxLength={NAME_MAX} aria-label={tr('이름', 'Name')} onChange={(e) => setName(e.target.value)} />
          {errLine}
          <div className="tmp-row between">
            {photo ? <button className="tmx-btn tmx-sm" disabled={busy} onClick={() => setPhoto('')}>{tr('사진 지우기', 'Remove photo')}</button> : <span />}
            <button className="tmx-btn tmx-sm pri" disabled={busy || !name.trim() || (name.trim() === me.name && photo === me.photo)}
              onClick={() => save({ ...(name.trim() !== me.name ? { name: name.trim() } : {}), ...(photo !== me.photo ? { photo } : {}) }, onClose)}>
              {busy ? tr('올리는 중…', 'Saving…') : tr('저장', 'Save')}
            </button>
          </div>
        </>
      )}
      {page === 'crop' && <Crop src={raw} onDone={(d) => { setPhoto(d); setPage('edit'); }} onCancel={() => setPage('edit')} />}
    </Card>
  );
}

/** 팀 아이콘 자르기(둥근 네모) — 그림은 팀 설정의 아이콘 단추가 고른다(usePick) */
export function TeamIconCard({ src, at, onClose, onPicked }: { src: string; at: At; onClose: () => void; onPicked: (dataUrl: string) => void }) {
  return (
    <Card at={at} onClose={onClose} label={tr('팀 아이콘', 'Team icon')}>
      <Crop src={src} square onDone={(d) => { onPicked(d); onClose(); }} onCancel={onClose} />
    </Card>
  );
}

/** 메신저 목록 맨 아래 내 칸 — 전체가 한 단추(시안 P-내 칸) */
export function MeCell({ me, rosterName, sub, onSaved }: { me: Look; rosterName: string; sub: string; onSaved: () => void }) {
  const [at, setAt] = useState<At | null>(null);
  const line = statusLine(me) || tr('상태 정하기', 'Set a status');
  return (
    <>
      <button className="tmp-me" aria-haspopup="dialog" aria-label={tr(`내 프로필 — ${line}`, `My profile — ${line}`)} onClick={(e) => setAt(atOf(e.currentTarget))}>
        <Person name={me.name} color={personColor(rosterName)} size={32} photo={me.photo} status={me.status} />
        <span className="tmp-me-tx"><b>{me.name}</b><span>{line}</span></span>
      </button>
      {at && <MyProfileCard me={me} rosterName={rosterName} sub={sub} at={at} onClose={() => setAt(null)} onSaved={onSaved} />}
    </>
  );
}
