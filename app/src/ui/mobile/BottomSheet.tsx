// 폰 공용 시트(2026-10-11 시트 공용화) — 화면마다 따로 짜던 시트 몸통(뒷막·손잡이·끌어 닫기·올라오기·safe-area·키보드 위·닫기)을 한 벌로.
// kind: sheet = 아래에서 올라오는 시트(머리 + 목록), card = 띄운 작은 카드(길게 누르기 메뉴·프로필), full = 화면을 덮는 보기(파일·세션·브라우저 크게)
// 시트는 화면 틀(.m-app) 안 '시트 자리'(SheetHostProvider)로 포털 — 틀이 보이는 화면(키보드 위)에 맞춰지니 시트도 키보드 위에 붙고,
// 참모 색(--orch-*)도 그대로 물려받는다. 채팅 시트 안에서 연 시트(모델 고르기)가 채팅 시트 높이에 갇히던 것도 이걸로 풀린다.
// 끌기·박힘 풀기·진단은 useSheetDrag(채팅 시트와 같은 것). 층은 var(--z-sheet), 왼쪽 색 띠 없음
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { modalModel } from '../../domain/sheetGuard';
import { useSheetDrag } from './useSheetDrag';
import { SheetHead } from './kit';
import { tr } from '../../i18n';

type Host = { el: HTMLElement | null; kb: boolean };
const HostCtx = createContext<Host>({ el: null, kb: false });

/** 시트 자리 — 화면 틀 안(참모 색이 걸린 곳)에 두면 그 아래 시트가 전부 여기로 그려진다. kb = 키보드가 떠 있나(useViewport) */
export function SheetHostProvider({ kb, children }: { kb: boolean; children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  return (
    <HostCtx.Provider value={{ el, kb }}>
      {children}
      <div ref={setEl} className="m-sheet-host" />
    </HostCtx.Provider>
  );
}

/** 시트 자리로 그리기(알림처럼 몸통이 다른 판) — 자리가 없으면(짝짓기·깨우기 화면) body */
export function SheetPortal({ children }: { children: ReactNode }) {
  const host = useContext(HostCtx);
  return createPortal(children, host.el ?? document.body);
}

/** 시트 안에서 — 닫기(내려간 뒤 onClose)와 뜬 직후 누름 막기(armed) */
const SheetCtx = createContext<{ close: () => void; armed: boolean }>({ close: () => {}, armed: true });
export const useSheet = () => useContext(SheetCtx);

/** t 에서 판(stop)까지 올라가며 세로로 스크롤되는 칸 — 그 칸이 맨 위일 때만 시트를 끈다(스크롤된 칸에서 아래로 쓸면 칸 스크롤) */
function scrollBox(t: Element, stop: Element | null): Element | null {
  for (let el: Element | null = t; el && el !== stop; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) return el;
  }
  return null;
}

/** 뒷막·시트가 내려가는 시간(CSS transition 과 같이) */
const CLOSE_MS = 220;

type Props = {
  /** 화면 읽기 이름(dialog aria-label) */
  label: string;
  kind?: 'sheet' | 'card' | 'full';
  onClose: () => void;
  /** 머리 제목 — sheet·full 은 SheetHead(제목 + actions + 닫기 X), card 는 회색 작은 제목 */
  title?: ReactNode;
  titleClass?: string;
  actions?: ReactNode;
  /** 바꾸는 중처럼 닫으면 안 될 때 — X·뒷막·끌어 닫기가 다 막힌다 */
  closeDisabled?: boolean;
  /** SheetHead 대신 직접 머리(full 에서 상태 칩·버튼이 머리 안에 들어갈 때) */
  head?: ReactNode;
  /** 뜬 직후 이만큼(ms)은 뒷막·항목 누름을 안 받는다 — 길게 눌러 띄운 메뉴는 손을 떼는 순간 손가락 밑 항목이 눌렸다 */
  armMs?: number;
  /** 판(.m-pick·.m-menu·.m-view)에 더할 클래스 */
  className?: string;
  /** sheet 목록 칸 클래스(기본 m-picker-list) */
  bodyClass?: string;
  /** 안 — 함수면 닫기(내려간 뒤 onClose)·뜬 직후 막기를 받는다 */
  children?: ReactNode | ((s: { close: () => void; armed: boolean }) => ReactNode);
};

export function BottomSheet({ label, kind = 'sheet', onClose, title, titleClass, actions, closeDisabled, head, armMs, className, bodyClass, children }: Props) {
  const host = useContext(HostCtx);
  const [shown, setShown] = useState(kind === 'full'); // 처음 그린 다음 프레임에 올린다(아래에서 올라오게)
  const [armed, setArmed] = useState(!armMs);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const closing = useRef(false);
  const live = useRef({ onClose, closeDisabled });
  live.current = { onClose, closeDisabled };
  useEffect(() => { if (kind === 'full') return; const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id); }, [kind]);
  useEffect(() => { if (!armMs) return; const t = window.setTimeout(() => setArmed(true), armMs); return () => window.clearTimeout(t); }, [armMs]);
  const close = useCallback(() => {
    if (live.current.closeDisabled || closing.current) return;
    if (kind === 'full') { live.current.onClose(); return; }
    closing.current = true;
    setShown(false);
    window.setTimeout(() => live.current.onClose(), CLOSE_MS);
  }, [kind]);

  const { drag, grab } = useSheetDrag({
    kind: kind === 'card' ? 'card' : 'pick',
    el: panel,
    // 글 칸에서 시작한 손가락은 글 고르기에 맡긴다. 손가락 밑 가장 가까운 세로 스크롤 칸(목록·프로필 묶음)이 맨 위일 때만
    pullFrom: (t) => (kind === 'full' || t.closest('input, textarea, select') ? null : scrollBox(t, panel) ?? { scrollTop: 0 }),
    model: modalModel(panel?.offsetHeight ?? 400),
    go: (s) => { if (s === 'closed') close(); },
    vh: host.el?.closest('.m-app')?.clientHeight || window.innerHeight, // 시트 자리·참모 공간은 상자 없는 칸(display:contents)이라 틀에서 잰다
  });

  const body = typeof children === 'function' ? children({ close, armed }) : children;
  const kb = host.kb ? ' m-kb' : '';
  // 카드는 바닥에서 떠 있어(여백 8px + 홈 바) 제 높이만큼 내리면 윗 끝이 보인다 — 조금 더
  const y = shown ? `${drag ?? 0}px` : kind === 'card' ? 'calc(100% + 56px)' : '100%';
  const move = kind === 'full' ? undefined : { transform: `translateY(${y})`, transition: drag === null ? undefined : 'none' };
  const back = <button type="button" className={shown ? 'm-pick-back m-on' : 'm-pick-back'} aria-label={tr('닫기', 'Close')} onClick={() => { if (armed) close(); }} />;
  const sheetHead = head ?? (title !== undefined && <SheetHead title={title} titleClass={titleClass} onClose={close} closeDisabled={closeDisabled}>{actions}</SheetHead>);

  const node = kind === 'full' ? (
    <div ref={setPanel} className={`m-view${className ? ` ${className}` : ''}${kb}`} role="dialog" aria-label={label}>
      {sheetHead}
      {body}
    </div>
  ) : kind === 'card' ? (
    <div className={`m-menu-wrap${kb}`} role="dialog" aria-modal="true" aria-label={label}>
      {back}
      <div ref={setPanel} className={`m-menu${className ? ` ${className}` : ''}`} style={move}>
        {title !== undefined && <div className="m-menu-title">{title}</div>}
        {body}
      </div>
    </div>
  ) : (
    <div className={`m-pick-wrap${kb}`} role="dialog" aria-modal="true" aria-label={label}>
      {back}
      <div ref={setPanel} className={`m-pick${className ? ` ${className}` : ''}`} style={move}>
        <div className="m-pick-grab" data-grab {...grab}><div className="m-handle" /></div>
        {sheetHead}
        <div className={bodyClass ?? 'm-picker-list'}>{body}</div>
      </div>
    </div>
  );
  return <SheetCtx.Provider value={{ close, armed }}>{host.el ? createPortal(node, host.el) : node}</SheetCtx.Provider>;
}
