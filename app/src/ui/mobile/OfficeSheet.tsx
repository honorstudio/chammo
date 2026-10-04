// 폰 오피스·영상 보기(전략 표 8번, 2026-10-03) — 워드는 글로(맥 textutil → 거른 html), 다른 오피스는 첫 장 그림(QuickLook 1600),
// 영상은 표 주소로 재생(Range, 20MB 넘으면 먼저 묻기). 폰에서 다 못 보는 건 '맥에서 열기'
import { useEffect, useMemo, useState } from 'react';
import { mediaTicket, openOnMac, wordHtml } from '../../data/web';
import { askBeforePlay, fileError, sizeLabel, wordDoc } from '../../domain/phoneFile';
import { IconClose } from '../Icons';
import { wordDocToHtml } from '../md';
import { useBlobUrl } from './useBlobUrl';

/** 맥에서 열기 — 되돌리기 쉬운 동작이 아니라(맥 화면에 앱이 뜬다) 글자 버튼 */
function OpenOnMac({ path }: { path: string }) {
  const [st, setSt] = useState<'idle' | 'busy' | 'done' | 'fail'>('idle');
  const go = () => { setSt('busy'); openOnMac(path).then(() => setSt('done'), () => setSt('fail')); };
  return (
    <button type="button" className="m-btn m-open-mac" disabled={st === 'busy'} onClick={go}>
      {st === 'done' ? '맥에서 열었어요' : st === 'fail' ? '못 열었어요 — 다시' : '맥에서 열기'}
    </button>
  );
}

function Head({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="m-picker-head">
      <b className="m-view-title">{title}</b>
      <button type="button" className="m-rt-btn m-ico" onClick={onClose} aria-label="닫기" title="닫기"><IconClose /></button>
    </div>
  );
}

export function OfficeSheet({ path, title, onClose }: { path: string; title: string; onClose: () => void }) {
  const word = wordDoc(path);
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (word) wordHtml(path).then(setHtml, (e: unknown) => setErr((e as Error).message === 'secret inside' ? '글 속에 키가 보여서 폰엔 안 보여 줘요' : '글로 못 바꿨어요')); }, [path, word]);
  const safe = useMemo(() => (html === null ? null : wordDocToHtml(html)), [html]);
  // 워드가 아니거나 글로 못 바꿨으면 첫 장 그림
  const pic = useBlobUrl(!word || err ? path : null, true, 1600);
  return (
    <div className="m-view" role="dialog" aria-label={title}>
      <Head title={title} onClose={onClose} />
      <div className="m-view-body">
        {safe !== null && <div className="m-doc m-md m-word" dangerouslySetInnerHTML={{ __html: safe }} />}
        {(!word || err) && (pic ? <img className="m-office-pic" src={pic} alt={`${title} 첫 장`} /> : <p className="m-muted">첫 장 받는 중…</p>)}
        {err && <p className="m-muted m-sm">{err} — 첫 장만 보여 줘요</p>}
        {word && safe === null && !err && <p className="m-muted">여는 중…</p>}
        <div className="m-office-foot">
          {!word && <span className="m-muted m-sm">폰에선 첫 장만 보여 줘요</span>}
          <OpenOnMac path={path} />
        </div>
      </div>
    </div>
  );
}

export function VideoSheet({ path, title, onClose }: { path: string; title: string; onClose: () => void }) {
  const [t, setT] = useState<{ url: string; size: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  useEffect(() => { mediaTicket(path).then((r) => { setT(r); setOk(!askBeforePlay(r.size)); }, (e: unknown) => setErr(fileError((e as Error).message).gone ? '지워졌어요' : '영상을 못 열었어요')); }, [path]);
  return (
    <div className="m-view m-video" role="dialog" aria-label={title}>
      <Head title={title} onClose={onClose} />
      <div className="m-view-body">
        {t && ok && <video className="m-video-el" src={t.url} controls playsInline preload="metadata" />}
        {t && !ok && (
          <div className="m-confirm">
            <div>영상이 {sizeLabel(t.size)}예요. LTE 면 그만큼 데이터가 나가요 — 재생할까요?</div>
            <div className="m-new-row">
              <button type="button" className="m-send" onClick={() => setOk(true)}>재생</button>
            </div>
          </div>
        )}
        {!t && !err && <p className="m-muted">여는 중…</p>}
        {err && <p className="m-error">{err}</p>}
        <div className="m-office-foot"><OpenOnMac path={path} /></div>
      </div>
    </div>
  );
}
