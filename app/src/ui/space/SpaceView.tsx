import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { appendTaskEvent, readSessionTasks, readShowLog, readTranscriptTails, sendTextToSession } from '../../data/tauri';
import { dashFiles, type DashFile } from '../../domain/dashboard';
import { findTarget } from '../../domain/inbox';
import { kindOf } from '../../domain/reader';
import { isOrchestratorName, type Session } from '../../domain/session';
import { holderMap, newShows, orphanSends, shownFiles } from '../../domain/spaceNav';
import { orchDocs, projectGroups } from '../../domain/spaceTree';
import { termTail } from '../../domain/termTail';
import { starterLists } from '../../domain/starterLists';
import type { TaskEvent } from '../../domain/tasks';
import type { StoppedSession } from '../../domain/stopped';
import { tr } from '../../i18n';
import { TerminalPane } from '../TerminalPane';
import { DashboardView, type DashLine, type DashLists, type LiveLine } from './DashboardView';
import { DocPage } from './DocPage';
import type { ShowAt } from '../../domain/showAt';
import { PagesHome } from './PagesHome';
import { CurationMode } from './CurationMode';
import { OPEN_PAGE, PAGE_TITLE } from './PageBlock';
import { Preview } from './Preview';
import { dragPath } from './dragPath';
import { attachToChat } from '../fileDrop';
import { SpaceNav, StateMark, stateWord } from './SpaceNav';
import { useChatItems } from './useChatItems';
import { OrchName, useOrchActions } from '../orchActions';
import { NotePanel } from './NotePanel';
import type { NoteBase } from '../../domain/noteEdits';
import { projectRoot } from '../../domain/spaceTree';
import './space.css';
import { attachCommand } from '../../domain/termCommand';

/** 참모마다 색 — 메뉴 아바타, 프로젝트 옆 "잡고 있는 참모" 점(2026-09-30 사용자) */
export const ORCH_COLORS = ['#d9622b', '#2f74e0', '#1f9a62', '#9b51e0', '#c98a00', '#d23f6b'];
const nameOf = (s: Session) => (s.workspace ? `${s.project} / ${s.workspace}` : s.project);

// 참모 문서 고정 — 참모 이름 기준(세션이 바뀌어도 남는다, v10 R1)
const PIN_KEY = 'spacePins';
const loadPins = (): Record<string, string[]> => { try { return JSON.parse(localStorage.getItem(PIN_KEY) ?? '{}') as Record<string, string[]>; } catch { return {}; } };
// 내 페이지 제목(첫 줄 # 제목) — 파일 이름보다 이게 메뉴에 보인다
const TITLE_KEY = 'spacePageTitles';
const loadTitles = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(TITLE_KEY) ?? '{}') as Record<string, string>; } catch { return {}; } };

/**
 * 채팅 뷰의 스페이스(큰 창 전체) — v10: 왼쪽 메뉴 트리(참모·프로젝트마다 대시보드 + 문서, 내 페이지),
 * 가운데 = 고른 것(대시보드 / 노션식 문서 / 세션 터미널). 참모·맡긴 세션이 띄운 파일은 위에 모달
 */
export function SpaceView({ orchs, orch: chatOrch, projectSessions, sessions, events, claudeBin, fontSize, home, send, sendTo, live = {}, menuOpen = true, idle = [], stopped = [], orchCwd = '', onResume, onRemoveStopped, onNewSession, onNewOrch, ctxOf, onAddProject, onChatTab, helpers = [] }: {
  /** 세션이 안 떠 있는 프로젝트(예전 사이드바처럼 흐리게) */
  idle?: { name: string; root: string }[];
  /** 꺼진 세션(이어서 켤 수 있는 것) */
  stopped?: StoppedSession[];
  orchCwd?: string;
  onResume?: (s: StoppedSession) => void;
  onRemoveStopped?: (s: StoppedSession) => void;
  ctxOf?: (s: Session) => number | undefined;
  onAddProject?: () => void;
  /** 메뉴에서 참모 이름을 누르면 채팅 탭도 그 참모로(2026-09-30 사용자) */
  onChatTab?: (id: string) => void;
  /** 도우미 세션(프로젝트가 아닌 일 — 이 폴더에서 띄운 것) */
  helpers?: Session[];
  onNewSession?: (root: string, name: string) => void;
  /** 참모 하나 더(⌘T 와 같다) — 채팅 탭 줄·오케스트레이터 칸의 + */
  onNewOrch?: () => void;
  live?: Record<string, LiveLine>;
  orchs: Session[];
  /** 지금 채팅 탭 참모 */
  orch?: Session;
  projectSessions: Session[];
  sessions: Session[];
  events: TaskEvent[];
  claudeBin: string;
  fontSize: number;
  home?: string;
  send: (text: string) => Promise<void>;
  sendTo?: string;
  onClose: () => void;
  onOpenSession: (id: string) => void;
  menuOpen?: boolean;
}) {
  // 메뉴에서 보는 참모 — 채팅 탭을 바꾸면 따라오고, 메뉴에서 고르면 채팅 탭은 그대로(2026-09-30 사용자)
  const [nav, setNav] = useState<{ view?: string; chat?: string }>({ view: chatOrch?.id, chat: chatOrch?.id });
  const [pick, setPickRaw] = useState<string>(() => (chatOrch ? `o:${chatOrch.id}` : ''));
  // 지나온 화면 — 문서의 "뒤로"가 여기로 돌아간다(없으면 주인 대시보드)
  const hist = useRef<string[]>([]);
  const setPick = (k: string) => setPickRaw((cur) => { if (cur && cur !== k) hist.current = [...hist.current.slice(-30), cur]; return k; });
  const back = (fallback: string) => { const prev = hist.current.pop(); setPickRaw(prev ?? fallback); };
  const followed = nav; // 채팅 탭이 바뀌면 아래 switchTo 가 옮긴다
  const orch = orchs.find((o) => o.id === followed.view) ?? chatOrch;
  // 채팅 탭마다 보던 화면을 기억한다 — 탭을 바꾸면 그 참모에서 마지막으로 보던 화면(처음이면 대시보드).
  // 다른 참모가 띄운 파일은 그 참모 탭으로 갈 때 보인다(2026-09-30 사용자 "탭별로 화면이 저장")
  const screens = useRef(new Map<string, { pick: string; modal: DashFile | null; focus?: { path: string; at: ShowAt; key: string } | null }>());
  const now = useRef({ view: followed.view, pick, modal: null as DashFile | null });
  // 탭이 어떻게 바뀌든(누르기·⌘숫자·앱 명령·알림) 떠나는 참모 화면을 적어 두고 가는 참모 화면을 되살린다 — 누를 때만 되살려서
  // 단축키·"그 세션으로 가기"로 바꾸면 대시보드로 갔다(2026-09-30)
  const switchTo = (id: string) => {
    if (!orchs.some((o) => o.id === id)) return;
    if (id === now.current.view) { setNav((n) => (n.chat === id ? n : { ...n, chat: id })); return; }
    if (now.current.view) screens.current.set(now.current.view, { pick: now.current.pick, modal: now.current.modal });
    const sv = screens.current.get(id);
    setNav({ view: id, chat: id });
    setPick(sv?.pick ?? `o:${id}`);
    setModal(sv?.modal ?? null);
    setFocus(sv?.focus ?? null); // 그 탭에 가서야 처음 보는 짚은 곳은 그때 반짝(한 번만 — 떠날 때 기억은 focus 없이)
  };
  useEffect(() => { if (chatOrch?.id && chatOrch.id !== nav.chat) switchTo(chatOrch.id); }, [chatOrch?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = (e: Event) => { const id = (e as CustomEvent<string>).detail; if (id) switchTo(id); };
    window.addEventListener('chat-tab-pick', on);
    return () => window.removeEventListener('chat-tab-pick', on);
  }, [orchs.map((o) => o.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  // 참모를 바꾸는 순간 — 흐림 + 불러오는 중을 먼저 그려 보여 주고(한 프레임), 무거운 대시보드는 그다음에(2026-09-30 사용자
  // "한참 있다가 스플래시"). 바뀐 걸 그리는 중에 알아채야 첫 화면부터 스플래시다
  const [shownOrch, setShownOrch] = useState(orch?.id);
  const [hold, setHold] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  if (orch?.id && orch.id !== shownOrch) {
    setShownOrch(orch.id);
    setHold(true);
    setSwitching(orch.id);
  }
  useEffect(() => {
    if (!hold) return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setHold(false)); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [hold]);
  useEffect(() => {
    if (!switching) return;
    const t = window.setTimeout(() => setSwitching(null), 450);
    return () => window.clearTimeout(t);
  }, [switching]);
  const act = useOrchActions();
  const oname = (o: Session) => act?.nameOf(o) ?? (o.name || tr('참모', 'Assistant'));
  const orchIds = orchs.map((o) => o.id);
  const colorOf = (id: string) => ORCH_COLORS[Math.max(0, orchIds.indexOf(id)) % ORCH_COLORS.length]!;
  const holders = holderMap(events, orchIds, (t) => findTarget(sessions, t)?.id, Date.now());
  const heldBy = (o?: Session) => (o ? projectSessions.filter((s) => holders.get(s.id)?.includes(o.id)) : []);
  const groups = useMemo(() => projectGroups(projectSessions), [projectSessions]);
  const orphans = orphanSends(events, Date.now());

  // scripts/show 기록 — 3초마다 꼬리. 대시보드 파일·참모 문서가 여기서 나온다
  const [log, setLog] = useState('');
  useEffect(() => {
    let alive = true;
    const tick = () => void readShowLog().then((l) => { if (alive) setLog((p) => (p === l ? p : l)); }).catch(() => {});
    tick();
    const id = window.setInterval(tick, 3000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  // 참모 문서 고정
  const [pins, setPins] = useState(loadPins);
  const pinKey = (o: Session) => o.name || o.id;
  const isPinned = (o: Session, p: string) => (pins[pinKey(o)] ?? []).includes(p);
  const togglePin = (o: Session, p: string) => setPins((all) => {
    const cur = all[pinKey(o)] ?? [];
    const next = { ...all, [pinKey(o)]: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] };
    try { localStorage.setItem(PIN_KEY, JSON.stringify(next)); } catch { /* 이번 실행만 */ }
    return next;
  });

  // 내 페이지
  const [pages, setPages] = useState<string[]>([]);
  const [titles, setTitles] = useState(loadTitles);
  const [pagesRoot, setPagesRoot] = useState('');
  const loadPages = () => invoke<string>('pages_dir').then((d) => { setPagesRoot(d); return invoke<string[]>('list_md_deep', { dir: d }); }).then(setPages).catch(() => {});
  useEffect(() => { void loadPages(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const setTitle = (p: string, t: string) => setTitles((all) => {
    if (all[p] === t) return all;
    const next = { ...all, [p]: t };
    try { localStorage.setItem(TITLE_KEY, JSON.stringify(next)); } catch { /* 이번 실행만 */ }
    return next;
  });
  const pageName = (p: string) => titles[p] ?? (p.split('/').pop() ?? p).replace(/\.md$/i, '');
  // 페이지 이름은 첫 줄 # 제목 — 목록을 읽을 때 한 번씩 읽어 둔다(파일 이름이 아니라 제목이 어디서나 보이게)
  useEffect(() => {
    let alive = true;
    void Promise.all(pages.map(async (p) => [p, (await invoke<string>('read_doc_text', { path: p }).catch(() => '')).match(/^#\s+(.+)$/m)?.[1]?.trim()] as const)).then((rows) => {
      if (!alive) return;
      setTitles((all) => { const next = { ...all }; for (const [p, t] of rows) if (t) next[p] = t; try { localStorage.setItem(TITLE_KEY, JSON.stringify(next)); } catch { /* 이번 실행만 */ } return next; });
    });
    return () => { alive = false; };
  }, [pages.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  // 문서 속 하위 페이지 블록을 누르면
  useEffect(() => {
    const on = (e: Event) => { const p = (e as CustomEvent<string>).detail; if (p) openFileRef.current(p); };
    window.addEventListener(OPEN_PAGE, on);
    return () => window.removeEventListener(OPEN_PAGE, on);
  }, []);
  const newPage = () => void invoke<string>('new_page', { title: tr('새 페이지', 'Untitled') }).then((p) => { void loadPages(); setPick(`d:${p}`); }).catch(() => {});


  // 참모(또는 그 참모가 맡긴 세션)가 scripts/show 로 띄우면 스페이스 위에 모달로 — md 면 문서 페이지로 연다
  const [modal, setModal] = useState<DashFile | null>(null);
  // 짚어 보여 주기 — 문서(md)를 열며 반짝일 곳. key 가 바뀌면 다시 반짝
  const [focus, setFocus] = useState<{ path: string; at: ShowAt; key: string } | null>(null);
  const since = useRef(Date.now());
  now.current = { view: followed.view, pick, modal };
  useEffect(() => {
    const fresh = newShows(log, null, since.current); // 채팅 뷰는 리더를 안 쓴다 — 누가 띄웠든 여기서
    if (!fresh.length) return;
    const last = fresh[fresh.length - 1]!;
    since.current = Date.parse(last.ts) || Date.now();
    // 누가 띄웠든 지금 보는 화면에 바로 — 다른 참모 것을 그 참모 탭에 보관만 하니 개발 참모가 띄운 영상이 안 떴다(2026-09-30 사용자 "띄워주면 바로")
    const md = kindOf(last.path) === 'md';
    if (md) { setModal(null); setPick(`d:${last.path}`); setFocus(last.at ? { path: last.path, at: last.at, key: last.ts } : null); } // 떠 있던 미리보기 창에 문서가 가려지지 않게
    else setModal(last);
  }, [log]); // eslint-disable-line react-hooks/exhaustive-deps

  // 참모 대시보드 파일 — 참모·맡긴 세션이 띄운 것 + 사용자가 채팅에 붙인 그림
  const items = useChatItems(orch?.sessionId);
  const myImages = useMemo(() => items.flatMap((it) => (it.kind === 'user' && it.images ? it.images.map((src) => ({ ts: it.ts, src })) : [])), [items]);
  const who = (id: string) => {
    if (id === 'me') return tr('사용자', 'You');
    const o = orchs.find((x) => x.id === id);
    if (o) return oname(o);
    const s = sessions.find((x) => x.id === id);
    return s ? nameOf(s) : id;
  };
  // 대시보드 세션 칸 — 대화 기록 꼬리를 터미널처럼 몇 줄(보고 있는 대시보드의 세션만 3초마다)
  const [tails, setTails] = useState<Record<string, string[]>>({});
  const tailIds = (() => {
    if (pick.startsWith('o:')) { const o = orchs.find((x) => x.id === pick.slice(2)) ?? orch; return o ? [o, ...heldBy(o)] : []; }
    if (pick.startsWith('p:')) return groups.find((x) => x.root === pick.slice(2))?.sessions ?? [];
    return [];
  })().map((s) => s.sessionId).filter((x): x is string => !!x);
  const tailKey = tailIds.join(',');
  useEffect(() => {
    if (!tailKey) return;
    let alive = true;
    const big = pick.startsWith('p:');
    const tick = () => void readTranscriptTails(tailKey.split(',')).then((m) => {
      if (!alive) return;
      setTails((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(m)) next[k] = termTail(v, big ? 40 : 8);
        return next;
      });
    }).catch(() => {});
    tick();
    const id = window.setInterval(tick, 3000);
    return () => { alive = false; window.clearInterval(id); };
  }, [tailKey, pick.slice(0, 2)]); // eslint-disable-line react-hooks/exhaustive-deps
  // 참모 대시보드 노트 — 참모 할 일 목록(TaskCreate) + HQ starter 최근 결정. 보고 있을 때 5초마다(v11 X)
  const [note, setNote] = useState<NoteBase | null>(null);
  const noteOrch = pick.startsWith('o:') ? orchs.find((x) => x.id === pick.slice(2)) ?? orch : undefined;
  const [hasStarter, setHasStarter] = useState(false);
  useEffect(() => {
    setNote(null);
    if (!noteOrch) return;
    let alive = true;
    const tick = async () => {
      const tasks = noteOrch.sessionId ? await readSessionTasks(noteOrch.sessionId).catch(() => []) : [];
      const md = await invoke<string>('read_doc_text', { path: `${projectRoot(noteOrch.cwd)}/docs/starter.md` }).catch(() => '');
      if (alive) setHasStarter(md !== ''); // 공개판 HQ 엔 starter 가 없다 — 없는 문서를 여는 버튼은 숨긴다(0.2.0 검증)
      if (alive) setNote({ tasks: tasks.map((t) => ({ id: t.id, text: t.subject, done: t.status === 'completed' })), decisions: starterLists(md).decisions });
    };
    void tick();
    const id = window.setInterval(() => void tick(), 5000);
    return () => { alive = false; window.clearInterval(id); };
  }, [noteOrch?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 프로젝트 대시보드 위 목록 — 세션 할 일(지금 하는 것 먼저) + starter "다음 할 일"·"최근 결정". 보고 있을 때 5초마다
  const [plists, setPlists] = useState<DashLists | null>(null);
  const proot = pick.startsWith('p:') ? pick.slice(2) : '';
  useEffect(() => {
    setPlists(null);
    if (!proot) return;
    let alive = true;
    const tick = async () => {
      const g = groups.find((x) => x.root === proot);
      const src = `${proot}/docs/starter.md`;
      const md = await invoke<string>('read_doc_text', { path: src }).catch(() => '');
      const fromStarter = starterLists(md);
      const tasks = (await Promise.all((g?.sessions ?? []).filter((x) => x.sessionId).map(async (x) =>
        (await readSessionTasks(x.sessionId!).catch(() => [])).filter((t) => t.status !== 'completed').map((t) => ({ text: t.status === 'in_progress' && t.activeForm ? t.activeForm : t.subject, doing: t.status === 'in_progress', by: x.workspace ?? tr('본체', 'main') }))))).flat();
      tasks.sort((a, b) => Number(b.doing) - Number(a.doing));
      if (alive) setPlists({ todo: [...tasks, ...fromStarter.todo.map((text) => ({ text }))], decisions: fromStarter.decisions, source: md ? src : undefined });
    };
    void tick();
    const id = window.setInterval(() => void tick(), 5000);
    return () => { alive = false; window.clearInterval(id); };
  }, [proot]); // eslint-disable-line react-hooks/exhaustive-deps
  const lineOf = (s: Session, name: string): DashLine => ({ id: s.id, name, status: s.finished ? 'done' : live[s.id]?.status ?? 'wait', line: live[s.id]?.line ?? '', tail: s.sessionId ? tails[s.sessionId] : undefined });

  const cur = pick.startsWith('s:') ? sessions.find((s) => s.id === pick.slice(2)) : undefined;
  const shown = cur ? shownFiles(log, cur.id) : [];
  // 채팅에 붙이기 — 지금 채팅 탭 참모 입력칸에(끌어다 놓기와 같게)
  const attach = (path: string) => {
    if (!chatOrch) return;
    if (!path.startsWith('data:')) { attachToChat(chatOrch.id, [path]); return; }
    // 경로 없는 그림(채팅에 붙인 그림) — 파일로 저장한 뒤 그 경로로 붙인다
    const m = path.match(/^data:image\/(\w+);base64,(.*)$/);
    if (!m) return;
    const bytes = Array.from(Uint8Array.from(atob(m[2]!), (c) => c.charCodeAt(0)));
    void invoke<string>('save_attach', { name: `pasted.${m[1] === 'jpeg' ? 'jpg' : m[1]}`, bytes }).then((p) => attachToChat(chatOrch.id, [p])).catch(() => {});
  };
  // 세션 칸의 진짜 터미널 — 직접 칠 수 있다(대화형 세션은 터미널 뷰에서만)
  const termOf = (id: string) => {
    const s = sessions.find((x) => x.id === id);
    if (!s || s.kind !== 'background') return <div className="cv-blank">{tr('이 세션은 터미널 뷰에서만', 'Terminal view only')}</div>;
    return <TerminalPane key={s.id} command={attachCommand(claudeBin, s.id)} title={nameOf(s)} subtitle={s.name} fontSize={fontSize} linkBase={s.cwd} home={home} />;
  };
  const openFileRef = useRef<(p: string) => void>(() => {});
  const openFile = (path: string, by = '') => (kindOf(path) === 'md' ? setPick(`d:${path}`) : setModal({ path, ts: new Date().toISOString(), by }));

  openFileRef.current = (p) => openFile(p);
  // 시안 검토 모드 — 검토용 시안(큐레이션)이 열리면 모달 대신 스페이스 전체로, 닫으면 보던 화면으로
  const beforeCur = useRef('');
  // 검토 결과는 시안을 띄운 참모에게 — 지금 채팅 탭 참모에게 보내니 개발 참모가 띄운 시안 결과가 다른 참모에게 갔다(2026-09-30 사용자 "버그네")
  const curBy = useRef(new Map<string, string>());
  const toCuration = (p: string, by?: string) => { setModal(null); if (by) curBy.current.set(p, by); if (!pick.startsWith('c:')) beforeCur.current = pick; setPick(`c:${p}`); };
  const curOwner = (p: string) => { const by = curBy.current.get(p) ?? ''; const id = orchs.some((o) => o.id === by) ? by : holders.get(by)?.[0]; return orchs.find((o) => o.id === id); };
  let main: React.ReactNode = null;
  if (pick.startsWith('o:')) {
    const o = orchs.find((x) => x.id === pick.slice(2)) ?? orch;
    const held = heldBy(o);
    const files = o ? dashFiles(log, o.id, held.map((s) => s.id), o.id === orch?.id ? myImages : []).slice(0, 40).map((f) => ({ ...f, byName: who(f.by) })) : [];
    main = o ? (
      <DashboardView key={o.id} title={oname(o)} titleNode={<OrchName s={o} />} color={colorOf(o.id)} onTitleEdit={act ? () => act.askRename(o) : undefined}
        aside={<NotePanel base={note} storeKey={`noteEdits:${o.name || o.id}`} sendTo={oname(o)} onOpenStarter={hasStarter ? () => setPick(`d:${projectRoot(o.cwd)}/docs/starter.md`) : undefined}
          send={async (text) => { window.dispatchEvent(new CustomEvent('chat-pending', { detail: { id: o.id, text } })); await sendTextToSession(o.id, text); }} />}
        meta={tr(`${stateWord(o)} · 맡긴 세션 ${held.length}`, `${stateWord(o)} · ${held.length} delegated`)}
        files={files} lines={held.map((s) => lineOf(s, nameOf(s)))}
        onStop={act ? (id) => { const s = held.find((x) => x.id === id); if (s) act.askStop(s, nameOf(s)); } : undefined}
        hint={orphans.length > 0 && (
          <div className="cv-orphans">
            <div className="cv-orphans-head"><b>{tr(`누가 시켰는지 모르는 일 ${orphans.length}`, `${orphans.length} tasks with no owner`)}</b>
              <span>{tr('기록에 시킨 참모가 안 남은 옛 일이야 — 이 참모 것으로 붙이거나 끝난 걸로 정리해 줘', 'Old tasks with no recorded owner — claim them or mark done')}</span></div>
            {orphans.map((x) => (
              <div key={x.task} className="cv-orphan">
                <b>{x.target}</b><span>{x.title ?? ''}</span><em>{new Date(x.ts).toTimeString().slice(0, 5)}</em>
                <button onClick={() => void appendTaskEvent({ ts: new Date().toISOString(), type: 'own', task: x.task, from: o.id }).catch(() => {})}>{tr(`${o.name || '참모'} 일로`, `Claim for ${o.name || 'assistant'}`)}</button>
                <button onClick={() => void appendTaskEvent({ ts: new Date().toISOString(), type: 'done', task: x.task, note: tr('사용자가 대시보드에서 정리', 'Tidied from dashboard') }).catch(() => {})}>{tr('끝난 걸로', 'Mark done')}</button>
              </div>
            ))}
          </div>
        )}
        onOpenSession={(id) => setPick(id === o.id ? `o:${id}` : `s:${id}`)} onOpenDoc={(p) => setPick(`d:${p}`)} onAttach={attach} onSendText={send} onCuration={toCuration} term={termOf}
        emptyText={tr('아직 없어요 — 참모나 맡긴 세션이 띄워 주면 여기 모여요', 'Nothing yet — shown files gather here')} />
    ) : null;
  } else if (pick.startsWith('p:')) {
    const g = groups.find((x) => x.root === pick.slice(2));
    const files = g ? g.sessions.flatMap((s) => shownFiles(log, s.id).map((f) => ({ ...f, by: s.id, byName: s.workspace ?? s.project }))).sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 40) : [];
    main = g ? (
      <DashboardView key={g.root} work title={g.name} meta={tr(`세션 ${g.sessions.length} · ${g.root}`, `${g.sessions.length} sessions · ${g.root}`)}
        headAction={onNewSession && <button className="cv-btn" onClick={() => onNewSession(g.root, g.name)}>{tr('새 세션', 'New session')}</button>}
        onStop={act ? (id) => { const s = g.sessions.find((x) => x.id === id); if (s) act.askStop(s, s.workspace ? `${g.name} / ${s.workspace}` : tr(`${g.name} 본체`, `${g.name} (main)`)); } /* 세션이 여럿이면 어느 것인지 보이게 */ : undefined}
        files={files} lines={g.sessions.map((s) => lineOf(s, s.workspace ?? tr('본체', 'main')))}
        lists={plists ?? undefined} onOpenSession={(id) => setPick(`s:${id}`)} onOpenDoc={(p) => setPick(`d:${p}`)} onAttach={attach} onSendText={send} onCuration={toCuration} term={termOf} emptyText={tr('이 프로젝트 세션이 보여 준 파일이 여기 모여요', "Files this project's sessions show gather here")} />
    ) : (() => {
      // 세션이 안 떠 있는 프로젝트 — 할 일·결정은 그대로 보고, 꺼진 세션 이어서 켜기·새 세션
      const root = pick.slice(2);
      const name = idle.find((x) => x.root === root)?.name ?? root.split('/').pop() ?? root;
      const off = stopped.filter((x) => projectRoot(x.cwd) === root);
      return (
        <DashboardView key={root} work title={name} meta={tr(`쉬는 중 · ${root}`, `Idle · ${root}`)} files={[]} lines={[]} lists={plists ?? undefined}
          onOpenSession={() => {}} onOpenDoc={(p) => setPick(`d:${p}`)} emptyText=""
          hint={
            <div className="cv-idle">
              <div className="cv-idle-row"><b>{tr('떠 있는 세션이 없어요', 'No running sessions')}</b>
                {onNewSession && <button className="cv-btn solid" onClick={() => onNewSession(root, name)}>{tr('새 세션 열기', 'Start a session')}</button>}</div>
              {off.map((x) => (
                <div key={x.id} className="cv-idle-row off"><span>{x.name || x.project}{x.workspace ? ` / ${x.workspace}` : ''}</span><em>{x.reason === 'failed' ? tr('비정상 종료', 'Crashed') : x.reason === 'done' ? tr('끝남', 'Done') : tr('끔', 'Stopped')}</em>
                  {onResume && <button className="cv-btn" onClick={() => onResume(x)}>{tr('이어서 켜기', 'Resume')}</button>}</div>
              ))}
            </div>
          } />
      );
    })();
  } else if (pick === 'm:') {
    main = <PagesHome pages={pages} titleOf={pageName} onOpen={(p) => setPick(`d:${p}`)} onNew={newPage} />;
  } else if (pick.startsWith('d:')) {
    const path = pick.slice(2);
    const owner = orchs.find((o) => isPinned(o, path) || orchDocs(log, o.id, []).recent.includes(path));
    const g = groups.find((x) => path.startsWith(`${x.root}/`));
    // 뒤로 = 상위(노션처럼): 하위 페이지면 부모 페이지, 내 페이지면 내 페이지 첫 화면, 그 밖은 주인 대시보드(2026-09-30 사용자)
    const parentPage = pages.includes(path) ? `${path.replace(/\/[^/]+$/, '')}.md` : '';
    const upKey = parentPage && pages.includes(parentPage) ? `d:${parentPage}` : pages.includes(path) ? 'm:' : owner ? `o:${owner.id}` : g ? `p:${g.root}` : chatOrch ? `o:${chatOrch.id}` : '';
    const upName = parentPage && pages.includes(parentPage) ? pageName(parentPage) : pages.includes(path) ? tr('내 페이지', 'My pages') : owner ? oname(owner) : g ? g.name : path.split('/').slice(-2, -1)[0] ?? '';
    main = <DocPage key={path} path={path} at={focus?.path === path ? focus.at : undefined} atKey={focus?.path === path ? focus.key : undefined} title={pages.includes(path) ? pageName(path) : undefined} owner={upName} send={send} sendTo={sendTo} onBack={() => setPick(upKey)}
      pinned={owner ? isPinned(owner, path) : undefined} onPin={owner ? () => togglePin(owner, path) : undefined}
      onTitle={(t) => { if (pages.includes(path)) setTitle(path, t); window.dispatchEvent(new CustomEvent(PAGE_TITLE, { detail: { path, title: t } })); }} onAttach={() => attach(path)}
      onOpenPath={(p) => openFile(p)}
      onNewSubpage={pages.includes(path) ? () => invoke<string>('new_page', { title: tr('새 페이지', 'Untitled'), parent: path }).then((p) => { void loadPages(); return p; }) : undefined} />;
  } else if (cur) {
    main = (
      <div className="cv-session">
        <header className="cv-page-head small">
          <div className="cv-titles"><h1>{nameOf(cur)} <StateMark s={cur} /></h1><p>{cur.name} · {stateWord(cur)} · {cur.cwd}</p></div>
        </header>
        {cur.kind === 'background'
          ? <div className="cv-term"><TerminalPane key={cur.id} command={attachCommand(claudeBin, cur.id)} title={nameOf(cur)} subtitle={cur.name} fontSize={fontSize} linkBase={cur.cwd} home={home} /></div>
          : <div className="cv-blank">{tr('이 세션은 터미널 뷰에서만 볼 수 있어요', 'This session can only be viewed in the terminal view')}</div>}
        {shown.length > 0 && (
          <div className="cv-chips"><span>{tr('보여 준 파일', 'Shown files')}</span>
            {shown.map((f) => <button key={f.path} {...dragPath(f.path)} className="cv-chip" onClick={() => openFile(f.path, cur.id)} title={f.path}>{f.path.split('/').pop()}</button>)}</div>
        )}
      </div>
    );
  } else {
    main = <div className="cv-blank">{tr('왼쪽 메뉴에서 골라 줘', 'Pick something from the menu')}</div>;
  }

  return (
    <div className="space cv">
      {menuOpen && (
        <SpaceNav onNewOrch={onNewOrch} onTrashPage={(p) => void invoke('trash_page', { path: p }).then(() => { if (pick === `d:${p}` || pick.startsWith(`d:${p.replace(/\.md$/, '')}/`)) setPick('m:'); loadPages(); }).catch(() => {})} idle={idle} offOrchs={stopped.filter((x, i, all) => x.cwd === orchCwd && isOrchestratorName(x.name) && !orchs.some((o) => o.name === x.name) && all.findIndex((y) => y.cwd === orchCwd && y.name === x.name) === i)} helpers={helpers} onChatTab={onChatTab} ctxOf={ctxOf} onAddProject={onAddProject} onResume={onResume} onRemoveStopped={onRemoveStopped} orchs={orchs} viewId={orch?.id} colorOf={colorOf} projects={groups} holders={holders} pick={pick}
          onPick={(k, orchId) => { setPick(k); if (orchId) setNav((n) => ({ ...n, view: orchId })); }}
          orchDocsOf={(o) => orchDocs(log, o.id, pins[pinKey(o)] ?? [])} isPinned={isPinned} onTogglePin={togglePin}
          pagesRoot={pagesRoot} pages={pages} pageTitle={pageName} onNewPage={newPage}
          onOpenFile={(p) => openFile(p)} selectedFile={pick.startsWith('d:') ? pick.slice(2) : modal?.path} />
      )}
      <main className="cv-main">
        {hold ? null : main}
        {switching && <div className="cv-switch" aria-live="polite"><span className="cv-spin" /><b>{tr(`${oname(orchs.find((x) => x.id === switching) ?? orch!)} 불러오는 중`, `Loading ${switching}`)}</b></div>}
      </main>
      {modal && <Preview f={modal} onClose={() => setModal(null)} onAttach={() => attach(modal.path)} onSendText={send} onCuration={toCuration} />}
      {pick.startsWith('c:') && (() => { const own = curOwner(pick.slice(2)); return <CurationMode key={pick} path={pick.slice(2)} sendTo={own ? oname(own) : sendTo ?? tr('참모', 'Assistant')}
        onSend={own ? async (text) => { window.dispatchEvent(new CustomEvent('chat-pending', { detail: { id: own.id, text } })); await sendTextToSession(own.id, text); } : send} onClose={() => setPick(beforeCur.current || (orch ? `o:${orch.id}` : ''))} />; })()}
    </div>
  );
}
