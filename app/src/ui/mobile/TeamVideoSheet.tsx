// 폰 팀 보관함 영상(11-04 사용자 920MB mp4) — 맥이 팀 보관함에서 받아 푸는 동안 진행 한 줄(1초마다), 다 받으면 영상 검토 화면 그대로(저용량 540p·말 남기기).
// 실패면 까닭 한 줄 + 다시. 같은 파일은 맥이 받은 자리를 기억해 다시 안 받는다
import { useCallback, useEffect, useState } from 'react';
import { teamMedia, type MediaTicket, type TeamMedia } from '../../data/web';
import { fmtBytes } from '../../domain/teamLocker';
import { teamMediaNote } from '../../domain/videoReview';
import { tr } from '../../i18n';
import { IconClose, IconRefresh } from '../Icons';
import { vrCopy, teamVideoCopy as c } from '../videoReview/copy';
import { BottomSheet } from './kit';
import VideoReviewSheet from './VideoReviewSheet';

const POLL_MS = 1000;

export default function TeamVideoSheet({ team, id, name, orch, onClose }: { team: string; id: string; name: string; orch: string; onClose: () => void }) {
  const [st, setSt] = useState<TeamMedia | null>(null);
  const [broke, setBroke] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    let timer = 0;
    const look = () => {
      teamMedia(team, id).then((r) => {
        if (!live) return;
        setSt(r);
        if (r.state === 'going') timer = window.setTimeout(look, POLL_MS);
      }, () => { if (live) setBroke(true); });
    };
    look();
    return () => { live = false; window.clearTimeout(timer); };
  }, [team, id, round]);
  // 다 받은 뒤 새 표(만료·끊김)도 같은 길 — 맥은 받은 자리를 기억해 바로 준다
  const reload = useCallback((): Promise<MediaTicket> => teamMedia(team, id).then((r) => (r.state === 'ready' ? r : Promise.reject(new Error(r.state)))), [team, id]);

  if (st?.state === 'ready') return <VideoReviewSheet path={st.path} title={name} orch={orch} onClose={onClose} load={reload} />;

  const note = st ? teamMediaNote(st) : { k: 'open' as const };
  const failed = broke || note.k === 'fail';
  const text = broke ? c.failOther()
    : note.k === 'fetch' ? c.fetching(note.pct, fmtBytes(note.total))
      : note.k === 'fail' ? { net: c.failNet, disk: c.failDisk, gone: c.failGone, other: c.failOther }[note.why]()
        : tr('여는 중…', 'Opening…');
  const again = () => { setBroke(false); setSt(null); setRound((n) => n + 1); };
  return (
    <BottomSheet kind="full" className="m-vr" label={name} onClose={onClose} head={
      <div className="m-picker-head m-vr-head vr-phone-svg">
        <b className="m-view-title">{name}</b>
        <button type="button" className="m-rt-btn m-ico" onClick={onClose} aria-label={vrCopy.close()} title={vrCopy.close()}><IconClose /></button>
      </div>}>
      <div className="vr phone">
        <div className="vr-pic">
          <div className="vr-veil" role="status">
            <div>{text}</div>
            {failed && <button type="button" className="vr-go" aria-label={c.retry()} title={c.retry()} onClick={again}><IconRefresh /></button>}
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}
