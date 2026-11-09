// 폰 영상 검토 — 참모가 보여 준 영상. 준비된 저용량(540p, 256KB 씩)을 표로 받고, 끄는 동안은 그림 묶음만 보여 준다.
// 저용량이 아직이면 진행을 보이며 기다리고, 도우미가 없거나(윈도우) 실패하면 원본 + LTE 확인. 기록·보내기는 시안 검토와 같은 길
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { curationSave, curationState, mediaTicket, type MediaTicket } from '../../data/web';
import { canCurSend, curSendState, readCurSent, writeCurSent, type CurSend } from '../../domain/curation';
import { askBeforePlay, fileError, sizeLabel } from '../../domain/phoneFile';
import { phoneSource, type VrSprite } from '../../domain/videoReview';
import { tr } from '../../i18n';
import { IconClose, IconPlay, IconSend } from '../Icons';
import { vrCopy as c } from '../videoReview/copy';
import { useVrNotes, type VrIo } from '../videoReview/useVrNotes';
import { VideoReviewBody } from '../videoReview/VideoReviewBody';
import { BottomSheet } from './kit';
import { sendOut, storage } from './outbox';

const POLL_MS = 2000;

/** load = 표 받기(기본 보여 준 영상 /api/media-ticket — 팀 보관함 영상은 TeamVideoSheet 가 /api/team-media 로) */
export default function VideoReviewSheet({ path, title, orch, onClose, load: loadTicket }: { path: string; title: string; orch: string; onClose: () => void; load?: () => Promise<MediaTicket> }) {
  const [tk, setTk] = useState<MediaTicket | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [phase, setPhase] = useState<CurSend>('idle');
  const [sentText, setSentText] = useState<string | null>(() => readCurSent(storage(), path));
  const [failId, setFailId] = useState<string | undefined>();
  const [dur, setDur] = useState<number | undefined>();
  const resumeAt = useRef(0);
  const retried = useRef(0);
  const busy = useRef(false);

  // 표 받기 — 준비되는 동안 다시 본다. 표를 받으면 서버가 만들기를 시작한다
  const load = useCallback(() => (loadTicket ? loadTicket() : mediaTicket(path)), [path, loadTicket]);
  useEffect(() => {
    let live = true;
    let timer = 0;
    const look = () => {
      load().then((r) => {
        if (!live) return;
        setTk(r);
        if (r.prep?.state === 'making' || r.prep?.state === 'idle') timer = window.setTimeout(look, POLL_MS);
      }, (e: unknown) => { if (live) setErr(fileError((e as Error).message).gone ? c.gone() : c.openFail()); });
    };
    look();
    return () => { live = false; window.clearTimeout(timer); };
  }, [load]);

  const io = useMemo<VrIo>(() => ({
    load: () => curationState(path),
    save: (md, json) => curationSave(path, md, JSON.parse(json)),
  }), [path]);
  const notes = useVrNotes(path, 'phone', io, { duration: dur, fps: tk?.prep?.fps ?? undefined, recordPath: tk?.prep?.record });

  const src = tk ? phoneSource(tk) : null;
  const pct = Math.round((tk?.prep?.pct ?? 0) * 100);
  const sprite = (tk?.prep?.sprite?.cw ? tk.prep.sprite : undefined) as VrSprite | undefined;
  const ticket = tk?.ticket;
  const spriteUrl = useMemo(() => (ticket ? (i: number) => `/api/media-sprite?t=${ticket}&i=${i}` : undefined), [ticket]);
  const need = src && src.kind !== 'wait' && askBeforePlay(src.bytes) && !agreed;

  // 표가 만료됐거나(10분 안 쓴 채 멈춤) 끊겼으면 새 표로 — 보던 자리는 resumeAt 이 되돌린다. 오류가 계속되면 안 돈다
  const onVideoError = () => {
    const now = Date.now();
    if (now - retried.current < 30_000) return;
    retried.current = now;
    load().then(setTk, () => {});
  };

  const text = notes.text();
  const st = curSendState(phase, sentText, text);
  const say = { idle: '', sending: tr('보내는 중…', 'Sending…'), sent: c.sent(), fail: c.sendFail() }[st];
  const send = async () => {
    if (busy.current || !notes.notes.length || !canCurSend(st)) return;
    busy.current = true;
    setPhase('sending');
    const r = await sendOut(orch, text, phase === 'fail' ? failId : undefined);
    busy.current = false;
    if (!r.ok) { setFailId(r.id); setPhase('fail'); return; }
    writeCurSent(storage(), path, text);
    setSentText(text);
    setFailId(undefined);
    setPhase('idle');
    window.setTimeout(onClose, 700); // 시안 검토와 같이 — '보냈어요'를 잠깐 보이고 닫는다, 채팅에 보낸 말풍선이 있다
  };

  const sendLabel = c.send(tr('참모', 'your assistant'));
  const veil = err ? err
    : !tk ? tr('여는 중…', 'Opening…')
      : src?.kind === 'wait' ? c.preparing(pct)
        : need ? (
          <>
            <div>{c.far(sizeLabel(src && 'bytes' in src ? src.bytes : 0))}</div>
            <button type="button" className="vr-go" aria-label={c.play()} title={c.play()} onClick={() => setAgreed(true)}><IconPlay /></button>
          </>
        ) : null;
  return (
    <BottomSheet kind="full" className="m-vr" label={title} onClose={onClose} head={
      <div className="m-picker-head m-vr-head vr-phone-svg">
        <b className="m-view-title">{title}</b>
        {say && <span className={`m-cur-st ${st}`} role="status">{say}</span>}
        <span className="m-vr-n">{notes.notes.length}</span>
        <button type="button" className={`m-rt-btn m-ico m-vr-send ${st}`} disabled={!notes.notes.length || !canCurSend(st)} onClick={() => void send()} aria-label={sendLabel} title={sendLabel}><IconSend /></button>
        <button type="button" className="m-rt-btn m-ico" onClick={onClose} aria-label={c.close()} title={c.close()}><IconClose /></button>
      </div>}>
      <VideoReviewBody src={src && src.kind !== 'wait' && !need ? src.url : null} phone sprite={sprite} spriteUrl={spriteUrl} veil={veil} notes={notes} onDuration={setDur} onClose={onClose} onVideoError={onVideoError} resumeAt={resumeAt} />
    </BottomSheet>
  );
}
