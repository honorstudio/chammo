import { invoke } from '@tauri-apps/api/core';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { docTitle } from '../../domain/spaceTree';
import type { SheetBook } from '../../domain/sheetBook';
import { craftErr } from '../../domain/craftDrawer';
import type { LogEntry } from '../../domain/sheetLog';
import { tr } from '../../i18n';
import { IconChevron, IconPin } from '../Icons';
import { SendToOrch, type OrchTo } from './SendToOrch';
import { IconButton } from '../kit/IconButton';
import type { SheetControl, SheetStatus, SheetView, SheetWho } from './SheetGrid';
import { addSheetLog } from './pending';
import { SendFab } from './SendFab';
import { openInCraft } from '../craft/openInCraft';

// 표(Univer)는 엑셀을 열 때 불러온다 — 11MB 라 앱 시작에 안 싣는다(ADR 0004)
const SheetGrid = lazy(() => import('./SheetGrid'));

/**
 * 엑셀 페이지 — 스페이스 가운데(md 문서 페이지 자리)에서 xlsx 를 바로 고친다. 저장은 저절로(원본 xlsx 에서 고친 칸만),
 * 차트처럼 표가 못 그리는 것은 '차트 N개'로 원본 미리보기를 연다(저장해도 파일엔 그대로 남는다)
 */
export function SheetPage({ path, owner, where, onBack, tail, onAttach, attachTo, pinned, onPin, onPreview, send, sendTo, whoOf, zoom = 100 }: {
  /** 탭 확대 배율(%) — 표 칸 전체가 CSS zoom 으로 커진다 */
  zoom?: number;
  path: string;
  owner: string;
  /** 보관함 탭으로 열었으면 — 뒤로 알약·이름 대신 작은 경로 한 줄 */
  where?: string;
  onBack?: () => void;
  tail?: React.ReactNode;
  /** e = 누른 단추(팀 모드에선 그 자리에 참모 고르기) */
  onAttach?: (e?: React.MouseEvent<HTMLElement>) => void;
  /** 붙일 참모(이름·색) — 보내기 단추 색 */
  attachTo?: OrchTo | null;
  pinned?: boolean;
  onPin?: () => void;
  /** 원본 미리보기(Quick Look — 차트까지 보인다) */
  onPreview?: () => void;
  /** 오른쪽 아래 '보낼 것' — 저장한 고친 칸이 '[스페이스] 사용자가 고친 것'으로 간다(md 문서와 같은 모음) */
  send?: (text: string) => Promise<void>;
  sendTo?: string;
  /** 참모 칸 쓰기(scripts/sheet)를 보여 줄 때 — 세션 id → 그 참모 프사·색 */
  whoOf?: (by: string) => SheetWho | null;
}) {
  const [opened, setOpened] = useState<{ book: SheetBook; stamp: string } | null>(null);
  const [err, setErr] = useState('');
  const [status, setStatus] = useState<{ s: SheetStatus; d?: string }>({ s: 'saved' });
  const [gen, setGen] = useState(0);
  const [gridErr, setGridErr] = useState('');
  const [start, setStart] = useState<SheetView | undefined>();
  const control = useRef<SheetControl | null>(null);
  const reopen = (v?: SheetView) => { setStart(v); setGen((g) => g + 1); };
  useEffect(() => {
    setOpened(null); setErr(''); setStatus({ s: 'saved' });
    void invoke<{ book: SheetBook; stamp: string }>('read_sheet_book', { path }).then(setOpened, (e) => setErr(String(e)));
  }, [path, gen]);
  const charts = opened?.book.sheets.reduce((n, s) => n + s.charts, 0) ?? 0;
  const note = status.s === 'blocked' ? tr(`${status.d ?? '이 조작'}은 아직 원본에 저장할 수 없어요. ⌘Z로 되돌리거나 다시 열어 주세요`, `Can't save "${status.d ?? 'this'}" to the file yet. Undo (⌘Z) or reopen`)
    : status.s === 'conflict' ? tr(`다른 곳에서도 같은 부분을 고쳤어요(${status.d ?? ''}). 내가 고친 내용은 아직 저장 전이에요`, `It was also changed elsewhere (${status.d ?? ''}). Your edits are not written yet`)
    : status.s === 'gone' ? tr('파일이 없어졌거나 이름이 바뀌었어 — 고친 건 아직 안 썼어', 'The file was removed or renamed — your edits are not written')
    : status.s === 'error' ? `${tr('저장 못 했어', "Couldn't save")} — ${status.d ?? ''}` : '';
  return (
    <div className="cv-doc cv-sheet">
      <div className="cv-doc-bar">
        {where !== undefined ? <span className="cv-path" title={path}>{where}</span> /* 탭으로 연 것 — 이름은 탭에, 머리엔 어느 폴더인지만(2026-10-11 사용자) */
          : <span className="cv-crumb">{onBack ? <button className="cv-back" onClick={onBack} title={owner}><IconChevron />{owner}</button> : <span>{owner}</span>}<i>/</i><b>{docTitle(path)}</b></span>}
        {status.s === 'saving' && <span className="cv-sheet-saving">{tr('저장 중', 'Saving')}</span>}
        <span className="cv-sp" />
        {charts > 0 && onPreview && <button className="cv-chip" onClick={onPreview} title={tr('차트는 원본 미리보기로 — 저장해도 파일엔 그대로 남아', 'Charts show in the original preview — saving keeps them')}>{tr(`차트 ${charts}개`, `${charts} chart${charts > 1 ? 's' : ''}`)}</button>}
        {/* 같은 파일을 참모 표 칸으로 — 계산·정렬·서식·차트처럼 칸이 많이 바뀌는 일(2026-10-21 사용자 A안). 닫으면 그 자리에 저장 */}
        <button className="cv-chip cv-sheet-grid" disabled={status.s === 'saving'} title={tr('같은 파일을 참모 표 칸에서 열기 — 닫으면 이 파일에 저장', 'Open this file in a Chammo Grid pane — saved back here on close')}
          onClick={() => { setGridErr(''); void openInCraft(path, 'gridcraft').catch((e) => setGridErr(craftErr(e).text)); }}>{tr('참모 표로 열기', 'Open in Chammo Grid')}</button>
        {onAttach && <SendToOrch to={attachTo} onClick={onAttach} />}
        {onPin && <IconButton pressed={!!pinned} label={pinned ? tr('고정됨', 'Pinned') : tr('고정', 'Pin')} onClick={onPin}><IconPin /></IconButton>}
        {tail}
      </div>
      {gridErr && <div className="cv-sheet-note" role="status"><span>{tr('참모 표로 못 열었어', "Couldn't open it in Chammo Grid")} — {gridErr}</span></div>}
      {note && (
        <div className="cv-sheet-note" role="status">
          <span>{note}</span>
          {status.s === 'conflict' ? (
            <>
              <button className="cv-btn" onClick={() => reopen()}>{tr('바깥 판 불러오기', 'Load their version')}</button>
              <button className="cv-btn" onClick={() => void control.current?.keepMine()}>{tr('내 판으로 저장', 'Save mine')}</button>
            </>
          ) : status.s !== 'error' && status.s !== 'gone' && <button className="cv-btn" onClick={() => reopen()}>{tr('다시 열기', 'Reopen')}</button>}
        </div>
      )}
      <div className="cv-sheet-body" style={zoom === 100 ? undefined : { zoom: zoom / 100 }}>
        {err ? <div className="cv-blank">{tr('못 읽었어', "Couldn't read it")} — {err}</div>
          : !opened ? <div className="cv-blank">{tr('여는 중', 'Opening')}</div>
          : (
            <Suspense fallback={<div className="cv-blank">{tr('표 여는 중', 'Opening the sheet')}</div>}>
              <SheetGrid key={`${path}#${gen}`} path={path} book={opened.book} stamp={opened.stamp} start={start} control={control} onReload={reopen} whoOf={whoOf}
                onSaved={(log: LogEntry[]) => addSheetLog(path, log)} onStatus={(s, d) => setStatus({ s, d })} />
            </Suspense>
          )}
      </div>
      {send && <SendFab send={send} sendTo={sendTo} path={path} />}
    </div>
  );
}
