// 세션 독(패널 하나로 S1~S3, 사용자 10/12 "어디서나") — 그 참모가 잡은 세션이 가운데 맨 아래 같은 자리에. 홈·보관함·문서 탭·세션·기능 화면 어디서나.
// 접힘 = 34px 줄(점 + 이름 + 마지막 한 줄, 사람 필요가 맨 앞), 펼침 = 위로 작은 터미널 칸들(옛 대시보드 칸 그대로, 세션 브라우저도 그 칸 안).
// 펼침 높이는 위 손잡이로 끌어 — 앱 전체 한 값으로 기억. 칸 머리 '크게'·줄 이름 = 가운데 세션 탭. 끝에 조용한 상태(대화 %)
import { useRef, useState } from 'react';
import { tr } from '../../i18n';
import { activityOrder } from '../../domain/lockerTree';
import { dotKind } from '../../domain/dot';
import { dockHeight } from '../../domain/sessionDock';
import { paneStatus } from '../../domain/agentBrowser';
import { OWN_WEB } from '../../domain/dashboard';
import { IconButton } from '../kit/IconButton';
import { IconChevron } from '../Icons';
import { Pane, type DashLine } from './DashboardView';

const OPEN_KEY = 'lockerActOpen';
const H_KEY = 'sessionDockH';
const loadH = (): number | null => { try { const v = localStorage.getItem(H_KEY); return v === null ? null : Number(v); } catch { return null; } };

export function ActivityBar({ lines, quiet, onOpenSession, term, onMenu, on }: {
  lines: DashLine[];
  quiet?: string;
  /** 크게 — 가운데 세션 탭으로 */
  onOpenSession: (id: string) => void;
  /** 칸 안 진짜 터미널(직접 칠 수 있다) */
  term: (id: string) => React.ReactNode;
  /** 줄 오른쪽 클릭(크게·끄기) */
  onMenu?: (e: React.MouseEvent, id: string) => void;
  /** 지금 가운데 탭으로 연 세션(줄에 테두리) */
  on?: string | null;
}) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } });
  const [h, setH] = useState<number | null>(loadH);
  const [live, setLive] = useState<string | null>(null);
  const box = useRef<HTMLElement>(null);
  const flip = () => setOpen((o) => { try { localStorage.setItem(OPEN_KEY, o ? '0' : '1'); } catch { /* 이번 실행만 */ } return !o; });
  const ordered = activityOrder(lines.filter((l) => !l.id.startsWith(OWN_WEB)));
  const own = lines.find((l) => l.id.startsWith(OWN_WEB));
  if (own) ordered.unshift(own); // 참모 자기 브라우저는 맨 앞 칸(줄에도 맨 앞)
  // 가운데 칸 높이 — 펼침 최대(60%)를 재는 기준
  const room = () => box.current?.parentElement?.getBoundingClientRect().height ?? window.innerHeight;
  const height = dockHeight(h, room());
  // 위 손잡이 끌기 — 놓을 때 앱 전체 한 값으로 기억(참모를 바꿔도 같은 높이)
  const grab = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const y0 = e.clientY, h0 = height;
    let last = h0;
    const move = (ev: PointerEvent) => { last = dockHeight(h0 + (y0 - ev.clientY), room()); setH(last); };
    const end = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end); removeEventListener('blur', end);
      try { localStorage.setItem(H_KEY, String(last)); } catch { /* 이번 실행만 */ }
    };
    addEventListener('pointermove', move); addEventListener('pointerup', end); addEventListener('pointercancel', end); addEventListener('blur', end);
  };
  if (!ordered.length && !quiet) return null;
  return (
    <section ref={box} className={`lk-act ${open ? 'open' : ''}`} aria-label={tr('하는 일', 'Work')}>
      {open && ordered.length > 0 && (
        <>
          <div className="lk-act-grip" onPointerDown={grab} role="separator" aria-orientation="horizontal" aria-label={tr('끌어서 높이 조절', 'Drag to resize')} title={tr('끌어서 높이 조절', 'Drag to resize')}><i /></div>
          <div className="lk-act-panes" style={{ height }}>
            {ordered.map((l) => {
              // 참모 자기 브라우저 칸(OWN_WEB)은 세션이 아니다 — 터미널·크게 없음(옛 참모 대시보드 칸 줄 맨 앞에 있던 것)
              const own = l.id.startsWith(OWN_WEB);
              return <Pane key={l.id} l={l} term={own ? undefined : term(l.id)} live={!own && live === l.id} onToggle={() => setLive((x) => (x === l.id ? null : l.id))} onBig={own ? undefined : () => onOpenSession(l.id)} />;
            })}
          </div>
        </>
      )}
      <div className="lk-act-bar">
        {/* 항목은 최대 폭까지 + 말줄임, 넘치면 이 줄만 가로로 민다 — 이름이 길면 옆 항목을 덮었다(2026-10-11 184.png) */}
        <div className="lk-act-list" onWheel={(e) => { if (!e.deltaX) e.currentTarget.scrollLeft += e.deltaY; }}>
        {ordered.map((l) => {
          const st = paneStatus(l.status, l.browser);
          const ask = st === 'human' || l.status === 'ask' || l.st === 'asks' || l.st === 'blocked' || l.st === 'login';
          return (
            <button key={l.id} className={`lk-act-s ${ask ? 'ask' : ''} ${on === l.id ? 'on' : ''}`} onClick={() => onOpenSession(l.id)} onContextMenu={onMenu ? (e) => onMenu(e, l.id) : undefined}
              title={l.line ? `${l.name} — ${l.line}` : l.name}>
              <span className={`lk-dot d-${ask ? 'ask' : dotKind(l)}`} aria-hidden="true" />
              <b>{l.name}</b><span className={ask || !l.line ? '' : 'mono'}>{l.line || (ask ? tr('답 기다림', 'Waiting for you') : l.status === 'run' ? tr('일하는 중', 'Working') : tr('쉼', 'Idle'))}</span>
            </button>
          );
        })}
        </div>
        {quiet && <span className="lk-act-q">{quiet}</span>}
        {ordered.length > 0 && (
          <IconButton size="s" className={`lk-act-tog ${open ? 'open' : ''}`} label={open ? tr('터미널 접기', 'Collapse terminals') : tr('터미널 펼치기', 'Expand terminals')} pressed={open} onClick={flip}><IconChevron /></IconButton>
        )}
      </div>
    </section>
  );
}
