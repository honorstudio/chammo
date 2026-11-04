// 보관함 '모든 프로젝트' 목록과 프로젝트 화면 — 모르는 사람도 쓰는 쉬운 화면(2026-11-01 사용자 시안 projects-friendly B + A 표지).
// 목록 = 내가 볼 차례(그 자리에서 답 — 결정 대기함과 같은 줄) / 일하는 중(오늘 진행 막대) / 쉬는 중(표지), 프로젝트 0개면 큰 입력칸.
// 화면 = 사람 말 이름 · 한 일 이야기 · 맨 아래 '다음에 시킬 일'. 읽기는 열 때 한 번(폴링 없음), 표지는 보이는 줄만 읽는다
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { tr } from '../../i18n';
import type { DotKind } from '../../domain/dot';
import { cardLook } from '../../domain/locker';
import { coverTone, isFirstRun, projectBuckets, projectTitle } from '../../domain/projectsFriendly';
import { projectBlurb, projectDone, type Commit } from '../../domain/projectsView';
import { docUrl } from '../../domain/reader';
import type { TaskEvent } from '../../domain/tasks';
import { IconButton } from '../kit/IconButton';
import { IconChat, IconClose, IconFolder, IconMore, IconPlus, IconReveal, IconSend } from '../Icons';
import { useOrchActions } from '../orchActions';
import { useQlThumb } from './DashboardView';
import { FolderTile, PathCrumbs } from './FolderTile';
import type { ChipProject } from './LockerPage';
import './projects.css';

/** 프로젝트에 떠 있는 세션 한 줄 */
export type ProjSess = { id: string; name: string; dot: DotKind; line: string };
/** 결정 카드 한 장 — 결정 대기함 물음·직접 답하기 카드(홈 대시보드와 같은 줄을 그대로 그린다) */
export type ProjAsk = { key: string; node: ReactNode };
/** 목록·화면이 쓰는 앱 쪽 재료(SpaceView 가 채운다) */
export type ProjectsKit = {
  /** 뺀 프로젝트 뿌리(절대 경로) */
  hidden: string[];
  onHide: (root: string, hide: boolean) => void;
  /** 새 프로젝트 — 만든 뿌리 또는 실패 글 */
  onNew?: (name: string, summary: string) => Promise<{ root?: string; error?: string }>;
  /** 마지막 움직임(ms, 0 = 모름) */
  at: (p: ChipProject) => number;
  sessionsOf: (root: string) => ProjSess[];
  events: TaskEvent[];
  /** 그 프로젝트 결정 카드 */
  asksOf: (p: ChipProject) => ProjAsk[];
  /** 표지 파일 — 그 폴더에서 마지막으로 보여 준 그림·문서 */
  coverOf: (root: string) => string | undefined;
  /** 오늘 맡긴 일 중 끝난 수 */
  progressOf: (p: ChipProject) => { done: number; total: number };
  /** 다음에 시킬 일 — 그 프로젝트 세션(없으면 참모)에 */
  say?: (p: ChipProject, text: string) => Promise<void>;
  /** 처음 쓰는 사람 — 참모에게 새 프로젝트로 */
  sayNew?: (text: string) => Promise<void>;
};

const readText = (path: string) => invoke<string>('read_doc_text', { path }).then((s) => s ?? '', () => '');
// 목록 줄 설명 — 열 때마다 80번 읽지 않게 한 번 읽은 건 기억(프로젝트 화면을 열면 새로 읽어 바꾼다)
const blurbs = new Map<string, Promise<string>>();
const blurbOf = (root: string) => {
  if (!blurbs.has(root)) blurbs.set(root, (async () => {
    const s = projectBlurb(await readText(`${root}/docs/starter.md`), '', '');
    if (s) return s;
    const c = projectBlurb('', await readText(`${root}/CLAUDE.md`), '');
    return c || projectBlurb('', '', await readText(`${root}/README.md`));
  })());
  return blurbs.get(root)!;
};

/** 오늘 · 어제 · 10월 31일 */
const dayWord = (ms: number) => {
  const d = new Date(ms);
  const y = new Date();
  if (d.toDateString() === y.toDateString()) return tr('오늘', 'Today');
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return tr('어제', 'Yesterday');
  return d.toLocaleDateString(tr('ko-KR', 'en-US'), { month: 'short', day: 'numeric' });
};

/** 화면에 들어왔나 — 80개 목록에서 표지를 한꺼번에 읽지 않게 */
function useSeen<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}

/** 표지 — 그림은 그대로, PDF·슬라이드·HTML 은 맥이 그린 첫 장(보관함 카드와 같은 길), 없으면 이름 색 + 첫 글자 */
function Cover({ name, title, path, size = 'm', mark }: { name: string; title: string; path?: string; size?: 's' | 'm' | 'l'; mark?: DotKind }) {
  const [ref, seen] = useSeen<HTMLSpanElement>();
  const [broken, setBroken] = useState(false);
  const look = path ? cardLook(path).look : 'doc';
  const png = useQlThumb(path ?? '', seen && look === 'shot');
  const src = !path || !seen || broken ? null : look === 'image' ? docUrl(path) : look === 'shot' && png ? docUrl(png) : null;
  return (
    <span ref={ref} className={`pf-cover pf-${size} pf-t${coverTone(name)}`} aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} onError={() => setBroken(true)} /> : <b>{[...title][0] ?? ''}</b>}
      {mark === 'run' && <i className="pf-mark"><span className="cv-spin" /></i>}
      {mark === 'ask' && <i className="pf-mark"><span className="cv-ask" /></i>}
    </span>
  );
}

/** 오늘 진행 — 맡긴 일 칸마다 한 칸(8칸까지), 끝난 만큼 차고 다음 칸은 반쯤 */
function Progress({ done, total }: { done: number; total: number }) {
  if (total <= 0) return null;
  const n = Math.min(total, 8);
  const on = Math.round((done / total) * n);
  const label = tr(`오늘 맡긴 일 ${total}개 중 ${done}개 끝남`, `${done} of ${total} tasks from today are done`);
  return (
    <span className="pf-prog" role="img" aria-label={label} title={label}>
      {Array.from({ length: n }, (_, i) => <i key={i} className={i < on ? 'on' : i === on ? 'cur' : ''} />)}
    </span>
  );
}

/** 입력칸 + 보내기 — 엔터로 보냄(한글 조합 중엔 안 보냄, 줄바꿈은 시프트+엔터). 실패하면 친 글은 남기고 까닭 */
function Composer({ value, onChange, onSend, placeholder, big }: { value: string; onChange: (v: string) => void; onSend?: (t: string) => Promise<void>; placeholder: string; big?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const go = async () => {
    const t = value.trim();
    if (!t || busy || !onSend) return;
    setBusy(true);
    setNote('');
    try {
      await onSend(t);
      onChange('');
      setNote(tr('보냈어요', 'Sent'));
    } catch (e: unknown) {
      const why = e instanceof Error ? e.message : String(e);
      setNote(tr(`보내지 못했어요. ${why}`, `Couldn't send. ${why}`));
    } finally {
      setBusy(false);
    }
  };
  const key = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void go(); }
  };
  return (
    <div className={`pf-comp${big ? ' big' : ''}`}>
      <textarea value={value} rows={big ? 3 : 2} placeholder={placeholder} aria-label={placeholder} disabled={!onSend}
        onChange={(e) => { onChange(e.target.value); if (note) setNote(''); }} onKeyDown={key} />
      <div className="pf-comp-row">
        <span className="pf-note" role="status">{note}</span>
        <IconButton tone="pri" label={tr('보내기', 'Send')} onClick={() => void go()} busy={busy} disabled={!value.trim() || !onSend}><IconSend /></IconButton>
      </div>
    </div>
  );
}

/** 처음 쓰는 사람(프로젝트 0개) — 큰 입력칸 하나 + 예시 셋. 보내면 참모가 새 프로젝트로 만든다 */
function FirstRun({ kit, onAddProject }: { kit: ProjectsKit; onAddProject?: () => void }) {
  const [text, setText] = useState('');
  const ex = [tr('동네 가게 전단지 만들기', 'Make a flyer for a local shop'), tr('손님 예약표 정리하기', 'Organize a customer booking sheet'), tr('올해 영수증 모아 정리하기', "Gather and sort this year's receipts")];
  return (
    <div className="pf-first">
      {onAddProject && <div className="pf-first-top"><IconButton tone="line" label={tr('내 컴퓨터의 폴더 가져오기', 'Bring in a folder from my computer')} onClick={onAddProject}><IconFolder /></IconButton></div>}
      <h2>{tr('무엇을 만들고 싶으세요?', 'What would you like to make?')}</h2>
      <Composer big value={text} onChange={setText} onSend={kit.sayNew} placeholder={tr('만들고 싶은 것을 편하게 적어 주세요', "Describe what you'd like to make")} />
      <div className="pf-ex">{ex.map((e) => <button key={e} className="pf-chip" onClick={() => setText(e)}>{e}</button>)}</div>
    </div>
  );
}

/** 보관함 본문 — 모든 프로젝트 목록 */
export function ProjectList({ all, kit, onPick, onAddProject, onReveal, onBig }: { all: ChipProject[]; kit: ProjectsKit; onPick: (root: string) => void; onAddProject?: () => void; onReveal?: (path: string) => void; onBig?: (session: string) => void }) {
  const act = useOrchActions();
  const [q, setQ] = useState('');
  const [making, setMaking] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [desc, setDesc] = useState<Record<string, string>>({});
  // 스페이스는 몇 초마다 다시 그려 all 이 매번 새 배열이다 — 뿌리 목록이 바뀔 때만 다시 훑는다
  const roots = all.map((p) => p.root).join('\n');
  useEffect(() => {
    let alive = true;
    for (const r of roots.split('\n').filter(Boolean)) void blurbOf(r).then((s) => { if (alive && s) setDesc((d) => (d[r] === s ? d : { ...d, [r]: s })); });
    return () => { alive = false; };
  }, [roots]);
  // 쉬는 줄의 마지막 한 일 — 작업 기록이 바뀌거나 목록이 바뀔 때만 다시 센다
  const last = useMemo(() => new Map(all.map((p) => [p.root, projectDone(kit.events, [], [p.name], 1)[0]])), [kit.events, roots]); // eslint-disable-line react-hooks/exhaustive-deps
  if (isFirstRun(all)) return <FirstRun kit={kit} onAddProject={onAddProject} />;
  const titleOf = (p: ChipProject) => projectTitle(desc[p.root] ?? '', p.name);
  const word = q.trim().toLowerCase();
  const hit = all.filter((p) => !word || p.name.toLowerCase().includes(word) || (desc[p.root] ?? '').toLowerCase().includes(word));
  const asks = new Map(hit.map((p) => [p.root, kit.asksOf(p)]));
  const b = projectBuckets(hit.map((p) => ({ ...p, at: kit.at(p) })), new Set(hit.filter((p) => asks.get(p.root)!.length > 0).map((p) => p.root)), kit.hidden);
  const hiddenSet = new Set(kit.hidden);
  const rowMenu = (p: ChipProject) => (e: React.MouseEvent) => {
    if (!act) return;
    e.preventDefault();
    const out = hiddenSet.has(p.root);
    act.openMenu(e, [
      ...(onReveal ? [{ label: tr('폴더에서 보기', 'Show in folder'), run: () => onReveal(p.root) }] : []),
      { label: out ? tr('목록에 되돌리기', 'Put back in the list') : tr('목록에서 빼기', 'Remove from the list'), danger: !out, run: () => kit.onHide(p.root, !out) },
    ]);
  };
  const addMenu = (e: React.MouseEvent) => {
    if (!act || !onAddProject) { setMaking(true); return; }
    act.openMenu(e, [
      { label: tr('있는 폴더 고르기…', 'Choose an existing folder…'), run: onAddProject },
      ...(kit.onNew ? [{ label: tr('새 프로젝트 만들기…', 'New project…'), run: () => setMaking(true) }] : []),
    ]);
  };
  const liveLine = (p: ChipProject) => kit.sessionsOf(p.root).find((s) => s.dot === p.dot && s.line)?.line ?? '';
  const restLine = (p: ChipProject) => { const d = last.get(p.root); return d ? `${dayWord(d.ts)} · ${d.text}` : desc[p.root] ?? ''; };
  const row = (p: ChipProject, line: string, extra?: ReactNode) => (
    <button key={p.root} className="pf-row" onClick={() => onPick(p.root)} onContextMenu={rowMenu(p)} title={p.root}>
      <Cover name={p.name} title={titleOf(p)} path={kit.coverOf(p.root)} mark={p.dot} />
      <span className="pf-tx"><b>{titleOf(p)}</b>{line && <span className="pf-line">{line}</span>}{extra}</span>
    </button>
  );
  return (
    <div className="pv-list">
      <div className="pv-bar">
        <input className="lk-pop-find pv-find" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('프로젝트 찾기', 'Find a project')} aria-label={tr('프로젝트 찾기', 'Find a project')} />
        {(onAddProject || kit.onNew) && <IconButton tone="pri" label={tr('프로젝트 더하기', 'Add a project')} onClick={addMenu}><IconPlus /></IconButton>}
      </div>
      {making && kit.onNew && <NewProject onNew={kit.onNew} onDone={(root) => { setMaking(false); if (root) onPick(root); }} />}
      {b.turn.length > 0 && (
        <section className="pv-group">
          <div className="lk-sub">{tr('내가 볼 차례', 'Your turn')} {b.turn.length}</div>
          {b.turn.map((p) => (
            <div key={p.root} className="pf-turn">
              <button className="pf-turn-head" onClick={() => onPick(p.root)} onContextMenu={rowMenu(p)} title={p.root}>
                <Cover name={p.name} title={titleOf(p)} path={kit.coverOf(p.root)} size="s" /><b>{titleOf(p)}</b>
              </button>
              {asks.get(p.root)!.length > 0 ? asks.get(p.root)!.map((a) => <div key={a.key} className="pf-ask">{a.node}</div>) : (
                <div className="pf-stuck">
                  <span>{liveLine(p) || tr('고르기를 기다리며 멈췄어요. 여기서는 답할 수 없어요', "Waiting for your choice. You can't answer from here")}</span>
                  {p.session && onBig && <button className="cv-btn" onClick={() => onBig(p.session!)}>{tr('열어서 답하기', 'Open and reply')}</button>}
                </div>
              )}
            </div>
          ))}
        </section>
      )}
      {b.working.length > 0 && (
        <section className="pv-group">
          <div className="lk-sub">{tr('일하는 중', 'Working')}</div>
          {b.working.map((p) => row(p, liveLine(p) || p.what || '', <Progress {...kit.progressOf(p)} />))}
        </section>
      )}
      {b.resting.length > 0 && (
        <section className="pv-group">
          <div className="lk-sub">{tr('쉬는 중', 'Resting')}</div>
          {b.resting.map((p) => row(p, restLine(p)))}
        </section>
      )}
      {b.hidden.length > 0 && (
        <button className="pv-more" aria-expanded={showHidden} onClick={() => setShowHidden((v) => !v)}>{tr(`뺀 것 ${b.hidden.length}`, `Removed ${b.hidden.length}`)}</button>
      )}
      {showHidden && <section className="pv-group">{b.hidden.map((p) => row(p, restLine(p)))}</section>}
      {hit.length === 0 && <div className="lk-menu-note">{tr('없어요', 'Nothing')}</div>}
    </div>
  );
}

/** 새 프로젝트 — 이름(영문 소문자)과 한 줄 설명. 참모와 같은 길(scripts/new-project) */
function NewProject({ onNew, onDone }: { onNew: NonNullable<ProjectsKit['onNew']>; onDone: (root?: string) => void }) {
  const [name, setName] = useState('');
  const [sum, setSum] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr('');
    void onNew(name.trim(), sum.trim()).then((r) => { setBusy(false); if (r.error) setErr(r.error); else onDone(r.root); });
  };
  return (
    <form className="pv-new" onSubmit={(e) => { e.preventDefault(); go(); }}>
      <input className="lk-pop-find" autoFocus value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder={tr('이름 (shop-landing)', 'Name (shop-landing)')} aria-label={tr('프로젝트 이름', 'Project name')} />
      <input className="lk-pop-find pv-sum" value={sum} onChange={(e) => setSum(e.target.value)} placeholder={tr('한 줄 설명', 'One-line summary')} aria-label={tr('한 줄 설명', 'One-line summary')} />
      <button type="submit" className="cv-btn" disabled={!name.trim() || busy}>{tr('만들기', 'Create')}</button>
      <IconButton label={tr('닫기', 'Close')} onClick={() => onDone()}><IconClose /></IconButton>
      {err && <div className="pv-err">{err}</div>}
    </form>
  );
}

type Ent = { name: string; path: string; dir: boolean; mtime?: number };
const STORY = 6;

/** 프로젝트 화면 — 보관함 칩·목록 줄을 누르면 주고받은 파일 위에 */
export function ProjectPanel({ p, kit, onBig, onReveal, fileTile, list }: {
  p: ChipProject;
  kit: ProjectsKit;
  /** 세션 탭으로 크게 */
  onBig?: (session: string) => void;
  onReveal?: (path: string) => void;
  /** 보관함 머리 보기 단추가 목록이면 파일을 줄로 */
  list?: boolean;
  /** 파일 한 장(보관함 카드·줄과 같은 모양) */
  fileTile: (path: string, name: string, ms?: number) => ReactNode;
}) {
  const act = useOrchActions();
  const [docs, setDocs] = useState({ starter: '', claude: '', readme: '' });
  const [commits, setCommits] = useState<Commit[]>([]);
  const [sub, setSub] = useState('');
  const [ents, setEnts] = useState<Ent[]>([]);
  const [allDone, setAllDone] = useState(false);
  const [files, setFiles] = useState(false);
  const [draft, setDraft] = useState('');
  useEffect(() => {
    let alive = true;
    setSub('');
    setAllDone(false);
    setFiles(false);
    setDraft('');
    void Promise.all([readText(`${p.root}/docs/starter.md`), readText(`${p.root}/CLAUDE.md`), readText(`${p.root}/README.md`)]).then(([starter, claude, readme]) => {
      if (!alive) return;
      setDocs({ starter, claude, readme });
      blurbs.set(p.root, Promise.resolve(projectBlurb(starter, claude, readme)));
    });
    void invoke<Commit[]>('project_log', { dir: p.root }).then((c) => { if (alive) setCommits(c ?? []); }, () => {});
    return () => { alive = false; };
  }, [p.root]);
  const here = sub ? `${p.root}/${sub}` : p.root;
  useEffect(() => {
    if (!files) return;
    let alive = true;
    void invoke<Ent[]>('list_dir', { dir: here }).then((v) => { if (alive) setEnts(v ?? []); }, () => { if (alive) setEnts([]); });
    return () => { alive = false; };
  }, [here, files]);
  const blurb = projectBlurb(docs.starter, docs.claude, docs.readme) || p.what || '';
  const title = projectTitle(blurb, p.name);
  const sess = kit.sessionsOf(p.root);
  const done = useMemo(() => projectDone(kit.events, commits, [p.name, ...sess.map((s) => s.name)], allDone ? 20 : STORY), [kit.events, commits, p.name, sess.map((s) => s.name).join(','), allDone]); // eslint-disable-line react-hooks/exhaustive-deps
  const story = [...done].reverse();
  const asks = kit.asksOf(p);
  const nowLine = sess.find((s) => s.dot === 'run' && s.line)?.line ?? (p.dot === 'run' ? p.what ?? '' : '');
  const out = kit.hidden.includes(p.root);
  const more = (e: React.MouseEvent) => act?.openMenu(e, [
    { label: out ? tr('목록에 되돌리기', 'Put back in the list') : tr('목록에서 빼기', 'Remove from the list'), danger: !out, run: () => kit.onHide(p.root, !out) },
  ]);
  const crumbs = sub.split('/').filter(Boolean).map((n, i, a) => ({ key: a.slice(0, i + 1).join('/'), name: n }));
  const dirs = ents.filter((e) => e.dir);
  const fs = ents.filter((e) => !e.dir);
  return (
    <div className="pv-panel">
      <div className="pf-head" title={p.root}>
        <Cover name={p.name} title={title} path={kit.coverOf(p.root)} size="l" mark={p.dot} />
        <div className="pf-head-tx">
          <h2>{title}</h2>
          {blurb && !blurb.startsWith(title) && <p className="pv-blurb">{blurb}</p>}
        </div>
        {p.session && onBig && <IconButton tone="line" label={tr('대화 크게 열기', 'Open conversation')} onClick={() => onBig(p.session!)}><IconChat /></IconButton>}
        {onReveal && <IconButton tone="line" label={tr('폴더 열기', 'Open folder')} onClick={() => onReveal(p.root)}><IconReveal /></IconButton>}
        {act && <IconButton tone="line" label={tr('더 보기', 'More')} onClick={more}><IconMore /></IconButton>}
      </div>
      {asks.length > 0 && <div className="pf-turn">{asks.map((a) => <div key={a.key} className="pf-ask">{a.node}</div>)}</div>}
      <section className="pf-story">
        {!allDone && done.length >= STORY && <button className="pv-more" onClick={() => setAllDone(true)}>{tr('이전 일 더 보기', 'Show earlier')}</button>}
        {story.map((d) => <div key={`${d.ts}-${d.text}`} className="pf-ev"><em>{dayWord(d.ts)}</em><span>{d.text}</span></div>)}
        {nowLine && <div className="pf-ev now"><em>{tr('지금', 'Now')}</em><b>{nowLine}</b></div>}
        {story.length === 0 && !nowLine && <div className="lk-menu-note">{tr('아직 한 일이 없어요', 'Nothing done here yet')}</div>}
      </section>
      <Composer value={draft} onChange={setDraft} onSend={kit.say ? (t) => kit.say!(p, t) : undefined} placeholder={tr('다음에 시킬 일을 적어 주세요', 'Write what to do next')} />
      <button className="pv-more" aria-expanded={files} onClick={() => setFiles((v) => !v)}>{files ? tr('파일 접기', 'Hide files') : tr('파일 보기', 'Show files')}</button>
      {files && (
        <section className="pv-sec">
          {sub && <PathCrumbs root={p.name} crumbs={crumbs} onGo={(k) => setSub(k)} dropOf={() => ({})} />}
          {dirs.length > 0 && <div className="lk-fgrid">{dirs.map((e) => <FolderTile key={e.path} name={e.name} title={e.path} onOpen={() => setSub(sub ? `${sub}/${e.name}` : e.name)} />)}</div>}
          {fs.length > 0 && <div className={list ? 'lk-list' : 'lk-grid pv-files'}>{fs.map((e) => <div key={e.path}>{fileTile(e.path, e.name, e.mtime)}</div>)}</div>}
          {ents.length === 0 && <div className="lk-menu-note">{tr('비어 있어요', 'Empty')}</div>}
        </section>
      )}
    </div>
  );
}
