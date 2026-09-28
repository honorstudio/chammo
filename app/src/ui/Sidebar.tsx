import type { RefObject } from 'react';
import { searchProjects } from '../domain/search';
import { ctxLevel } from '../domain/ctx';
import { sessionMarks, statusKind, urgentKind, type StatusKind } from '../domain/statusMark';
import type { RoutineState } from '../domain/routine';
import { IconDb } from './Icons';
import { StatusMark } from './StatusMark';
import { assistant, tr } from '../i18n';
import type { ProjectGroup, Session, SessionState } from '../domain/session';

export type Selection = { kind: 'orchestrator' } | { kind: 'all' } | { kind: 'tama' } | { kind: 'replay' } | { kind: 'load' } | { kind: 'review'; key?: string } | { kind: 'project'; name: string } | { kind: 'routine'; name: string };

type Props = {
  /** 루틴(반복 업무) 줄 — 이름·상태·한 줄 설명 */
  routines?: { name: string; state: RoutineState; line: string }[];
  orchestrator: Session | undefined;
  projects: ProjectGroup[];
  selected: Selection;
  onSelect: (s: Selection) => void;
  footer?: string;
  /** 프로젝트 이름 → 문서 상태 배지 (CLAUDE.md·starter) */
  badges: Record<string, string[]>;
  /** 세션이 없는 프로젝트 — 눌러서 새 세션을 띄울 수 있다 */
  idleProjects: string[];
  query: string;
  onQuery: (q: string) => void;
  /** 세션의 컨텍스트 사용 % (모르면 undefined) */
  ctxOf?: (s: Session) => number | undefined;
  /** 다마고치 메뉴 아래 줄 (예: '망치곰 · 성장기') */
  searchRef: RefObject<HTMLInputElement | null>;
  /** 리뷰: 사람이 볼 PR 수(머지 전에 볼 것) · 열린 PR 전체. 없으면 리뷰 기능이 꺼진 것 — 입구를 숨긴다 */
  review?: { confirm: number; open: number };
  /** 프로젝트 폴더 밖 폴더를 프로젝트로 추가(폴더 고르기 창). 없으면 버튼을 숨긴다 */
  onAddProject?: () => void;
};

const STATE_LABEL = (): Record<SessionState, string> => ({ working: tr('작업 중', 'Working'), blocked: tr('확인창', 'Prompt'), idle: tr('대기', 'Idle') });

const Badges = ({ list }: { list?: string[] }) =>
  list && list.length ? <div className="badges">{list.join(' · ')}</div> : null;

/** 대화 사용량 — 60% 넘으면 노랑, 80% 넘으면 빨강 */
const Ctx = ({ v }: { v?: number }) =>
  v === undefined ? null : (
    <span className={`ctx ${ctxLevel(v)}`} title={tr('컨텍스트(대화 메모리) 사용량 — 80% 넘으면 곧 요약된다', 'Context (conversation memory) used — over 80% means it will be compacted soon')}>
      <IconDb />{v}%
    </span>
  );

/** 세션 여럿인 프로젝트: 세션마다 표시 하나(급한 것부터), 넷 넘으면 +N */
function SessionMarks({ states }: { states: SessionState[] }) {
  const { marks, more } = sessionMarks(states);
  return (
    <span className="dots">
      {marks.map((k, i) => <StatusMark key={i} kind={k} small />)}
      {more > 0 && <span className="dots-more" title={tr(`세션 ${more}개 더`, `${more} more sessions`)}>+{more}</span>}
    </span>
  );
}

const isOn = (a: Selection, b: Selection) =>
  a.kind === b.kind && (a.kind !== 'project' || b.kind !== 'project' || a.name === b.name);

export function Sidebar({ routines, orchestrator, projects: allProjects, selected, onSelect, footer, badges, idleProjects: allIdle, query, onQuery, searchRef, ctxOf, review, onAddProject }: Props) {
  // 프로젝트에 세션이 여럿이면 가장 많이 찬 것 — 곧 요약될 세션을 놓치지 않게
  const ctxMax = (ss: Session[]) => ss.map((s) => ctxOf?.(s)).filter((x): x is number => x !== undefined).reduce<number | undefined>((m, x) => (m === undefined || x > m ? x : m), undefined);
  const running = allProjects.reduce((n, p) => n + p.sessions.length, 0);
  // 검색: 세션 있는 것과 없는 것을 같은 기준으로 거른다
  const liveNames = searchProjects(query, allProjects.map((p) => p.name));
  const projects = liveNames.map((n) => allProjects.find((p) => p.name === n)!);
  const idleProjects = searchProjects(query, allIdle);
  const first = liveNames[0] ?? idleProjects[0];
  return (
    <aside className="side">
      <div className="panel-head">{tr('세션', 'Sessions')} <span className="dim">⌘B</span></div>
      <div className="search">
        <input
          ref={searchRef}
          value={query}
          placeholder={tr('프로젝트 검색  ⌘K', 'Search projects  ⌘K')}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && first) {
              onSelect({ kind: 'project', name: first });
              onQuery('');
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              onQuery('');
              e.currentTarget.blur();
            }
          }}
        />
      </div>
      <div className="grp">{tr('오케스트레이터', 'Orchestrator')}</div>
      <button className={`it ${isOn(selected, { kind: 'orchestrator' }) ? 'on' : ''}`} onClick={() => onSelect({ kind: 'orchestrator' })}>
        <StatusMark kind={statusKind(orchestrator?.state)} />
        <span>
          <div className="nm">{assistant()}</div>
          <div className="ln">{orchestrator ? STATE_LABEL()[orchestrator.state] : tr('세션 없음', 'No session')}<Ctx v={orchestrator ? ctxOf?.(orchestrator) : undefined} /></div>
        </span>
      </button>
      <button className={`it ${isOn(selected, { kind: 'all' }) ? 'on' : ''}`} onClick={() => onSelect({ kind: 'all' })}>
        <span className="st" style={{ background: 'transparent', border: '1.5px solid #a3a3a3' }} />
        <span>
          <div className="nm">{tr('전체 보기', 'All')}</div>
          <div className="ln">{tr(`돌고 있는 창 ${running}개`, `${running} running`)}</div>
        </span>
      </button>
      {review && <button className={`it ${isOn(selected, { kind: 'review' }) ? 'on' : ''}`} onClick={() => onSelect({ kind: 'review' })}>
        <span className="st" style={{ background: review?.confirm ? 'var(--accent)' : 'transparent', border: review?.confirm ? 0 : '1.5px solid #a3a3a3' }} />
        <span>
          <div className="nm">{tr('리뷰', 'Review')}</div>
          <div className="ln">{tr(`머지 전에 볼 것 ${review.confirm} · 열린 PR ${review.open}`, `To check ${review.confirm} · Open PRs ${review.open}`)}</div>
        </span>
      </button>}

      {routines && routines.length > 0 && (
        <>
          <div className="grp">{tr(`루틴 · ${routines.length}`, `Routines · ${routines.length}`)}</div>
          {routines.map((r) => (
            <button key={r.name} className={`it ${isOn(selected, { kind: 'routine', name: r.name }) ? 'on' : ''}`} onClick={() => onSelect({ kind: 'routine', name: r.name })}>
              {/* 도는 중 = 도는 호, 실패·보고 없음 = 손바닥(네가 볼 차례), 성공 = 꽉 찬 원, 꺼 둠·첫 실행 전 = 빈 원 */}
              <StatusMark kind={ROUTINE_MARK[r.state]} />
              <span>
                <div className="nm">{r.name}</div>
                <div className="ln">{r.line}</div>
              </span>
            </button>
          ))}
        </>
      )}

      <div className="grp grp-act">
        {tr(`프로젝트 · 세션 ${running}개`, `Projects · ${running} sessions`)}
        {onAddProject && <button type="button" className="grp-btn" title={tr('프로젝트 폴더 밖 폴더를 프로젝트로 추가', 'Add a folder outside the projects folder as a project')} onClick={onAddProject}>{tr('폴더 추가', 'Add folder')}</button>}
      </div>
      <div className="list">
        {projects.map((p) => (
          <button
            key={p.name}
            className={`it ${isOn(selected, { kind: 'project', name: p.name }) ? 'on' : ''}`}
            onClick={() => onSelect({ kind: 'project', name: p.name })}
          >
            {/* 왼쪽은 가장 급한 세션 것 — 첫 세션만 보면 뒤에서 기다리는 손바닥을 놓친다 */}
            <StatusMark kind={urgentKind(p.sessions.map((s) => s.state))} />
            <span>
              <div className="nm">
                {p.name}
                {p.sessions.length > 1 && <SessionMarks states={p.sessions.map((s) => s.state)} />}
              </div>
              <div className="ln">{describe(p.sessions)}<Ctx v={ctxMax(p.sessions)} /></div>
              <Badges list={badges[p.name]} />
            </span>
          </button>
        ))}
        {projects.length === 0 && <div className="ln" style={{ padding: '4px 18px' }}>{tr('돌고 있는 세션이 없어', 'No running sessions')}</div>}
        {idleProjects.length > 0 && <div className="grp">{tr('세션 없음', 'No session')} · {idleProjects.length}</div>}
        {idleProjects.map((name) => (
          <button
            key={name}
            className={`it off ${isOn(selected, { kind: 'project', name }) ? 'on' : ''}`}
            onClick={() => onSelect({ kind: 'project', name })}
          >
            <StatusMark kind="none" />
            <span>
              <div className="nm">{name}</div>
              <Badges list={badges[name]} />
            </span>
          </button>
        ))}
      </div>
      {/* 설정 버튼은 맨 위 줄로 옮겼다 — 사이드바를 닫으면(⌘B) 못 찾았다 */}
      {footer && <div className="sidefoot"><div>{footer}</div></div>}
    </aside>
  );
}

const ROUTINE_MARK: Record<RoutineState, StatusKind> = { running: 'working', failed: 'waiting', noReport: 'waiting', ok: 'idle', paused: 'none', waiting: 'none' };

function describe(sessions: Session[]): string {
  if (sessions.length === 1) {
    const s = sessions[0]!;
    return `${STATE_LABEL()[s.state]} · ${s.workspace ?? s.name}`;
  }
  const working = sessions.filter((s) => s.state === 'working').length;
  return tr(`창 ${sessions.length} · 작업 중 ${working}`, `${sessions.length} panes · ${working} working`);
}
