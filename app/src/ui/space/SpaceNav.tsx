import { useEffect, useRef, useState } from 'react';
import { orchRows, type OrchRow } from '../../domain/orchRows';
import { HOME_PICK } from '../../domain/orchHome';
import type { Session } from '../../domain/session';
import { sessionStatus, statusTone, statusWord, type ActivityStatus } from '../../domain/status';
import type { StoppedSession } from '../../domain/stopped';
import { docTitle } from '../../domain/spaceTree';
import { assistant, josa, tr } from '../../i18n';
import { IconChevron, IconTerminal, IconFolder, IconPage, IconPerson, IconPin, IconPlus } from '../Icons';
import { FileTree } from './FileTree';
import { Ctx } from '../Sidebar';
import { dragPath, dragProps } from './dragPath';
import { OrchName, useOrchActions } from '../orchActions';
import { IconClose } from '../Icons';
import { splitOrchName } from '../../domain/orchLabel';
import { OrchAvatar, avatarState } from '../avatar';
import { orchDisplay } from '../orchLabels';
import { OrchRole } from '../orchRoleStore';
import { keyLabel } from '../../domain/keys';
import { IS_WIN } from '../../domain/reader';
import { groupRoutines, type RoutineItem } from '../../domain/routine';

/** 왼쪽 목록 줄을 키보드로도 — Tab 으로 가서 Enter·Space 면 그 줄을 누른 것과 같다(줄 안 버튼은 제 것대로). 줄이 div 라 마우스만 됐다(2026-10-03 QA 20번) */
const rowKeys = {
  role: 'button',
  tabIndex: 0,
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    e.currentTarget.click();
  },
};

export type ProjectGroup = { name: string; root: string; sessions: Session[] };

/** 펼친 칸 기억 — 이 컴퓨터에만(막혀 있으면 이번 실행만) */
const OPEN_KEY = 'spaceOpen';
const loadOpen = (): string[] | null => { try { const v = localStorage.getItem(OPEN_KEY); return v ? (JSON.parse(v) as string[]) : null; } catch { return null; } };
const saveOpen = (v: string[]) => { try { localStorage.setItem(OPEN_KEY, JSON.stringify(v)); } catch { /* 이번 실행만 */ } };

/** 상태는 글자 대신 표시 하나 — 일하면 도는 고리, 물으면 노란 점, 쉬면 없음(글자는 올리면 보인다). 말·갈래는 domain/status 한 벌 */
export function StateMark({ st }: { st: ActivityStatus }) {
  const c = statusTone(st);
  return c === 'run' ? <span className="cv-spin" title={statusWord(st)} /> : c === 'ask' ? <span className="cv-ask" title={statusWord(st)} /> : null;
}

/**
 * 채팅 뷰 메뉴(⌘B) — v10: 오케스트레이터(참모마다 대시보드 + 문서) → 내 페이지 → 프로젝트(대시보드 + 문서).
 * 참모 문서 = 고정한 것 + 이번에 띄운 md(최근 먼저). 펼치고 접기는 기억한다
 */
export function SpaceNav({ statusOf = sessionStatus, orchPins = [], stoppingIds = [], startingOrchs = [], onNewOrch, routines = [], helpers = [], loose = [], pagesRoot = '', onChatTab, ctxOf, onAddProject, idle = [], offOrchs = [], onResume, onRemoveStopped, orchs, viewId, colorOf, projects, holders, pick, onPick, orchDocsOf, isPinned, onTogglePin, pages, pageTitle, onNewPage, onOpenFile, selectedFile, onTrashPage }: {
  /** 세션 상태(메뉴·대시보드·사무실 같은 판단) — 없으면 세션만으로 */
  statusOf?: (s: Session) => ActivityStatus;
  orchPins?: string[];
  /** 내 페이지 지우기 — 휴지통으로(하위 페이지 같이) */
  onTrashPage?: (path: string) => void;
  /** 세션이 안 떠 있는 프로젝트 — 흐리게, 누르면 그 프로젝트 대시보드 */
  idle?: { name: string; root: string }[];
  /** 꺼진 참모 — 흐리게, 이어서 켜기 */
  offOrchs?: StoppedSession[];
  /** 끄는 중인 참모 id · 켜는 중인 꺼진 참모 — 줄을 그대로 두고 상태만(domain/orchRows) */
  stoppingIds?: string[];
  startingOrchs?: StoppedSession[];
  /** dev 폴더 자체에서 연 세션('프로젝트 밖') */
  loose?: Session[];
  onResume?: (s: StoppedSession) => void;
  onRemoveStopped?: (s: StoppedSession) => void;
  /** 컨텍스트(대화 메모리) 사용량 % — 예전 사이드바와 같은 값 */
  ctxOf?: (s: Session) => number | undefined;
  /** 참모 이름을 누르면 채팅 탭도 그 참모로 */
  onChatTab?: (id: string) => void;
  /** 프로젝트 폴더 더하기 */
  onAddProject?: () => void;
  /** 참모 하나 더 — 오케스트레이터 머리의 + */
  onNewOrch?: () => void;
  orchs: Session[];
  viewId?: string;
  /** 참모 이름 → 기본 색(domain/avatar orchColor) */
  colorOf: (name: string) => string;
  projects: ProjectGroup[];
  holders: Map<string, string[]>;
  pick: string;
  onPick: (key: string, orchId?: string) => void;
  orchDocsOf: (o: Session) => { pinned: string[]; recent: string[] };
  isPinned: (o: Session, path: string) => boolean;
  onTogglePin: (o: Session, path: string) => void;
  pages: string[];
  /** 도우미 세션 — 예전 사이드바 '도우미' 칸처럼 */
  helpers?: Session[];
  /** 루틴(사이드바 '루틴' 칸과 같은 것) — 채팅 뷰엔 루틴을 볼 곳이 없었다(2026-10-01 사용자) */
  routines?: RoutineItem[];
  /** 내 페이지 폴더 — 하위 페이지 들여쓰기 기준 */
  pagesRoot?: string;
  pageTitle: (path: string) => string;
  onNewPage: () => void;
  /** 프로젝트 파일 나무에서 누른 파일 — md 는 문서, 그 밖은 미리보기 */
  onOpenFile: (path: string) => void;
  selectedFile?: string;
}) {
  const act = useOrchActions();
  const label = (o: Session) => act?.nameOf(o) ?? (o.name || assistant());
  // 오케스트레이터 칸 — 살아 있는·꺼진 참모를 한 목록으로, 지난번 자리를 기억해서(끄기·켜기 사이 줄이 안 사라지고 안 튀게)
  const prevRows = useRef<OrchRow[]>([]);
  const rows = orchRows({ live: orchs, off: [...offOrchs.slice(0, 6), ...startingOrchs], stopping: new Set(stoppingIds), starting: new Set(startingOrchs.map((x) => x.sessionId)), prev: prevRows.current, pins: orchPins });
  useEffect(() => { prevRows.current = rows; });
  const [open, setOpenState] = useState<string[]>(() => loadOpen() ?? (viewId ? [`o:${viewId}`] : []));
  const isOpen = (k: string) => open.includes(k);
  // 카테고리 접기(오케스트레이터·내 페이지·프로젝트·쉬는 프로젝트) — 기억, 쉬는 프로젝트는 처음엔 접힘(2026-09-30 사용자)
  const [closed, setClosed] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('spaceSecClosed') ?? '["idle"]') as string[]; } catch { return ['idle']; } });
  const secOpen = (k: string) => !closed.includes(k);
  const [doneOpen, setDoneOpen] = useState(false);
  const schedGroups = groupRoutines(routines);
  // 첫째 줄 = 이름 + 상태 글자(점·도는 호), 둘째 줄 = 언제(반복은 다음 실행, 한 번짜리는 날짜·남은 횟수)
  const schedRow = (r: RoutineItem) => (
    <div {...rowKeys} key={r.name} {...dragProps({ kind: 'text', text: r.ref }, r.name)} className={`cv-row top sched ${pick === `r:${r.name}` ? 'on' : ''}`} onClick={() => onPick(`r:${r.name}`)} title={`${r.name} · ${r.status} · ${r.line}`}>
      <span className="cv-fold small blank" />
      <span className="sched-txt">
        <span className="sched-l1">
          <span className="cv-label">{r.name}</span>
          <span className={`sched-st st-${r.state}`}>
            {r.state === 'running' ? <span className="cv-spin" /> : r.state === 'ok' || r.state === 'done' ? <i className="sched-dot ok" /> : r.state === 'failed' ? <i className="sched-dot fail" /> : r.state === 'noReport' ? <i className="sched-dot ask" /> : null}
            {r.status}
          </span>
        </span>
        <span className="sched-l2">{r.line}</span>
      </span>
    </div>
  );
  const flipSec = (k: string) => setClosed((c) => { const n = c.includes(k) ? c.filter((x) => x !== k) : [...c, k]; try { localStorage.setItem('spaceSecClosed', JSON.stringify(n)); } catch { /* 이번 실행만 */ } return n; });
  const secFold = (k: string) => <span className={`cv-fold small sec ${secOpen(k) ? 'open' : ''}`} aria-hidden><IconChevron /></span>;
  const toggle = (k: string, force?: boolean) => setOpenState((o) => {
    const next = force === true ? (o.includes(k) ? o : [...o, k]) : o.includes(k) ? o.filter((x) => x !== k) : [...o, k];
    saveOpen(next);
    return next;
  });

  // 내 페이지 지우기 — 올리면 X, 오른쪽 클릭 메뉴. 늘 한 번 묻고 휴지통으로(2026-09-30 사용자)
  const askTrash = (path: string, label: string) => act?.confirm({
    title: tr(`"${label}" 지울까?`, `Remove "${label}"?`),
    body: tr('휴지통으로 옮겨. 하위 페이지가 있으면 같이 옮기고, 휴지통에서 되살릴 수 있어.', 'Moves it to the Trash along with its subpages. You can restore it from the Trash.'),
    ok: tr('휴지통으로', 'Move to Trash'), run: () => onTrashPage?.(path),
  });
  const doc = (path: string, label: string, owner?: Session, pinnable?: boolean, removable?: boolean) => (
    <div {...rowKeys} key={path} {...dragPath(path)} className={`cv-row child ${pick === `d:${path}` ? 'on' : ''}`} onClick={() => onPick(`d:${path}`, owner?.id)} title={path}
      onContextMenu={removable && act && onTrashPage ? (e) => act.openMenu(e, [{ label: tr('페이지 지우기(휴지통으로)', 'Remove page (to Trash)'), danger: true, run: () => askTrash(path, label) }]) : undefined}>
      <span className="cv-ic"><IconPage /></span>
      <span className="cv-label">{label}</span>
      {pinnable && owner && (
        <button className={`cv-act ${isPinned(owner, path) ? 'keep' : ''}`} onClick={(e) => { e.stopPropagation(); onTogglePin(owner, path); }}
          title={isPinned(owner, path) ? tr('고정 풀기', 'Unpin') : tr('고정 — 새 세션에서도 보인다', 'Pin — stays for new sessions')} aria-label={tr('고정', 'Pin')}><IconPin /></button>
      )}
      {removable && act && onTrashPage && (
        <button className="cv-act" onClick={(e) => { e.stopPropagation(); askTrash(path, label); }} title={tr('페이지 지우기(휴지통으로)', 'Remove page (to Trash)')} aria-label={tr('페이지 지우기', 'Remove page')}><IconClose /></button>
      )}
    </div>
  );

  return (
    <nav className="cv-nav" aria-label={tr('메뉴', 'Menu')}>
      <div className={`cv-sec click ${pick === HOME_PICK ? 'here' : ''}`} onClick={() => onPick(HOME_PICK)} title={tr(`오케스트레이터 홈 — 어떤 ${josa(assistant(), '을', '를')} 켤지, 화살표로 접기`, 'Orchestrator home — pick who to run, arrow to fold')}><span className="with-ic"><span onClick={(e) => { e.stopPropagation(); flipSec('orch'); }}>{secFold('orch')}</span>{tr('오케스트레이터', 'Orchestrators')}</span>
        <span className="with-ic"><kbd>{keyLabel('⌘B', IS_WIN)}</kbd>
          {onNewOrch && <button className="cv-act show" onClick={(e) => { e.stopPropagation(); onNewOrch(); }} title={tr(`${assistant()} 하나 더 (⌘T)`, `One more ${assistant()} (⌘T)`)} aria-label={tr(`${assistant()} 하나 더`, `One more ${assistant()}`)}><IconPlus /></button>}</span></div>
      {secOpen('orch') && rows.map((r) => {
        if (r.live) {
          const o = r.live;
          const k = `o:${o.id}`;
          const docs = orchDocsOf(o);
          const stopping = r.phase === 'stopping';
          return (
            <div key={r.key} className="cv-group">
              <div {...rowKeys} className={`cv-row top ${pick === k ? 'on' : ''} ${viewId === o.id ? 'viewing' : ''} ${stopping ? 'off' : ''}`} onClick={() => { onPick(k, o.id); onChatTab?.(o.id); }} title={`${label(o)} · ${stopping ? tr('끄는 중', 'Stopping') : statusWord(statusOf(o))} — ${tr('두 번 눌러 이름 바꾸기 · 오른쪽 클릭 메뉴', 'double-click to rename · right-click for menu')}`}
                onDoubleClick={(e) => { e.stopPropagation(); act?.askRename(o); }} onContextMenu={act && !stopping ? (e) => act.menu(e, o, colorOf(o.name || '')) : undefined}
                {...dragProps({ kind: 'text', text: `[참모 ${label(o)} · 세션 ${o.id}]` }, label(o))}>
                <button className={`cv-fold ${isOpen(k) ? 'open' : ''}`} onClick={(e) => { e.stopPropagation(); toggle(k); }} aria-label={isOpen(k) ? tr('접기', 'Collapse') : tr('펼치기', 'Expand')}><IconChevron /></button>
                <OrchAvatar name={o.name || ''} size={22} state={stopping ? 'off' : avatarState(o, statusOf(o))} color={colorOf(o.name || '')} label={label(o)} />
                <span className="cv-namecol"><OrchName s={o} className="cv-label strong" /><OrchRole name={o.name || ''} /></span>
                {o.sessionId && orchPins.includes(o.sessionId) && <span className="cv-pin" role="img" aria-label={tr('고정됨', 'Pinned')} title={tr('고정됨 — 오른쪽 클릭으로 풀기', 'Pinned — right-click to unpin')}><IconPin /></span>}
                {stopping ? <span className="cv-transit">{tr('끄는 중…', 'Stopping…')}</span> : <><StateMark st={statusOf(o)} /><Ctx v={ctxOf?.(o)} /></>}
                {act && o.kind === 'background' && !stopping && <button className="cv-act" onClick={(e) => { e.stopPropagation(); act.askStop(o, undefined, 'nav-x'); }} title={tr('세션 끄기', 'Stop session')} aria-label={tr('세션 끄기', 'Stop session')}><IconClose /></button>}
              </div>
              {isOpen(k) && (
                <div className="cv-kids">
                  {!docs.pinned.length && !docs.recent.length && <div className="cv-empty">{tr('띄운 문서가 아직 없어요', 'No documents yet')}</div>}
                  {docs.pinned.map((p) => doc(p, docTitle(p), o, true))}
                  {docs.recent.length > 0 && <div className="cv-sub">{tr('이번에 띄운 것', 'Shown lately')}</div>}
                  {docs.recent.slice(0, 6).map((p) => doc(p, docTitle(p), o, true))}
                </div>
              )}
            </div>
          );
        }
        const x = r.off!;
        const nm = orchDisplay(x) || x.name;
        const starting = r.phase === 'starting';
        // 꺼진 줄도 cv-group 으로 감싼다 — 살아 있는 줄과 같은 자리·같은 프사(잠들기·깨어나기 전환이 이어진다)
        return (
          <div key={r.key} className="cv-group">
            <div className="cv-row top off" title={`${nm} — ${starting ? tr('켜는 중', 'Starting') : tr('꺼짐 · 오른쪽 클릭: 켜기·지우기', 'stopped · right-click: resume·remove')}`}
              onContextMenu={act && !starting ? (e) => act.openMenu(e, [
                ...(onResume ? [{ label: tr('이어서 켜기', 'Resume'), run: () => onResume(x) }] : []),
                { label: tr('목록에서 지우기', 'Remove from list'), danger: true, run: () => act.confirm({ title: tr(`${nm} 지울까?`, `Remove ${nm}?`), body: tr('꺼진 세션 목록에서 빼 — 같은 이름으로 쌓인 옛 기록도 같이(대화 기록 파일은 남아).', 'Removes it from stopped sessions, with older ones under the same name (transcript files stay).'), ok: tr('지우기', 'Remove'), run: () => onRemoveStopped?.(x) }) },
              ]) : undefined}>
              <span className="cv-fold small blank" />
              <OrchAvatar name={x.name} size={22} state={starting ? 'rest' : 'off'} color={colorOf(x.name)} label={nm} />
              <span className="cv-namecol"><span className="cv-label">{nm}</span><OrchRole name={x.name} /></span>
              {starting ? <span className="cv-transit">{tr('켜는 중…', 'Starting…')}</span> : onResume && <button className="cv-act show" onClick={() => onResume(x)} title={tr('이어서 켜기', 'Resume')}>{tr('켜기', 'On')}</button>}
            </div>
          </div>
        );
      })}

      {helpers.length > 0 && <div className="cv-sec click" onClick={() => flipSec('helpers')}><span className="with-ic">{secFold('helpers')}{tr('도우미', 'Helpers')}</span><span className="cv-count">{helpers.length}</span></div>}
      {secOpen('helpers') && helpers.map((h) => (
        <div {...rowKeys} key={h.id} className={`cv-row top ${pick === `s:${h.id}` ? 'on' : ''}`} onClick={() => onPick(`s:${h.id}`)} title={`${h.name} · ${statusWord(statusOf(h))} — ${tr('오른쪽 클릭: 끄기·지우기', 'right-click: stop·remove')}`}
          onContextMenu={act ? (e) => act.menu(e, h) : undefined}>
          <span className="cv-fold small blank" />
          <span className="cv-ic"><IconTerminal /></span>
          <span className="cv-label">{h.name}</span>
          <StateMark st={statusOf(h)} />
          <Ctx v={ctxOf?.(h)} />
        </div>
      ))}

      {loose.length > 0 && <div className="cv-sec click" onClick={() => flipSec('loose')} title={tr('프로젝트 폴더가 아니라 dev 폴더 자체에서 연 세션', 'Sessions opened in the projects folder itself, not in a project')}><span className="with-ic">{secFold('loose')}{tr('프로젝트 밖', 'Outside projects')}</span><span className="cv-count">{loose.length}</span></div>}
      {secOpen('loose') && loose.map((h) => (
        <div {...rowKeys} key={h.id} className={`cv-row top ${pick === `s:${h.id}` ? 'on' : ''}`} onClick={() => onPick(`s:${h.id}`)} title={`${h.name || h.id} · ${statusWord(statusOf(h))}`}
          onContextMenu={act ? (e) => act.menu(e, h) : undefined}>
          <span className="cv-fold small blank" />
          <span className="cv-ic"><IconTerminal /></span>
          <span className="cv-label">{h.name || h.id}</span>
          <StateMark st={statusOf(h)} />
          <Ctx v={ctxOf?.(h)} />
        </div>
      ))}

      {/* 리뷰는 위 막대 아이콘으로 옮겼다 — 이 칸은 세션이 사는 곳만(2026-10-06 사용자) */}
      {/* 예약(반복·한 번) — 화면 이름만 '예약', 칸 키·코드는 routines 그대로(2026-10-02) */}
      {routines.length > 0 && <div className="cv-sec click" onClick={() => flipSec('routines')}><span className="with-ic">{secFold('routines')}{tr('예약', 'Scheduled')}</span><span className="cv-count">{schedGroups.active.length}</span></div>}
      {secOpen('routines') && schedGroups.active.map(schedRow)}
      {secOpen('routines') && schedGroups.done.length > 0 && (
        <div {...rowKeys} className="cv-row top sched-fold" onClick={() => setDoneOpen((v) => !v)}>
          <span className={`cv-fold small ${doneOpen ? 'open' : ''}`} aria-hidden><IconChevron /></span>
          <span className="cv-label">{tr(`끝난 예약 ${schedGroups.done.length}개`, `${schedGroups.done.length} finished`)}</span>
        </div>
      )}
      {secOpen('routines') && doneOpen && schedGroups.done.map(schedRow)}

      <div className={`cv-sec click ${pick === 'm:' ? 'here' : ''}`} onClick={() => onPick('m:')} title={tr('내 페이지 첫 화면 — 화살표로 접기', 'My pages home — arrow to fold')}><span className="with-ic"><span onClick={(e) => { e.stopPropagation(); flipSec('pages'); }}>{secFold('pages')}</span><IconPerson />{tr('내 페이지', 'My pages')}</span>
        <button className="cv-act show" onClick={(e) => { e.stopPropagation(); onNewPage(); }} title={tr('새 페이지', 'New page')} aria-label={tr('새 페이지', 'New page')}><IconPlus /></button></div>
      {secOpen('pages') && pages.length === 0 && <button className="cv-empty" onClick={onNewPage}>{tr('+ 첫 페이지 만들기', '+ Create your first page')}</button>}
      {secOpen('pages') && pages.map((p) => { const depth = pagesRoot && p.startsWith(`${pagesRoot}/`) ? p.slice(pagesRoot.length + 1).split('/').length - 1 : 0; return <div key={p} style={depth ? { paddingLeft: depth * 14 } : undefined}>{doc(p, pageTitle(p), undefined, false, true)}</div>; })}

      <div className="cv-sec click" onClick={() => flipSec('projects')}><span className="with-ic">{secFold('projects')}{tr('프로젝트', 'Projects')}</span><span className="cv-count">{projects.length}</span>
        {onAddProject && <button className="cv-act show" onClick={(e) => { e.stopPropagation(); onAddProject(); }} title={tr('프로젝트 폴더 더하기', 'Add a project folder')} aria-label={tr('프로젝트 폴더 더하기', 'Add a project folder')}><IconPlus /></button>}</div>
      {secOpen('projects') && projects.length === 0 && <div className="cv-empty">{tr('떠 있는 프로젝트 세션이 없어요', 'No project sessions running')}</div>}
      {secOpen('projects') && projects.map((g) => {
        const k = `p:${g.root}`;
        const held = [...new Set(g.sessions.flatMap((s) => holders.get(s.id) ?? []))];
        const busy = g.sessions.find((s) => statusTone(statusOf(s)) === 'run') ?? g.sessions.find((s) => statusTone(statusOf(s)) === 'ask');
        return (
          <div key={g.root} className="cv-group">
            <div {...rowKeys} className={`cv-row top ${pick === k ? 'on' : ''}`} onClick={() => onPick(k)}
              {...dragProps({ kind: 'text', text: `[프로젝트 ${g.name} · ${g.root} · 세션 ${g.sessions.map((x) => `${x.workspace ?? x.project}(${x.id})`).join(', ')}]` }, g.name)} title={g.root}>
              <button className={`cv-fold ${isOpen(k) ? 'open' : ''}`} onClick={(e) => { e.stopPropagation(); toggle(k); }} aria-label={isOpen(k) ? tr('접기', 'Collapse') : tr('펼치기', 'Expand')}><IconChevron /></button>
              <span className="cv-ic"><IconFolder /></span>
              <span className="cv-label">{g.name}</span>
              {held.length > 0 && <span className="cv-holders oa-stack" title={tr(`잡고 있는 ${assistant()}`, 'Held by')}>{held.map((o) => { const x = orchs.find((y) => y.id === o); return <OrchAvatar key={o} name={x?.name || ''} size={16} state={avatarState(x, x && statusOf(x))} color={colorOf(x?.name || '')} label={x ? label(x) : o} />; })}</span>}
              {busy && <StateMark st={statusOf(busy)} />}
              <Ctx v={g.sessions.map((x) => ctxOf?.(x)).filter((x): x is number => x !== undefined).reduce<number | undefined>((m, x) => (m === undefined || x > m ? x : m), undefined)} />
            </div>
            {isOpen(k) && (
              <div className="cv-kids">
                <FileTree root={g.root} selected={selectedFile} onOpen={onOpenFile} />
              </div>
            )}
          </div>
        );
      })}
      {idle.length > 0 && <div className="cv-sec click" onClick={() => flipSec('idle')}><span className="with-ic">{secFold('idle')}{tr('쉬는 프로젝트', 'Idle projects')}</span><span className="cv-count">{idle.length}</span></div>}
      {secOpen('idle') && idle.map((p) => (
        <div {...rowKeys} key={p.root} className={`cv-row top off ${pick === `p:${p.root}` ? 'on' : ''}`} onClick={() => onPick(`p:${p.root}`)} title={p.root}>
          <span className="cv-fold small blank" />
          <span className="cv-ic"><IconFolder /></span>
          <span className="cv-label">{p.name}</span>
        </div>
      ))}
    </nav>
  );
}
