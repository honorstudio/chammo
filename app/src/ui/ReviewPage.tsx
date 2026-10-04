// 사이드바 '리뷰' — 왼쪽 PR 목록, 오른쪽 한 건(요약 3줄·걸린 조건·파일 묶음·CI·diff 접기·머지/수정 요청/나중에).
// 오늘 머지된 건 되돌리기(revert PR 만들기만). 시안 docs/design-drafts/review-merge A안
import { IconRefresh } from './Icons';
import { useEffect, useRef, useState } from 'react';
import { openTarget, prDiff } from '../data/tauri';
import { ciState, FILE_KIND_LABEL, GATE_LABEL, groupFiles, type CiState, type OpenPr } from '../domain/review';
import { parseDiff, type DiffFile, type MergedPr } from '../domain/reviewSource';
import { pickSession, sessionOf, splitOpen, summarize, type Reviewed } from '../domain/reviewSummary';
import type { Session } from '../domain/session';
import type { StoppedSession } from '../domain/stopped';
import type { TaskEvent } from '../domain/tasks';
import type { ReviewData } from './useReview';
import { assistant, tr } from '../i18n';

export const ago = (iso: string, now: number) => {
  const m = Math.floor((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(m)) return '';
  if (m < 1) return tr('방금', 'just now');
  if (m < 60) return tr(`${m}분 전`, `${m}m ago`);
  if (m < 24 * 60) return tr(`${Math.floor(m / 60)}시간 전`, `${Math.floor(m / 60)}h ago`);
  return tr(`${Math.floor(m / 1440)}일 전`, `${Math.floor(m / 1440)}d ago`);
};
export const hm = (iso: string) => new Date(iso).toLocaleTimeString(tr('ko-KR', 'en-US'), { hour: '2-digit', minute: '2-digit' });
const n = (x: number) => x.toLocaleString('en-US');
const CI_LABEL = (): Record<CiState, string> => ({ pass: tr('CI 통과', 'CI passed'), fail: tr('CI 실패', 'CI failed'), running: tr('CI 도는 중', 'CI running'), none: tr('CI 없음', 'No CI') });

type Filter = 'confirm' | 'rest' | 'later' | 'old' | 'merged';
const FILTERS: Filter[] = ['confirm', 'rest', 'later', 'old', 'merged'];
const FILTER_LABEL = (): Record<Filter, string> => ({
  confirm: tr('직접 확인', 'For you'), rest: tr('그 외 열림', 'Other open'), later: tr('나중에', 'Later'), old: tr('오래 열림', 'Stale'), merged: tr('오늘 넣은 것', 'Merged today'),
});

type Props = {
  data: ReviewData;
  sessions: Session[];
  stopped: StoppedSession[];
  taskEvents: TaskEvent[];
  selectedKey?: string;
  onSelectKey: (key: string) => void;
  onOpenSession: (id: string) => void;
};

export function ReviewPage({ data, sessions, stopped, taskEvents, selectedKey, onSelectKey, onOpenSession }: Props) {
  const now = Date.now();
  const split = splitOpen(data.open, data.later, now);
  const groups: Record<Filter, (Reviewed | MergedPr)[]> = { ...split, merged: data.merged };
  const [filter, setFilter] = useState<Filter>('confirm');
  // 목록 바깥(작업 패널)에서 고른 PR 이면 그 칸으로
  useEffect(() => {
    const f = (Object.keys(groups) as Filter[]).find((k) => groups[k].some((x) => x.key === selectedKey));
    if (f) setFilter(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);
  const list = groups[filter];
  const cur = [...data.open, ...data.merged].find((x) => x.key === selectedKey) ?? list[0];

  const projectOf = (t: string) => sessions.find((s) => s.id === t || s.name === t)?.project ?? stopped.find((s) => s.name === t)?.project;
  return (
    <div className="rv">
      <div className="rv-list">
        <div className="rv-head">
          <b>{tr('리뷰', 'Review')}</b>
          <span className="dim">{data.busy ? tr('읽는 중…', 'Reading…') : data.scannedAt ? tr(`${ago(new Date(data.scannedAt).toISOString(), now)} 읽음 · ${((data.tookMs ?? 0) / 1000).toFixed(1)}초`, `Read ${ago(new Date(data.scannedAt).toISOString(), now)} · ${((data.tookMs ?? 0) / 1000).toFixed(1)}s`) : ''}</span>
          <button className={`btn sm rv-refresh ${data.busy ? 'spinning' : ''}`} onClick={data.refresh} disabled={data.busy} aria-label={tr('새로고침', 'Refresh')} title={tr('새로고침 — GitHub 에서 다시 읽기', 'Refresh — read GitHub again')}><IconRefresh /></button>
        </div>
        {data.error && <div className="rv-err">{tr('GitHub 읽기 실패', 'Failed to read GitHub')} — {data.error}</div>}
        <div className="rv-chips">
          {FILTERS.map((k) => (
            <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{FILTER_LABEL()[k]} {groups[k].length}</button>
          ))}
        </div>
        <div className="rv-rows">
          {list.length === 0 && <div className="tempty">{filter === 'confirm' ? tr('직접 볼 PR 이 없어', 'No PRs for you to check') : tr('없어', 'None')}</div>}
          {list.map((x) => (
            <button key={x.key} className={`rv-row ${cur?.key === x.key ? 'on' : ''}`} onClick={() => onSelectKey(x.key)}>
              <span className="rv-l1"><b>{x.folder}</b> #{x.number}<span className="grow" />{'mergedAt' in x ? hm(x.mergedAt) : ago(x.updatedAt, now)}</span>
              <span className="rv-ti">{x.title}</span>
              {'gates' in x && (
                <span className="rv-l3">
                  <Ci state={ciState(x.checks)} />
                  <span className="num"><span className="plus">+{n(x.additions)}</span> <span className="minus">−{n(x.deletions)}</span></span>
                  {x.gates.map((g) => <span key={g.kind} className={`gate ${g.kind}`}>{GATE_LABEL[g.kind]}</span>)}
                </span>
              )}
              {'mergedAt' in x && data.reverts[x.key] && <span className="rv-l3">{tr(`revert PR #${data.reverts[x.key]!.number} 만듦`, `Opened revert PR #${data.reverts[x.key]!.number}`)}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="rv-detail">
        {!cur && <div className="empty"><b>{tr('고를 PR 이 없어', 'No PR to pick')}</b></div>}
        {cur && 'gates' in cur && (
          <OpenDetail key={cur.key} pr={cur} data={data} now={now} onOpenSession={onOpenSession}
            session={pickSession(sessionOf(cur.folder, cur.number, taskEvents, projectOf), cur.folder, sessions)}
            named={sessionOf(cur.folder, cur.number, taskEvents, projectOf)} />
        )}
        {cur && 'mergedAt' in cur && <MergedDetail key={cur.key} m={cur} data={data} />}
      </div>
    </div>
  );
}

const Ci = ({ state }: { state: CiState }) => <span className={`ci ${state}`}>{CI_LABEL()[state]}</span>;

/** 되돌리기 어려운 버튼은 두 번 누르기 — 첫 번째는 3초 동안 '한 번 더' 로 바뀐다(메모 삭제와 같은 방식) */
function useArm(): [boolean, () => boolean] {
  const [armed, setArmed] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hit = () => {
    if (armed) { clearTimeout(t.current); setArmed(false); return true; }
    setArmed(true);
    t.current = setTimeout(() => setArmed(false), 3000);
    return false;
  };
  return [armed, hit];
}

function OpenDetail({ pr, data, now, session, named, onOpenSession }: { pr: Reviewed; data: ReviewData; now: number; session?: Session; named?: string; onOpenSession: (id: string) => void }) {
  const sum = summarize(pr, pr.gates);
  const ci = ciState(pr.checks);
  const [armed, arm] = useArm();
  const [msg, setMsg] = useState<string | null>(null);
  const [doing, setDoing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState('');
  const act = async (label: string, f: () => Promise<unknown>) => {
    setDoing(true);
    setMsg(tr(`${label} 중…`, `${label}…`));
    try { await f(); setMsg(tr(`${label} 끝`, `${label}: done`)); } catch (e: unknown) { setMsg(tr(`${label} 실패 — ${String(e)}`, `${label} failed — ${String(e)}`)); } finally { setDoing(false); }
  };
  const blocked = session?.state === 'blocked' ? tr('세션이 확인창·선택지에 멈춰 있어 — 먼저 그 창을 봐줘', 'The session is stuck on a prompt or choice — check that first') : null;
  return (
    <div className="rv-body">
      <div className="dim rv-meta">
        {pr.folder} #{pr.number} · {pr.head} → {pr.base} · {tr('세션', 'Session')} {session ? <button className="linkish" onClick={() => onOpenSession(session.id)}>{session.name || session.project}</button> : named ? tr(`${named}(꺼짐)`, `${named} (stopped)`) : tr('모름', 'unknown')} · {tr(`${ago(pr.createdAt, now)} 만듦`, `opened ${ago(pr.createdAt, now)}`)}
      </div>
      <h2 className="rv-title">{pr.title}</h2>
      <div className="rv-line">
        <Ci state={ci} />
        <span className="num"><span className="plus">+{n(pr.additions)}</span> <span className="minus">−{n(pr.deletions)}</span> · {tr('파일', 'files')} {pr.files.length}</span>
        {pr.draft && <span className="gate">{tr('초안', 'Draft')}</span>}
        {pr.mergeable === 'CONFLICTING' && <span className="gate money">{tr('충돌 있음', 'Conflicts')}</span>}
      </div>

      <div className="rv-sum">
        <SumLine k={tr('무엇', 'What')} v={sum.what} />
        <SumLine k={tr('운영에 닿는 것', 'Touches production')} v={sum.ops} />
        <SumLine k={tr('확인 못 한 것', 'Not verified')} v={sum.unverified} warn />
      </div>

      <div className="rv-gates">
        {pr.gates.length ? pr.gates.map((g) => <span key={g.kind} className={`gate ${g.kind}`}>{GATE_LABEL[g.kind]} — {g.why}</span>) : <span className="dim">{tr(`걸린 조건 없음 — ${assistant()}가 넣어도 되는 PR`, `No conditions hit — ${assistant()} can merge this`)}</span>}
      </div>

      <div className="rv-cols">
        <div>
          <div className="rv-h">{tr('바뀐 파일', 'Changed files')} {pr.files.length}</div>
          <div className="rv-files">
            {groupFiles(pr.files).map((g) => (
              <details key={g.kind} open={g.kind === 'code' || g.kind === 'db'}>
                <summary><b>{FILE_KIND_LABEL[g.kind]} {g.files.length}</b><span className="grow" /><span className="plus">+{n(g.additions)}</span> <span className="minus">−{n(g.deletions)}</span></summary>
                {g.files.map((f) => <div key={f.path} className="rv-file"><span className="p">{f.path}</span><span className="plus">+{f.additions}</span> <span className="minus">−{f.deletions}</span></div>)}
              </details>
            ))}
          </div>
        </div>
        <div>
          <div className="rv-h">{tr('CI · 검사', 'CI · checks')}</div>
          <div className="rv-checks">
            {pr.checks.length === 0 && <span className="dim">{tr('검사 기록 없음', 'No checks')}</span>}
            {pr.checks.map((c, i) => (
              <button key={i} className={`rv-check ${c.state}`} onClick={() => c.url && void openTarget('url', c.url)}>{c.state === 'pass' ? tr('통과', 'Passed') : c.state === 'fail' ? tr('실패', 'Failed') : c.state === 'skip' ? tr('건너뜀', 'Skipped') : tr('도는 중', 'Running')} · {c.name}</button>
            ))}
          </div>
        </div>
      </div>

      <Diff pr={pr} />

      <div className="rv-actions">
        <button className="btn pri" disabled={doing} onClick={() => { if (arm()) void act(tr('머지', 'Merge'), () => data.merge(pr)); }}>{armed ? tr('한 번 더 누르면 머지', 'Click again to merge') : tr('머지', 'Merge')}</button>
        <button className="btn" disabled={doing || !session} title={session ? undefined : tr('보낼 세션이 없어 — 꺼진 세션이면 먼저 이어서 띄워줘', 'No session to send to — if it stopped, resume it first')} onClick={() => setAsking((a) => !a)}>
          {tr('수정 요청', 'Request changes')}{session ? ` — ${session.name || session.project}` : ''}
        </button>
        <button className="btn ghost" onClick={() => { data.postpone(pr); setMsg(tr('나중에 — 새 커밋이 오면 다시 올라와', 'Later — it comes back when there is a new commit')); }}>{tr('나중에', 'Later')}</button>
        <span className="grow" />
        <button className="linkish" onClick={() => void openTarget('url', pr.url)}>{tr('GitHub에서 열기', 'Open on GitHub')}</button>
      </div>
      {asking && session && (
        <div className="rv-ask">
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={tr(`${session.name || session.project} 에 보낼 말 — 앞에 "${pr.folder} #${pr.number} 수정 요청:" 이 붙는다`, `Message to ${session.name || session.project} — prefixed with "${pr.folder} #${pr.number} change request:"`)} />
          <div className="rv-actions">
            <button className="btn pri" disabled={!text.trim() || doing || !!blocked} onClick={() => void act(tr('보내기', 'Send'), () => data.requestFix(pr, session.id, session.name || session.project, text.trim())).then(() => { setText(''); setAsking(false); })}>{tr('보내기', 'Send')}</button>
            <span className="dim">{blocked ?? tr('보내면 작업 패널에 시킨 일로 남는다', 'Sending logs it as a task in the task panel')}</span>
          </div>
        </div>
      )}
      {msg && <div className="rv-msg">{msg}</div>}
    </div>
  );
}

const SumLine = ({ k, v, warn }: { k: string; v: string; warn?: boolean }) => (
  <div className={`rv-sl ${warn && v ? 'warn' : ''}`}><span className="k">{k}</span><span className={v ? '' : 'dim'}>{v || tr('본문에 없음', 'Not in description')}</span></div>
);

/** diff 는 PR 을 고를 때 한 번 읽고, 파일마다 접어 둔다(큰 PR 도 펼친 파일만 그린다) */
function Diff({ pr }: { pr: OpenPr }) {
  const [files, setFiles] = useState<DiffFile[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openSet, setOpenSet] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    prDiff(pr.repo, pr.number).then((d) => alive && setFiles(parseDiff(d))).catch((e: unknown) => alive && setErr(String(e)));
    return () => { alive = false; };
  }, [pr.repo, pr.number, pr.updatedAt]);
  const toggle = (p: string) => setOpenSet((s) => { const x = new Set(s); if (x.has(p)) x.delete(p); else x.add(p); return x; });
  return (
    <div>
      <div className="rv-h">diff {files ? tr(`· 파일 ${files.length}`, `· ${files.length} files`) : ''}</div>
      {err && <div className="rv-err">{tr('diff 읽기 실패', 'Failed to read diff')} — {err}</div>}
      {!files && !err && <div className="dim">{tr('읽는 중…', 'Reading…')}</div>}
      {files?.map((f) => (
        <div key={f.path} className="rv-diff">
          <button className="rv-dh" onClick={() => toggle(f.path)}>{openSet.has(f.path) ? tr('접기', 'Hide') : tr('펼치기', 'Show')} · <b>{f.path}</b></button>
          {openSet.has(f.path) && (
            <pre>{f.lines.map((l, i) => <span key={i} className={l.startsWith('@@') ? 'h' : l.startsWith('+') ? 'a' : l.startsWith('-') ? 'd' : ''}>{l || ' '}</span>)}{f.cut > 0 && <span className="h">{tr(`… ${f.cut}줄 더 — GitHub에서`, `… ${f.cut} more lines — see GitHub`)}</span>}</pre>
          )}
        </div>
      ))}
    </div>
  );
}

function MergedDetail({ m, data }: { m: MergedPr; data: ReviewData }) {
  const [armed, arm] = useArm();
  const [msg, setMsg] = useState<string | null>(null);
  const made = data.reverts[m.key];
  return (
    <div className="rv-body">
      <div className="dim rv-meta">{m.folder} #{m.number} · {tr(`${hm(m.mergedAt)} 머지됨`, `merged ${hm(m.mergedAt)}`)}</div>
      <h2 className="rv-title">{m.title}</h2>
      <div className="rv-sum"><SumLine k={tr('되돌리기', 'Revert')} v={tr('revert PR 을 만들기만 한다 — 머지는 안 한다. 만든 PR 은 목록에 올라오니 보고 넣어줘', 'Only opens a revert PR — it does not merge. The new PR shows up in the list; check it and merge')} /></div>
      <div className="rv-actions">
        {made ? (
          <button className="btn" onClick={() => void openTarget('url', made.url)}>{tr(`revert PR #${made.number} 열기`, `Open revert PR #${made.number}`)}</button>
        ) : (
          <button className="btn" onClick={() => { if (arm()) { setMsg(tr('revert PR 만드는 중…', 'Opening revert PR…')); data.revert(m).then((r) => setMsg(tr(`revert PR #${r.number} 만들었어 — 확인하고 머지해줘`, `Opened revert PR #${r.number} — check it and merge`)), (e: unknown) => setMsg(tr(`되돌리기 실패 — ${String(e)}`, `Revert failed — ${String(e)}`))); } }}>{armed ? tr('한 번 더 누르면 revert PR 만들기', 'Click again to open a revert PR') : tr('되돌리기', 'Revert')}</button>
        )}
        <span className="grow" />
        <button className="linkish" onClick={() => void openTarget('url', m.url)}>{tr('GitHub에서 열기', 'Open on GitHub')}</button>
      </div>
      {msg && <div className="rv-msg">{msg}</div>}
    </div>
  );
}
