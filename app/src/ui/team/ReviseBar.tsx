// 팀 탭 위 한 줄 — 팀에서 연 파일을 고쳐 저장했으면 '팀 보관함에 수정본 올리기'(10-28 사용자 1안, 누를 때만 — 팀 모두에게 바로 보인다).
// 3초마다 물어 저장을 안다(Rust 가 크기·시각부터 보고 바뀌었을 때만 지문). 안 고쳤으면 아무것도 안 그린다
import { useEffect, useState } from 'react';
import { tr } from '../../i18n';
import { every } from '../poll';
import { peekState, reviseUp } from './teamRevise';

export function ReviseBar({ path, team, me }: { path: string; team: string; me: string }) {
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    let alive = true;
    const tick = () => void peekState(path).then((s) => alive && setEdited(!!s.edited), () => {});
    tick();
    const stop = every(tick, 3000);
    return () => { alive = false; stop(); };
  }, [path]);
  if (!edited && !note) return null;
  const up = () => {
    setBusy(true);
    setNote('');
    void reviseUp(path, team, me)
      .then((name) => { setEdited(false); setNote(tr(`'${name}' 로 올렸어요`, `Uploaded as '${name}'`)); }, (e: unknown) => setNote(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="lk-selbar tsp-revise" role="status">
      {note && <span className="lk-ask" onClick={() => setNote('')}>{note}</span>}
      <span className="lk-sp" />
      {edited && <button className="btn" disabled={busy} onClick={up}>{busy ? tr('올리는 중', 'Uploading') : tr('팀 보관함에 수정본 올리기', 'Upload revision to the team locker')}</button>}
    </div>
  );
}
