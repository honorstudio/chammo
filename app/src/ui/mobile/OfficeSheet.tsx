// 폰 오피스·영상 보기(전략 표 8번, 2026-10-03) — 워드는 글로(맥 textutil → 거른 html), 다른 오피스는 첫 장 그림(QuickLook 1600),
// 영상은 표 주소로 재생(Range, 20MB 넘으면 먼저 묻기). 폰에서 다 못 보는 건 '맥에서 열기'
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { mediaTicket, openOnMac, sheetBook, wordHtml } from '../../data/web';
import { isSheet } from '../../domain/reader';
import { askBeforePlay, fileError, sizeLabel, wordDoc } from '../../domain/phoneFile';
import { machine, tr } from '../../i18n';
import { IconPlay } from '../Icons';
import { wordDocToHtml } from '../md';
import { useBlobUrl } from './useBlobUrl';
import { ShareButton } from './ShareButton';
import { BottomSheet } from './kit';
import { SheetTable } from './SheetTable';

/** 맥에서 열기 — 되돌리기 쉬운 동작이 아니라(맥 화면에 앱이 뜬다) 글자 버튼 */
function OpenOnMac({ path }: { path: string }) {
  const [st, setSt] = useState<'idle' | 'busy' | 'done' | 'fail'>('idle');
  const go = () => { setSt('busy'); openOnMac(path).then(() => setSt('done'), () => setSt('fail')); };
  return (
    <button type="button" className="m-btn m-open-mac" disabled={st === 'busy'} onClick={go}>
      {st === 'done' ? tr(`${machine()}에서 열었어요`, `Opened on the ${machine()}`) : st === 'fail' ? tr('못 열었어요 — 다시', "Couldn't open — try again") : tr(`${machine()}에서 열기`, `Open on the ${machine()}`)}
    </button>
  );
}

/** 오피스·영상 보기 틀 — 공용 시트(전체 덮기), 머리 = 제목 + 폰으로 받기 + 닫기 */
function View({ path, title, video, onClose, children }: { path: string; title: string; video?: boolean; onClose: () => void; children: ReactNode }) {
  return <BottomSheet kind="full" className={video ? 'm-video' : undefined} label={title} title={title} titleClass="m-view-title" actions={<ShareButton path={path} />} onClose={onClose}>{children}</BottomSheet>;
}

export function OfficeSheet({ path, title, onClose }: { path: string; title: string; onClose: () => void }) {
  const word = wordDoc(path);
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (word) wordHtml(path).then(setHtml, (e: unknown) => setErr((e as Error).message === 'secret inside' ? tr('글 속에 키가 보여서 폰엔 안 보여 줘요', 'There is a key inside this text, so it is hidden on the phone') : tr('글로 못 바꿨어요', "Couldn't convert it to text"))); }, [path, word]);
  const safe = useMemo(() => (html === null ? null : wordDocToHtml(html)), [html]);
  // 엑셀은 읽기 전용 표로(맥에서 고친다)
  const sheet = isSheet(path);
  const [book, setBook] = useState<Awaited<ReturnType<typeof sheetBook>> | null>(null);
  useEffect(() => { if (sheet) sheetBook(path).then(setBook, (e: unknown) => setErr((e as Error).message === 'secret inside' ? tr('칸에 키가 보여서 폰엔 안 보여 줘요', 'There is a key inside a cell, so it is hidden on the phone') : tr('표로 못 읽었어요', "Couldn't read it as a sheet"))); }, [path, sheet]);
  // 워드·엑셀이 아니거나 글·표로 못 바꿨으면 첫 장 그림
  const pic = useBlobUrl((!word && !sheet) || err ? path : null, true, 1600);
  return (
    <View path={path} title={title} onClose={onClose}>
      <div className="m-view-body">
        {safe !== null && <div className="m-doc m-md m-word" dangerouslySetInnerHTML={{ __html: safe }} />}
        {book && <SheetTable book={book} />}
        {((!word && !sheet) || err) && (pic ? <img className="m-office-pic" src={pic} alt={tr(`${title} 첫 장`, `${title} first page`)} /> : <p className="m-muted">{tr('첫 장 받는 중…', 'Getting the first page…')}</p>)}
        {err && <p className="m-muted m-sm">{err} — {tr('첫 장만 보여 줘요', 'showing the first page only')}</p>}
        {(word ? safe === null : sheet && !book) && !err && <p className="m-muted">{tr('여는 중…', 'Opening…')}</p>}
        <div className="m-office-foot">
          {!word && !sheet && <span className="m-muted m-sm">{tr('폰에선 첫 장만 보여 줘요', 'The phone shows the first page only')}</span>}
          {sheet && book && <span className="m-muted m-sm">{tr(`폰에선 보기만 — 고치기는 ${machine()} 스페이스에서`, `View only on the phone — edit in Space on the ${machine()}`)}</span>}
          <OpenOnMac path={path} />
        </div>
      </div>
    </View>
  );
}

export function VideoSheet({ path, title, onClose }: { path: string; title: string; onClose: () => void }) {
  const [t, setT] = useState<{ url: string; size: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  useEffect(() => { mediaTicket(path).then((r) => { setT(r); setOk(!askBeforePlay(r.size)); }, (e: unknown) => setErr(fileError((e as Error).message).gone ? tr('지워졌어요', 'It was deleted') : tr('영상을 못 열었어요', "Couldn't open the video"))); }, [path]);
  return (
    <View path={path} title={title} video onClose={onClose}>
      <div className="m-view-body">
        {t && ok && <video className="m-video-el" src={t.url} controls playsInline preload="metadata" />}
        {t && !ok && (
          <div className="m-confirm">
            <div>{tr(`영상이 ${sizeLabel(t.size)}예요. LTE 면 그만큼 데이터가 나가요 — 재생할까요?`, `This video is ${sizeLabel(t.size)}. On LTE that much data is used — play it?`)}</div>
            <div className="m-new-row">
              <button type="button" className="m-send m-send-ico" onClick={() => setOk(true)} aria-label={tr('재생', 'Play')} title={tr('재생', 'Play')}><IconPlay /></button>
            </div>
          </div>
        )}
        {!t && !err && <p className="m-muted">{tr('여는 중…', 'Opening…')}</p>}
        {err && <p className="m-error">{err}</p>}
        <div className="m-office-foot"><OpenOnMac path={path} /></div>
      </div>
    </View>
  );
}
