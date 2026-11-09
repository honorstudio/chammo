// 폰 팀 문서 보기(11-06 사용자 "디엠 온 거 파일 볼 수가 없음") — 컴퓨터가 팀 보관함에서 받아 풀어 둔 자리를 받아, 보여 준 파일과 같은 폰 보기(FileView)로 연다.
// md·글·PDF·오피스·엑셀 모두 그 화면 그대로. 받는 동안 한 줄, 실패면 까닭 + 다시
import { useEffect, useState } from 'react';
import { teamDocPath } from '../../data/web';
import { tr } from '../../i18n';
import { IconRefresh } from '../Icons';
import { FileView } from './FileView';
import { BottomSheet } from './kit';

type St = { path: string } | { err: string } | null;

export default function TeamDocSheet({ team, id, name, onClose }: { team: string; id: string; name: string; onClose: () => void }) {
  const [st, setSt] = useState<St>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    setSt(null);
    teamDocPath(team, id).then((r) => { if (live) setSt({ path: r.path }); }, (e: unknown) => { if (live) setSt({ err: String((e as Error)?.message ?? e).slice(0, 160) }); });
    return () => { live = false; };
  }, [team, id, round]);
  if (st && 'path' in st) return <FileView path={st.path} title={name} onClose={onClose} />;
  return (
    <BottomSheet kind="full" label={name} title={name} titleClass="m-view-title m-view-file" onClose={onClose}>
      <div className="m-view-body">
        {!st && <p className="m-muted" role="status">{tr('여는 중…', 'Opening…')}</p>}
        {st && (
          <>
            <p className="m-error" role="alert">{tr(`못 열었어요 — ${st.err}`, `Couldn't open it — ${st.err}`)}</p>
            <button type="button" className="m-rt-btn m-ico" onClick={() => setRound((n) => n + 1)} aria-label={tr('다시', 'Retry')} title={tr('다시', 'Retry')}><IconRefresh /></button>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
