import { useState } from 'react';
import type { Session } from '../../domain/session';
import type { StoppedSession } from '../../domain/stopped';
import { docTitle } from '../../domain/spaceTree';
import { assistant, tr } from '../../i18n';
import { IconChevron, IconTerminal, IconFolder, IconPage, IconPerson, IconPin, IconPlus } from '../Icons';
import { FileTree } from './FileTree';
import { Ctx } from '../Sidebar';
import { dragPath, dragProps } from './dragPath';
import { OrchName, useOrchActions } from '../orchActions';
import { IconClose } from '../Icons';
import { orchBadge } from '../../domain/orchLabel';
import { orchLabel } from '../orchLabels';
import { keyLabel } from '../../domain/keys';
import { IS_WIN } from '../../domain/reader';
import type { RoutineState } from '../../domain/routine';

export type ProjectGroup = { name: string; root: string; sessions: Session[] };

/** 펼친 칸 기억 — 이 컴퓨터에만(막혀 있으면 이번 실행만) */
const OPEN_KEY = 'spaceOpen';
const loadOpen = (): string[] | null => { try { const v = localStorage.getItem(OPEN_KEY); return v ? (JSON.parse(v) as string[]) : null; } catch { return null; } };
const saveOpen = (v: string[]) => { try { localStorage.setItem(OPEN_KEY, JSON.stringify(v)); } catch { /* 이번 실행만 */ } };

const stateCls = (s: Session) => (s.state === 'working' ? 'run' : s.state === 'blocked' || s.awaiting ? 'ask' : 'idle');
export const stateWord = (s: Session) => (s.state === 'working' ? tr('일하는 중', 'Working') : s.state === 'blocked' ? tr('기다림', 'Waiting') : s.awaiting ? tr('물어봄', 'Asking') : tr('쉼', 'Idle'));

/** 상태는 글자 대신 표시 하나 — 일하면 도는 고리, 물으면 노란 점, 쉬면 없음(글자는 올리면 보인다) */
export function StateMark({ s }: { s: Session }) {
  const c = stateCls(s);
  return c === 'run' ? <span className="cv-spin" title={stateWord(s)} /> : c === 'ask' ? <span className="cv-ask" title={stateWord(s)} /> : null;
}

/**
 * 채팅 뷰 메뉴(⌘B) — v10: 오케스트레이터(참모마다 대시보드 + 문서) → 내 페이지 → 프로젝트(대시보드 + 문서).
 * 참모 문서 = 고정한 것 + 이번에 띄운 md(최근 먼저). 펼치고 접기는 기억한다
 */
export function SpaceNav({ onNewOrch, routines = [], helpers = [], loose = [], pagesRoot = '', onChatTab, ctxOf, onAddProject, idle = [], offOrchs = [], onResume, onRemoveStopped, orchs, viewId, colorOf, projects, holders, pick, onPick, orchDocsOf, isPinned, onTogglePin, pages, pageTitle, onNewPage, onOpenFile, selectedFile, onTrashPage }: {
  /** 내 페이지 지우기 — 휴지통으로(하위 페이지 같이) */
  onTrashPage?: (path: string) => void;
  /** 세션이 안 떠 있는 프로젝트 — 흐리게, 누르면 그 프로젝트 대시보드 */
  idle?: { name: string; root: string }[];
  /** 꺼진 참모 — 흐리게, 이어서 켜기 */
  offOrchs?: StoppedSession[];
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
  colorOf: (id: string) => string;
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
  routines?: { name: string; state: RoutineState; line: string; cloud?: boolean }[];
  /** 내 페이지 폴더 — 하위 페이지 들여쓰기 기준 */
  pagesRoot?: string;
  pageTitle: (path: string) => string;
  onNewPage: () => void;
  /** 프로젝트 파일 나무에서 누른 파일 — md 는 문서, 그 밖은 미리보기 */
  onOpenFile: (path: string) => void;
  selectedFile?: string;
}) {
  const act = useOrchActions();
  const label = (o: Session) => act?.nameOf(o) ?? (o.name || tr('참모', 'Assistant'));
  const [open, setOpenState] = useState<string[]>(() => loadOpen() ?? (viewId ? [`o:${viewId}`] : []));
  const isOpen = (k: string) => open.includes(k);
  // 카테고리 접기(오케스트레이터·내 페이지·프로젝트·쉬는 프로젝트) — 기억, 쉬는 프로젝트는 처음엔 접힘(2026-09-30 사용자)
  const [closed, setClosed] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('spaceSecClosed') ?? '["idle"]') as string[]; } catch { return ['idle']; } });
  const secOpen = (k: string) => !closed.includes(k);
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
    <div key={path} {...dragPath(path)} className={`cv-row child ${pick === `d:${path}` ? 'on' : ''}`} onClick={() => onPick(`d:${path}`, owner?.id)} title={path}
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
      <div className="cv-sec click" onClick={() => flipSec('orch')}><span className="with-ic">{secFold('orch')}{tr('오케스트레이터', 'Orchestrators')}</span>
        <span className="with-ic"><kbd>{keyLabel('⌘B', IS_WIN)}</kbd>
          {onNewOrch && <button className="cv-act show" onClick={(e) => { e.stopPropagation(); onNewOrch(); }} title={tr(`${assistant()} 하나 더 (⌘T)`, `One more ${assistant()} (⌘T)`)} aria-label={tr(`${assistant()} 하나 더`, `One more ${assistant()}`)}><IconPlus /></button>}</span></div>
      {secOpen('orch') && orchs.map((o) => {
        const k = `o:${o.id}`;
        const docs = orchDocsOf(o);
        return (
          <div key={o.id} className="cv-group">
            <div className={`cv-row top ${pick === k ? 'on' : ''} ${viewId === o.id ? 'viewing' : ''}`} onClick={() => { onPick(k, o.id); onChatTab?.(o.id); }} title={`${label(o)} · ${stateWord(o)} — ${tr('두 번 눌러 이름 바꾸기 · 오른쪽 클릭 메뉴', 'double-click to rename · right-click for menu')}`}
              onDoubleClick={(e) => { e.stopPropagation(); act?.askRename(o); }} onContextMenu={act ? (e) => act.menu(e, o) : undefined}
              {...dragProps({ kind: 'text', text: `[참모 ${label(o)} · 세션 ${o.id}]` }, label(o))}>
              <button className={`cv-fold ${isOpen(k) ? 'open' : ''}`} onClick={(e) => { e.stopPropagation(); toggle(k); }} aria-label={isOpen(k) ? tr('접기', 'Collapse') : tr('펼치기', 'Expand')}><IconChevron /></button>
              <span className="cv-avatar" style={{ background: colorOf(o.id) }}>{orchBadge(o.name || '')}</span>
              <OrchName s={o} className="cv-label strong" />
              <StateMark s={o} />
              <Ctx v={ctxOf?.(o)} />
              {act && o.kind === 'background' && <button className="cv-act" onClick={(e) => { e.stopPropagation(); act.askStop(o); }} title={tr('세션 끄기', 'Stop session')} aria-label={tr('세션 끄기', 'Stop session')}><IconClose /></button>}
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
      })}

      {secOpen('orch') && offOrchs.slice(0, 6).map((x) => { const nm = orchLabel(x.id) ?? x.name; return (
        <div key={x.id} className="cv-row top off" title={`${orchLabel(x.id) ?? x.name} — ${tr('꺼짐 · 오른쪽 클릭: 켜기·지우기', 'stopped · right-click: resume·remove')}`}
          onContextMenu={act ? (e) => act.openMenu(e, [
            ...(onResume ? [{ label: tr('이어서 켜기', 'Resume'), run: () => onResume(x) }] : []),
            { label: tr('목록에서 지우기', 'Remove from list'), danger: true, run: () => act.confirm({ title: tr(`${x.name} 지울까?`, `Remove ${x.name}?`), body: tr('꺼진 세션 목록에서 빼 — 같은 이름으로 쌓인 옛 기록도 같이(대화 기록 파일은 남아).', 'Removes it from stopped sessions, with older ones under the same name (transcript files stay).'), ok: tr('지우기', 'Remove'), run: () => onRemoveStopped?.(x) }) },
          ]) : undefined}>
          <span className="cv-fold small blank" />
          <span className="cv-avatar off">{orchBadge(nm)}</span>
          <span className="cv-label">{nm}</span>
          {onResume && <button className="cv-act show" onClick={() => onResume(x)} title={tr('이어서 켜기', 'Resume')}>{tr('켜기', 'On')}</button>}
        </div>
      ); })}

      {helpers.length > 0 && <div className="cv-sec click" onClick={() => flipSec('helpers')}><span className="with-ic">{secFold('helpers')}{tr('도우미', 'Helpers')}</span><span className="cv-count">{helpers.length}</span></div>}
      {secOpen('helpers') && helpers.map((h) => (
        <div key={h.id} className={`cv-row top ${pick === `s:${h.id}` ? 'on' : ''}`} onClick={() => onPick(`s:${h.id}`)} title={`${h.name} · ${stateWord(h)} — ${tr('오른쪽 클릭: 끄기·지우기', 'right-click: stop·remove')}`}
          onContextMenu={act ? (e) => act.menu(e, h) : undefined}>
          <span className="cv-fold small blank" />
          <span className="cv-ic"><IconTerminal /></span>
          <span className="cv-label">{h.name}</span>
          <StateMark s={h} />
          <Ctx v={ctxOf?.(h)} />
        </div>
      ))}

      {loose.length > 0 && <div className="cv-sec click" onClick={() => flipSec('loose')} title={tr('프로젝트 폴더가 아니라 dev 폴더 자체에서 연 세션', 'Sessions opened in the projects folder itself, not in a project')}><span className="with-ic">{secFold('loose')}{tr('프로젝트 밖', 'Outside projects')}</span><span className="cv-count">{loose.length}</span></div>}
      {secOpen('loose') && loose.map((h) => (
        <div key={h.id} className={`cv-row top ${pick === `s:${h.id}` ? 'on' : ''}`} onClick={() => onPick(`s:${h.id}`)} title={`${h.name || h.id} · ${stateWord(h)}`}
          onContextMenu={act ? (e) => act.menu(e, h) : undefined}>
          <span className="cv-fold small blank" />
          <span className="cv-ic"><IconTerminal /></span>
          <span className="cv-label">{h.name || h.id}</span>
          <StateMark s={h} />
          <Ctx v={ctxOf?.(h)} />
        </div>
      ))}

      {routines.length > 0 && <div className="cv-sec click" onClick={() => flipSec('routines')}><span className="with-ic">{secFold('routines')}{tr('루틴', 'Routines')}</span><span className="cv-count">{routines.length}</span></div>}
      {secOpen('routines') && routines.map((r) => (
        <div key={r.name} className={`cv-row top ${pick === `r:${r.name}` ? 'on' : ''}`} onClick={() => onPick(`r:${r.name}`)} title={r.cloud ? `${r.line} · ${tr('클라우드', 'Cloud')}` : r.line}>
          <span className="cv-fold small blank" />
          <span className="cv-label">{r.name}</span>
          {/* 도는 중 = 도는 호, 실패·보고 없음 = 볼 차례 표시, 나머지는 표시 없음(사이드바와 같은 뜻) */}
          {r.state === 'running' ? <span className="cv-spin" title={r.line} /> : r.state === 'failed' || r.state === 'noReport' ? <span className="cv-ask" title={r.line} /> : null}
        </div>
      ))}

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
        const busy = g.sessions.find((s) => stateCls(s) === 'run') ?? g.sessions.find((s) => stateCls(s) === 'ask');
        return (
          <div key={g.root} className="cv-group">
            <div className={`cv-row top ${pick === k ? 'on' : ''}`} onClick={() => onPick(k)}
              {...dragProps({ kind: 'text', text: `[프로젝트 ${g.name} · ${g.root} · 세션 ${g.sessions.map((x) => `${x.workspace ?? x.project}(${x.id})`).join(', ')}]` }, g.name)} title={g.root}>
              <button className={`cv-fold ${isOpen(k) ? 'open' : ''}`} onClick={(e) => { e.stopPropagation(); toggle(k); }} aria-label={isOpen(k) ? tr('접기', 'Collapse') : tr('펼치기', 'Expand')}><IconChevron /></button>
              <span className="cv-ic"><IconFolder /></span>
              <span className="cv-label">{g.name}</span>
              {held.length > 0 && <span className="cv-holders" title={tr('잡고 있는 참모', 'Held by')}>{held.map((o) => { const x = orchs.find((y) => y.id === o); return <i key={o} style={{ background: colorOf(o) }} title={x ? label(x) : o}>{orchBadge(x?.name || '')}</i>; })}</span>}
              {busy && <StateMark s={busy} />}
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
        <div key={p.root} className={`cv-row top off ${pick === `p:${p.root}` ? 'on' : ''}`} onClick={() => onPick(`p:${p.root}`)} title={p.root}>
          <span className="cv-fold small blank" />
          <span className="cv-ic"><IconFolder /></span>
          <span className="cv-label">{p.name}</span>
        </div>
      ))}
    </nav>
  );
}
