import { invoke } from '@tauri-apps/api/core';
import { lazy, Suspense, useEffect, useState } from 'react';
import { FIT } from '../../domain/readerZoom';
import { docUrl, kindOf, pageDoc } from '../../domain/reader';
import { isCurationHtml } from '../../domain/curation';
import { tr } from '../../i18n';
import { IconMaximize } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { ExtraDoc, HtmlFrame } from '../reader/Reader';
import { OfficeDoc } from './Preview';
import { SendToOrch, type OrchTo } from './SendToOrch';

const PdfView = lazy(() => import('../reader/PdfView'));

/**
 * 보관함 탭 안 미리보기 — 그림·영상·html·pdf·오피스(2026-10-11 사용자 "기본은 탭으로"). md·엑셀은 편집 페이지(DocPage·SheetPage)가 따로.
 * 머리 = 작은 경로 한 줄 + 확대 단추 + 보내기·크게 보기(모달). 확대는 탭에서도(2026-10-12), 짚기는 크게 보기(Preview)에서
 */
export function FileTab({ path, where, attachTo, onAttach, onBig, onCuration, zoom = 100, zoomUi }: {
  /** 탭 확대 배율(%) — 그림은 0 = 맞춤. 파일마다 기억(domain/tabZoom) */
  zoom?: number;
  /** 머리의 확대 단추(TabZoomBar) */
  zoomUi?: React.ReactNode;
  path: string;
  /** 머리 작은 경로 한 줄(domain/lockerTabs pathLine) */
  where: string;
  /** 참모에게 보내기 — 그 참모 채팅 입력칸에 붙인다 */
  onAttach?: () => void;
  attachTo?: OrchTo | null;
  onBig: () => void;
  /** 검토용 시안(큐레이션) html 이면 탭 대신 검토 모드로 */
  onCuration?: (path: string) => void;
}) {
  const kind = kindOf(path);
  const [gate, setGate] = useState(kind === 'html' && !!onCuration);
  useEffect(() => {
    if (!gate) return;
    void invoke<string>('read_doc_text', { path }).then((t) => { if (isCurationHtml(t) && onCuration) onCuration(path); else setGate(false); }, () => setGate(false));
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  const [text, setText] = useState<string | null>(null);
  useEffect(() => { if (kind === 'text') void invoke<string>('read_doc_text', { path }).then(setText, () => setText('')); }, [path, kind]);
  const at = { path, ts: '', by: '' };
  // 그림 확대 — 실제 픽셀 기준 %(맞춤이면 창 안에 담는다). 자연 폭은 불러온 뒤에 안다
  const [natural, setNatural] = useState(0);
  const sized = kind === 'image' && zoom !== FIT && natural > 0;
  return (
    <div className="cv-doc cv-filetab">
      <div className="cv-doc-bar">
        <span className="cv-path" title={path}>{where}</span>
        <span className="cv-sp" />
        {zoomUi}
        {onAttach && <SendToOrch to={attachTo} onClick={onAttach} />}
        <IconButton label={tr('크게 보기', 'Open large')} title={tr('크게 보기 — 확대·가득 채우기', 'Open large — zoom and fill')} onClick={onBig}><IconMaximize /></IconButton>
      </div>
      <div className="ft-body">
        {gate ? null
          : kind === 'image' ? <div className={`pv-image ${sized ? '' : 'fit'}`}><img src={docUrl(path)} alt="" onLoad={(e) => setNatural(e.currentTarget.naturalWidth / (window.devicePixelRatio || 1))}
            style={sized ? { maxWidth: 'none', maxHeight: 'none', width: `${natural * zoom / 100}px` } : undefined} /></div>
          : kind === 'video' ? <video className="pv-video" src={docUrl(path)} controls playsInline />
          : kind === 'html' ? <div className="rd-zoombox"><HtmlFrame className="rd-frame" src={docUrl(path)} zoom={zoom} record={path} /></div>
          : kind === 'pdf' ? <Suspense fallback={<div className="cv-blank">{tr('여는 중', 'Opening')}</div>}><PdfView path={path} zoom={zoom} /></Suspense>
          : (kind === 'office' || kind === 'other') && pageDoc(path) ? <OfficeDoc f={at} zoom={zoom} fallback={kind} />
          : kind === 'office' || kind === 'other' || kind === 'audio' ? <ExtraDoc path={path} kind={kind} />
          : kind === 'text' ? <pre className="ft-text" style={zoom === 100 ? undefined : { fontSize: `${12.5 * zoom / 100}px` }}>{text}</pre>
          : <div className="cv-blank">{tr('미리보기가 안 되는 파일이에요', 'No preview for this file')}</div>}
      </div>
    </div>
  );
}
