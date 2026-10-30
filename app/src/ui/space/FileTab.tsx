import { invoke } from '@tauri-apps/api/core';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FIT, IMAGE_STEPS, stepZoom } from '../../domain/readerZoom';
import { imageWidth, shownPercent, toggleFitActual } from '../../domain/imageFit';
import { docUrl, kindOf, pageDoc } from '../../domain/reader';
import { isCurationHtml } from '../../domain/curation';
import { tr } from '../../i18n';
import { IconMaximize, IconReveal, IconRestore } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { ExtraDoc, HtmlFrame } from '../reader/Reader';
import { OfficeDoc } from './Preview';
import { SendToOrch, type OrchTo } from './SendToOrch';
import { WebPage } from '../WebPage';
import { CraftOpenChip } from '../craft/openInCraft';
import { applyAnchor, markAnchor, useWheelZoom } from '../zoomAnchor';
import { useImageFit, useImagePan } from '../imageFit';
import { dragOut } from './dragPath';
import { lockerApi } from './useLocker';
import { isTeamCache } from '../../domain/teamLocker';

const PdfView = lazy(() => import('../reader/PdfView'));

/**
 * 보관함 탭 안 미리보기 — 그림·영상·html·pdf·오피스·http(s) 주소(2026-10-11 사용자 "기본은 탭으로", 주소는 10-16). md·엑셀은 편집 페이지(DocPage·SheetPage)가 따로.
 * 머리 = 작은 경로 한 줄 + 확대 단추 + 보내기·크게 보기(모달). 확대는 탭에서도(2026-10-12), 짚기는 크게 보기(Preview)에서
 */
export function FileTab({ path, where, attachTo, onAttach, onBig, big = false, onCuration, zoom = 100, zoomUi, onZoom }: {
  /** 탭 확대 배율(%) — 그림은 0 = 맞춤. 파일마다 기억(domain/tabZoom) */
  zoom?: number;
  /** 머리의 확대 단추(TabZoomBar) */
  zoomUi?: React.ReactNode;
  /** 그림 두 번 누르기 — 새 배율(맞춤↔100%)과 누른 곳(기준점)을 탭 배율을 쥔 쪽에 */
  onZoom?: (z: number, at: { x: number; y: number }) => void;
  path: string;
  /** 머리 작은 경로 한 줄(domain/lockerTabs pathLine) */
  where: string;
  /** 참모에게 보내기 — 그 참모 채팅 입력칸에 붙인다 */
  /** e = 누른 단추(팀 모드에선 그 자리에 참모 고르기) */
  onAttach?: (e?: React.MouseEvent<HTMLElement>) => void;
  attachTo?: OrchTo | null;
  onBig: () => void;
  /** 이미 크게 보는 중(메신저 따로 창 — 칸을 창 전체로) — 단추가 '원래 크기로' */
  big?: boolean;
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
  // 그림 확대 — 실제 픽셀 기준 %. 맞춤은 칸에 통째로 들어오는 배율(작은 그림은 키우고 큰 그림은 줄인다, 2026-10-28 사용자). 자연 폭·맞춤 배율은 불러온 뒤·칸이 바뀔 때 잰다
  const imgBox = useRef<HTMLDivElement>(null);
  const { natural, fit, onLoad } = useImageFit(imgBox);
  // 탭 배율을 쥔 쪽(SpaceView)이 없으면(메신저 따로 창) 그림 배율은 여기서 — 맞춤에서 시작, 휠·핀치·두 번 누르기
  const own = !onZoom && kind === 'image';
  const [ownZ, setOwnZ] = useState(FIT);
  const z = own ? ownZ : zoom;
  const width = kind === 'image' ? imageWidth(natural, z, fit) : undefined;
  const zoomTo = (nz: number, at?: { x: number; y: number }) => {
    if (own) { markAnchor(imgBox.current, at); setOwnZ(nz); } else if (at) onZoom?.(nz, at);
  };
  // 확대 기준점(SpaceView 가 배율 바꾸기 직전 markAnchor) — 다시 그린 뒤 그 점이 제자리에 오게 스크롤(왼쪽 위로 커졌다, 2026-10-19 사용자)
  useLayoutEffect(() => applyAnchor(imgBox.current), [z]);
  useImagePan(() => imgBox.current, (at) => zoomTo(toggleFitActual(z, fit), at));
  useWheelZoom(() => (own ? imgBox.current : null), (dir, at) => zoomTo(stepZoom(Math.round(shownPercent(z, fit)), dir, IMAGE_STEPS), at));
  // 그림을 끌면 바깥 앱으로(창 밖이면 맥 끌기, 10-30 사용자) — 칸이 넘치면 끌기는 그림 이동(useImagePan) 몫
  const out = dragOut(path);
  const imgOut = (e: React.PointerEvent) => {
    const b = imgBox.current;
    if (b && (b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1)) return;
    out.onPointerDown?.(e);
  };
  return (
    <div className="cv-doc cv-filetab">
      {kind !== 'web' && <div className="cv-doc-bar">
        <span className="cv-path" title={tr('끌어서 파인더·카톡·메일로', 'Drag to Finder, chat or mail')} {...dragOut(path)}>{where}</span>
        <span className="cv-sp" />
        {zoomUi}
        <CraftOpenChip path={path} />
        {/* 팀 파일(데이터 폴더에 풀어 둔 평문)은 파인더로 안 연다 — 머리 내려받기가 다운로드 폴더에 꺼낸다 */}
        {!isTeamCache(path) && <IconButton label={tr('파인더에서 보기', 'Show in Finder')} onClick={() => void lockerApi.reveal(path).catch(() => {})}><IconReveal /></IconButton>}
        {onAttach && <SendToOrch to={attachTo} onClick={onAttach} />}
        <IconButton label={big ? tr('원래 크기로', 'Restore size') : tr('크게 보기', 'Open large')} title={big ? tr('원래 크기로', 'Restore size') : tr('크게 보기 — 확대·가득 채우기', 'Open large — zoom and fill')} onClick={onBig}>{big ? <IconRestore /> : <IconMaximize />}</IconButton>
      </div>}
      <div className="ft-body">
        {gate ? null
          : kind === 'web' ? <WebPage url={path} />
          : kind === 'image' ? <><div className={`pv-image ${z === FIT ? 'fit' : ''}`} ref={imgBox} onPointerDown={imgOut}><img src={docUrl(path)} alt="" draggable={false} onLoad={onLoad}
            style={width ? { maxWidth: 'none', maxHeight: 'none', width: `${width}px` } : undefined} /></div>
            {natural > 0 && <span className="pv-pct" aria-hidden>{Math.round(shownPercent(z, fit))}%</span>}</>
          : kind === 'video' ? <video className="pv-video" src={docUrl(path)} controls playsInline />
          : kind === 'html' ? <div className="rd-zoombox"><HtmlFrame className="rd-frame" src={docUrl(path)} zoom={zoom} record={path} /></div>
          : kind === 'pdf' ? <Suspense fallback={<div className="cv-blank">{tr('여는 중', 'Opening')}</div>}><PdfView path={path} zoom={zoom} /></Suspense>
          : (kind === 'office' || kind === 'other') && pageDoc(path) ? <OfficeDoc f={at} zoom={zoom} fallback={kind} />
          : kind === 'office' || kind === 'other' || kind === 'audio' ? <ExtraDoc path={path} kind={kind} craft={false} />
          : kind === 'text' ? <pre className="ft-text" style={zoom === 100 ? undefined : { fontSize: `${12.5 * zoom / 100}px` }}>{text}</pre>
          : <div className="cv-blank">{tr('미리보기가 안 되는 파일이에요', 'No preview for this file')}</div>}
      </div>
    </div>
  );
}
