import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { draftStore } from '../../domain/chatDraft';
import { isCompacting } from '../../domain/compacting';
import { ctxLevel } from '../../domain/ctx';
import { invoke } from '@tauri-apps/api/core';
import { ModelChip, type ModelInfo } from './ModelChip';
import type { PickResult, PickWant } from './modelPickRun';
import { builtinSlash, completeSlash, matchSlash, slashQuery, type SlashItem } from '../../domain/slash';
import { appendChat, chatBusy, mdSafe, parseChat, pendingLeft, clickFocusesInput, promptInput, splitPaths, splitRefs, stillPending, stuckInInput, taskCounts, termRest, withRefs, type ChatItem, type ChatRef } from '../../domain/chat';
import { openTarget, readSessionTasks, readTranscript, type SessionTask } from '../../data/tauri';
import { modKey } from '../../domain/keys';
import { docUrl, IS_WIN } from '../../domain/reader';
import { DROP_PATHS_EVENT } from '../fileDrop';
import { tr } from '../../i18n';
import { IconChevron, IconFile, IconSend, IconStop } from '../Icons';
import { CHAT_INSERT, PATH_MIME } from '../space/dragPath';
import { attachToChat } from '../fileDrop';
import './chat.css';

const POLL_MS = 1000;
/** 한 번에 그리는 항목 수 — 긴 대화는 "앞 대화 더 보기"로 늘린다 */
const PAGE = 150;
/** 보낸 글이 이만큼 지나도 기록에 안 뜨면(긴 붙여넣기는 다른 모양으로 남는다) 보내는 중 표시를 내린다 */
const PENDING_MS = 600_000; // 일하는 중엔 줄 서 있는 말이 오래 기다린다

// 답 마크다운 → HTML 은 한 번 바꾼 걸 기억한다 — 탭 창을 다 붙여 두니 앱이 다시 그릴 때마다 채팅 넷이 말풍선 수백 개를
// 다시 바꿔서 탭 전환이 한참 걸렸다(2026-09-30 사용자)
const mdCache = new Map<string, string>();
const md = (text: string) => {
  const hit = mdCache.get(text);
  if (hit !== undefined) return hit;
  const html = DOMPurify.sanitize(marked.parse(mdSafe(text), { async: false, breaks: true }) as string, { FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'img'] });
  if (mdCache.size > 3000) mdCache.clear();
  mdCache.set(text, html);
  return html;
};

/** 남은 참조 중 가장 큰 번호 — 다음 @chatN 이 겹치지 않게 */
const topRef = (refs: ChatRef[]) => Math.max(0, ...refs.map((r) => Number(r.label.slice(5)) || 0));
// 쓰던 글은 세션마다 — 참모 탭을 옮겨도, 앱을 다시 켜도 남는다(2026-09-30 사용자: 1→2 옮기다 긴 글이 날아갔다)
// 보내는 중인 말도 세션마다 — 탭을 옮겨 창이 새로 그려져도 "보내는 중"이 남고, 안 보내졌으면 다시 Enter 를 넣을 수 있게
const pendingBy = new Map<string, { text: string; at: number }[]>();
const drafts = draftStore((() => { try { return window.localStorage; } catch { return undefined; } })());

/**
 * 스페이스 모드의 채팅 보기(2026-09-30 사용자). 터미널(TUI)은 뒤에 그대로 붙어 있고, 이건 그 위에 덮는 판이다.
 * 읽기 = 대화 기록 이어 읽기, 쓰기 = 그 터미널 입력칸에 붙여넣고 Enter(send). 멈추기 = Esc
 */
export function ChatView({ sessionId, state, send, interrupt, onTerminal, onInputFocus, focusRef, screen, submitTerminal, pasteImage, sendNow, voiceStop = 0, sendQueuedNow, clearTerminal, paneId, ctx, modelInfo, pickModel, cwd }: {
  sessionId?: string;
  /** 컨텍스트 쓴 % — 입력칸 위 오른쪽 고리 */
  ctx?: number;
  /** 지금 모델·에포트(상태줄 파일) — 머리줄 칩. runCommand 로 /model·/effort 를 보내 바꾼다 */
  modelInfo?: ModelInfo;
  pickModel?: (want: PickWant) => Promise<PickResult>;
  /** 세션 폴더 — / 자동완성에 그 프로젝트 스킬·명령을 넣는다 */
  cwd?: string;
  state: string;
  send: (text: string) => void;
  interrupt: () => void;
  /** 터미널로 보기 — 선택지·권한 창처럼 채팅에 안 그려지는 화면일 때 */
  onTerminal: () => void;
  /** 뒤 터미널 화면 — 입력칸에 들어간 글(지구본 키로 받아 적은 말)을 채팅에 보여 준다 */
  screen?: () => { lines: string[]; cursor: [number, number] } | undefined;
  /** 터미널 입력칸에 있는 글을 그대로 보낸다(Enter) */
  submitTerminal: () => void;
  /** 클립보드 그림을 터미널 입력칸으로(Claude 의 Ctrl+V) */
  pasteImage: () => void;
  /** 이 창 세션 id — 다른 곳(스페이스)에서 이 세션에 보낸 말도 "보내는 중"으로 보이게 */
  paneId?: string;
  /** 터미널 입력칸 비우기(뒤로 지우기 n 번) — 붙인 것 빼기 */
  clearTerminal: (n: number) => void;
  /** 지구본 키 말하기가 끝난 횟수 — 바뀌면 4초 뒤 받아 적은 글이 남았는지 본다 */
  voiceStop?: number;
  /** 줄 서 있는(이미 보낸) 말을 바로 — 멈추기(Esc)만. 멈추면 Claude 가 줄 선 말을 곧바로 보낸다(실측) */
  sendQueuedNow: () => void;
  /** 하던 일을 끊고 바로 보내기(Esc 뒤 보내기) — 그냥 Enter 는 줄 서 있다가 중간에 들어간다 */
  sendNow: (text: string) => void;
  /** 입력칸에 포커스 — 지구본 키 말하기를 이 세션으로 */
  onInputFocus?: () => void;
  /** 이 창에 포커스를 줄 때(⌘₩·세션으로 가기) 터미널 대신 입력칸으로 */
  focusRef?: (fn: (() => void) | null) => void;
}) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const [draft, setDraft] = useState(() => drafts.load(paneId).text);
  // / 자동완성(2026-10-01 사용자) — 기본 명령 + 사용자·프로젝트 스킬·명령. 커서가 첫 단어 안일 때만 뜬다
  const [caret, setCaret] = useState(0);
  const [slashAll, setSlashAll] = useState<SlashItem[]>(builtinSlash);
  const [slashSel, setSlashSel] = useState(0);
  const [slashOff, setSlashOff] = useState<string | null>(null); // Esc 로 닫은 그 글자 — 글자가 바뀌면 다시 뜬다
  useEffect(() => {
    let alive = true;
    void invoke<SlashItem[]>('slash_commands', { cwd: cwd ?? null }).then((x) => { if (alive) setSlashAll([...builtinSlash(), ...x]); }).catch(() => {});
    return () => { alive = false; };
  }, [cwd]);
  const slashQ = slashQuery(draft, caret);
  const slashList = slashQ !== null && slashOff !== draft ? matchSlash(slashAll, slashQ) : [];
  const slashOpen = slashList.length > 0 && !(slashList.length === 1 && slashList[0]!.name === slashQ);
  useEffect(() => { setSlashSel(0); }, [slashQ]);
  const slashFill = (name: string) => { const v = completeSlash(draft, name); setDraft(v); setCaret(name.length + 2); requestAnimationFrame(() => input.current?.setSelectionRange(name.length + 2, name.length + 2)); };
  const [pending, setPending] = useState<{ text: string; at: number }[]>(() => (paneId ? pendingBy.get(paneId) ?? [] : []));
  useEffect(() => { if (paneId) pendingBy.set(paneId, pending); }, [paneId, pending]);
  const list = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // 보내기 전 붙인 것 — 그림은 썸네일, 나머지 파일은 이름(터미널 입력칸엔 [Image #n]·경로로 들어가 있다)
  const [attached, setAttached] = useState<{ key: string; url?: string; name: string; label?: string; path?: string }[]>([]);
  // 붙인 그림에 @img1 @img2 이름표 — 입력칸에도 넣어 어느 그림 얘기인지 쓸 수 있게(2026-09-30 사용자)
  const imgCount = useRef(0); // 이번 메시지에 붙인 그림·파일 수 — 붙인 게 비면 0 으로
  const fileCount = useRef(0);
  const lastAttach = useRef(0);
  const attach = (item: { key: string; url?: string; name: string; path?: string }, kind: 'img' | 'file') => {
    lastAttach.current = Date.now();
    const label = kind === 'img' ? `@img${++imgCount.current}` : `@file${++fileCount.current}`;
    setAttached((a) => [...a, { ...item, label }]);
    setDraft((d) => `${d}${d && !/\s$/.test(d) ? ' ' : ''}${label} `);
  };
  // 말풍선 참조 @chat1 — 앞 말풍선에 마우스를 올려 "참조"를 누르면 입력칸에 이름표, 보낼 때 인용으로 붙는다(2026-09-30 사용자)
  const [refs, setRefs] = useState<ChatRef[]>(() => drafts.load(paneId).refs);
  const refCount = useRef(topRef(refs));
  // 다른 세션으로 바뀌면 그 세션에 쓰던 글로, 쓰는 동안은 그때그때 기억(효과 순서: 세션 바꾸기가 먼저)
  const draftKey = useRef(paneId);
  useEffect(() => {
    if (draftKey.current === paneId) return;
    draftKey.current = paneId;
    const d = drafts.load(paneId);
    setDraft(d.text);
    setRefs(d.refs);
    refCount.current = topRef(d.refs);
  }, [paneId]);
  useEffect(() => { drafts.save(draftKey.current, { text: draft, refs }); }, [draft, refs]);
  const addRef = (who: string, text: string) => {
    const label = `@chat${++refCount.current}`;
    setRefs((r) => [...r, { label, who, text }]);
    setDraft((d) => `${d}${d && !/\s$/.test(d) ? ' ' : ''}${label} `);
    requestAnimationFrame(() => input.current?.focus());
  };
  // 말풍선에 넘기는 참조 함수는 늘 같은 것 — 말풍선이 다시 안 그려지게(memo)
  const addRefNow = useRef(addRef);
  addRefNow.current = addRef;
  const stableRef = useCallback((who: string, text: string) => addRefNow.current(who, text), []);
  const dropRef = (label: string) => {
    setRefs((r) => r.filter((x) => x.label !== label));
    setDraft((d) => d.replace(new RegExp(`${label}(?!\\d)\\s?`), ''));
  };
  const addImage = (item: { key: string; url?: string; name: string; path?: string }) => attach(item, 'img');
  // 붙인 것 빼기 — Claude 입력칸 속 그림 표시를 하나만 골라 지울 믿을 만한 방법이 없어 통째로(2026-09-30 사용자)
  const clearAttached = () => {
    clearTerminal([...termText].length + 20);
    setAttached([]);
    imgCount.current = 0;
    fileCount.current = 0;
    setDraft((d) => d.replace(/@(img|file)\d+\s?/g, ''));
    quietUntil.current = Date.now() + 800;
    setTermText('');
    input.current?.focus();
  };
  useEffect(() => {
    const pane = root.current?.closest('.pane');
    if (!pane) return;
    const onPaths = (e: Event) => {
      const paths = (e as CustomEvent<string[]>).detail ?? [];
      for (const p of paths) {
        const it = { key: `${p}:${Date.now()}`, name: p.split('/').pop() ?? p, path: p };
        if (/\.(png|jpe?g|gif|webp|heic)$/i.test(p)) addImage({ ...it, url: docUrl(p) });
        else attach(it, 'file');
      }
    };
    pane.addEventListener(DROP_PATHS_EVENT, onPaths);
    return () => pane.removeEventListener(DROP_PATHS_EVENT, onPaths);
  }, []);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    focusRef?.(() => input.current?.focus());
    return () => focusRef?.(null);
  }, [focusRef]);

  // 대화 기록 이어 읽기 — /clear 하면 sessionId 가 바뀌어 처음부터
  useEffect(() => {
    setItems([]);
    setLimit(PAGE);
    if (!sessionId) return;
    let next: number | undefined;
    let alive = true;
    let timer = 0;
    const tick = async () => {
      try {
        const c = await readTranscript(sessionId, next);
        if (!alive) return;
        next = c.next;
        if (c.reset) setItems(parseChat(c.text));
        else if (c.text) setItems((prev) => appendChat(prev, c.text));
      } catch {
        // 다음 차례에 다시
      }
      if (alive) timer = window.setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [sessionId]);

  // 할 일 목록(터미널의 "N tasks …") — 2초마다. 접기·펴기는 이 컴퓨터에 기억
  const [tasks, setTasks] = useState<SessionTask[]>([]);
  useEffect(() => {
    setTasks([]);
    if (!sessionId) return;
    let alive = true;
    const tick = () => void readSessionTasks(sessionId).then((t) => { if (alive) setTasks((p) => (JSON.stringify(p) === JSON.stringify(t) ? p : t)); }).catch(() => {});
    tick();
    const id = window.setInterval(tick, 2000);
    return () => { alive = false; window.clearInterval(id); };
  }, [sessionId]);
  const [hints, setHints] = useState(() => { try { return localStorage.getItem('chatHints') !== '0'; } catch { return true; } });
  const [tasksOpen, setTasksOpen] = useState(() => { try { return localStorage.getItem('chatTasksOpen') !== '0'; } catch { return true; } });

  useEffect(() => {
    if (!paneId) return;
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; text: string }>).detail;
      if (d?.id === paneId) { setPending((p) => [...p, { text: d.text, at: Date.now() }]); stick.current = true; }
    };
    window.addEventListener('chat-pending', on);
    return () => window.removeEventListener('chat-pending', on);
  }, [paneId]);

  const waiting = useMemo(() => {
    const now = Date.now();
    return pendingLeft(pending, items, now).filter((p) => now - p.at < PENDING_MS);
  }, [pending, items]);
  useEffect(() => { if (waiting.length !== pending.length) setPending(waiting); }, [waiting, pending.length]);
  // / 명령은 4초 뒤 지우는데(domain/chat pendingLeft) 기록이 안 바뀌면 다시 셀 일이 없다 — 시계로 한 번 더 센다
  useEffect(() => {
    if (!pending.some((p) => p.text.trimStart().startsWith('/'))) return;
    const t = window.setTimeout(() => setPending((p) => [...p]), 4500);
    return () => window.clearTimeout(t);
  }, [pending]);

  // 입력칸은 글 높이만큼 늘어난다(줄바꿈 수로 세면 긴 한 줄이 두 줄에서 멈췄다 — 2026-09-30 사용자)
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    // 상한은 이 채팅 칸 높이의 45% — 창 높이로 재면 쌓기 보기의 작은 칸에서 입력칸이 칸을 넘어 아래가 잘렸다(2026-09-30)
    const room = root.current?.clientHeight ?? window.innerHeight;
    el.style.height = `${Math.min(el.scrollHeight + 2, Math.max(60, Math.round(room * 0.45)))}px`;
    const l = list.current; // 입력칸이 커져 목록이 줄면 맨 아래가 가려졌다 — 그 자리에서 바로 내린다
    if (l && stick.current) l.scrollTop = l.scrollHeight;
  }, [draft]);

  // 맨 아래를 보고 있었으면 새 말이 와도 맨 아래에 붙어 있는다. 위로 올려 읽는 중이면 그대로.
  // 내용·칸 높이가 바뀔 때마다(탭→쌓기로 다시 붙음, 입력칸이 커짐, 그림이 늦게 뜸) 따라간다 — 중간에 멈춰 있었다(2026-09-30)
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items, waiting.length]);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const follow = () => { if (stick.current) el.scrollTop = el.scrollHeight; };
    const ro = new ResizeObserver(follow);
    ro.observe(el);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, []);

  // 터미널 입력칸 글 — 지구본 키로 말하면 거기 받아 적힌다. 터미널로 바꾸지 않고 여기 보여 준다(2026-09-30 사용자)
  const [termText, setTermText] = useState('');
  const [compacting, setCompacting] = useState(false);
  // 보낸 직후엔 보낸 글이 터미널 입력칸을 잠깐 지나간다 — 그 사이엔 위 줄에 안 띄운다(번쩍였다, 2026-09-30 사용자)
  const quietUntil = useRef(0);
  const empties = useRef(0);
  useEffect(() => {
    if (!screen) return;
    const id = window.setInterval(() => {
      const s = screen();
      const t = s && Date.now() >= quietUntil.current ? promptInput(s.lines, s.cursor) ?? '' : '';
      setTermText((prev) => (prev === t ? prev : t));
      setCompacting(isCompacting(s?.lines));
      // 터미널 입력칸이 비면(보냈거나 지웠거나) 붙인 것도 비운다 — 한 번 빈칸으로 읽혔다고 지우면 썸네일이 사라지고 [Image #n] 만 남았다
      empties.current = t ? 0 : empties.current + 1;
      // 입력칸에 @file·@img 이름표가 남아 있거나 방금 붙였으면 아직 쓰는 중 — 번호를 1로 되돌리면 두 파일이 같은 @file1 이 됐다(2026-09-30 사용자)
      if (empties.current >= 4 && !/@(img|file)\d+/.test(draftRef.current) && Date.now() - lastAttach.current > 5000) { imgCount.current = 0; fileCount.current = 0; setAttached((a) => (a.length ? [] : a)); }
    }, 400);
    return () => window.clearInterval(id);
  }, [screen]);

  // 지구본 키로 말하면 Claude(voice.autoSubmit)가 보통 알아서 보낸다. 가끔 안 보내고 입력칸에 남는다(참모가 일할 때 등, 2026-09-30) —
  // 말이 끝나고 4초 뒤에도 받아 적은 글이 그대로면 대신 Enter. 그림 표시가 섞였거나 사람이 입력칸에 쓰는 중이면 두다
  const termRef = useRef('');
  termRef.current = termText;
  const draftRef = useRef('');
  draftRef.current = draft;
  useEffect(() => {
    if (!voiceStop) return;
    const t = window.setTimeout(() => {
      const left = termRef.current;
      if (!left || /\[Image #\d+\]/.test(left) || draftRef.current.trim()) return;
      submitTerminal();
      setPending((p) => [...p, { text: left, at: Date.now() }]);
      quietUntil.current = Date.now() + 1500;
    }, 4000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceStop]);

  // 보낸 말이 Enter 없이 입력칸에 남았고 참모가 쉬고 있으면 Enter 를 한 번 더 — 참모 1→2→1 오가다 입력칸에 남아
  // 안 보내졌다(2026-09-30 사용자). 치는 중(0.4초 뒤 Enter)과 헷갈리지 않게 2초 그대로일 때만, 같은 말은 한 번만
  const busy = chatBusy(state, items);
  const retried = useRef(new Set<string>());
  useEffect(() => {
    if (busy || state === 'blocked') return;
    const stuck = stuckInInput(waiting.map((p) => p.text), termText);
    if (!stuck || retried.current.has(stuck)) return;
    const t = window.setTimeout(() => {
      if (stuckInInput([stuck], termRef.current) !== stuck) return;
      retried.current.add(stuck);
      submitTerminal();
      quietUntil.current = Date.now() + 1500;
    }, 2000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termText, busy, state, waiting]);

  const atBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  // 위로 많이 올려 읽는 중이면 "맨 아래로" 버튼(2026-09-30 사용자)
  const [away, setAway] = useState(false);
  const [dropHot, setDropHot] = useState(false);
  // 스페이스에서 끌어온 세션·참모 — 입력칸에 이름표 글로(2026-09-30 사용자)
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; text: string }>).detail;
      if (!d || d.id !== paneId) return;
      setDraft((v) => `${v}${v && !/\s$/.test(v) ? ' ' : ''}${d.text} `);
      requestAnimationFrame(() => input.current?.focus());
    };
    window.addEventListener(CHAT_INSERT, on);
    return () => window.removeEventListener(CHAT_INSERT, on);
  }, [paneId]);
  const recheck = () => requestAnimationFrame(() => { const el = list.current; if (el) { stick.current = atBottom(el); setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 400); } });
  const toBottom = () => { const el = list.current; if (!el) return; stick.current = true; el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); setAway(false); };

  const tail = items[items.length - 1];
  const lastTool = tail?.kind === 'tools' ? (() => { const t = tail.tools[tail.tools.length - 1]!; return `${t.name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '')} ${t.target}`.trim(); })() : '';
  const shown = items.length > limit ? items.slice(items.length - limit) : items;

  const submit = (now = false) => {
    const text = withRefs(draft.trim(), refs);
    quietUntil.current = Date.now() + 1500;
    if (!text && termText) { submitTerminal(); setPending((p) => [...p, { text: termText, at: Date.now() }]); stick.current = true; return; }
    if (!text) return;
    if (now) sendNow(text);
    else send(text);
    setPending((p) => [...p, { text, at: Date.now() }]);
    setDraft('');
    setRefs([]);
    refCount.current = 0;
    stick.current = true;
    requestAnimationFrame(() => input.current?.focus()); // send 가 터미널에 포커스를 준다 — 입력칸으로 되돌린다
  };

  // 답 안 링크는 웹뷰가 따라가지 않게 — 웹 주소만 기본 브라우저로
  const onLink = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) void openTarget('url', href).catch(() => {});
  };

  return (
    <div className={`chat ${dropHot ? 'drop-hot' : ''}`} ref={root} onMouseDown={(e) => e.stopPropagation()}
      // 창 아무 데나 눌러도 입력칸으로 — 쌓기 보기에서 급할 때 입력칸 찾아 누르기 어려웠다(2026-09-30 사용자). 글 고르기·버튼·링크는 그대로
      onMouseUp={(e) => { const t = e.target as HTMLElement; if (clickFocusesInput({ interactive: !!t.closest('button, a, input, textarea, select, summary, [contenteditable="true"], [role="button"]'), selected: window.getSelection()?.toString() ?? '' })) input.current?.focus(); }}
      // 스페이스에서 끌어온 파일 — 끌어다 놓기와 똑같이 붙인다(터미널 입력칸에 경로 + @file·@img 이름표)
      onDragOver={(e) => { if (paneId && e.dataTransfer.types.includes(PATH_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!dropHot) setDropHot(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHot(false); }}
      onDrop={(e) => { const p = e.dataTransfer.getData(PATH_MIME); setDropHot(false); if (p && paneId) { e.preventDefault(); attachToChat(paneId, [p]); requestAnimationFrame(() => input.current?.focus()); } }}>
      {tasks.length > 0 && (() => {
        const c = taskCounts(tasks);
        const now = tasks.find((t) => t.status === 'in_progress');
        return (
          <div className={`chat-tasks ${tasksOpen ? 'open' : ''}`}>
            <button className="chat-tasks-head" aria-expanded={tasksOpen} onClick={() => setTasksOpen((o) => { try { localStorage.setItem('chatTasksOpen', o ? '0' : '1'); } catch { /* 기억 못 해도 된다 */ } return !o; })}>
              <b>{tr(`할 일 ${tasks.length}`, `${tasks.length} tasks`)}</b>
              <span className="dim">{tr(`끝남 ${c.done} · 진행 ${c.doing} · 남음 ${c.open}`, `${c.done} done · ${c.doing} in progress · ${c.open} open`)}</span>
              {!tasksOpen && now && <span className="chat-tasks-now">{now.activeForm || now.subject}</span>}
              <span className="chat-tasks-fold">{tasksOpen ? tr('접기', 'Collapse') : tr('펼치기', 'Expand')}</span>
            </button>
            {tasksOpen && (
              <ul>
                {tasks.map((t) => (
                  <li key={t.id} className={`st-${t.status}`}>
                    <span className="mark" aria-hidden />
                    <span className="subj">{t.status === 'in_progress' && t.activeForm ? t.activeForm : t.subject}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })()}
      <div className="chat-list" ref={list} onClick={onLink}
        // 맨 아래를 벗어났다는 판단은 사람이 움직였을 때만(휠·끌기·키). 그림이 늦게 그려지거나 칸이 나뉘며 저절로 움직인 스크롤을
        // "위로 올려 읽는 중"으로 읽어, 재시작 뒤 두 번째 창이 덜 내려간 채 열렸다(2026-09-30 사용자). 저절로 움직인 건 맨 아래 닿을 때만 반영
        onScroll={(e) => { const el = e.currentTarget; if (atBottom(el)) stick.current = true; const far = el.scrollHeight - el.scrollTop - el.clientHeight > 400; if (far !== away) setAway(far); }}
        onWheel={recheck} onMouseUp={recheck} onKeyUp={recheck} onTouchEnd={recheck}>
        <div className="chat-inner" ref={inner}>
        {items.length > limit && <button className="chat-more" onClick={() => setLimit((n) => n + PAGE)}>{tr(`앞 대화 더 보기 (${items.length - limit})`, `Show earlier (${items.length - limit})`)}</button>}
        {!sessionId && <div className="chat-empty">{tr('아직 대화 기록이 없어요. 아래에 첫 지시를 보내 보세요', 'No conversation yet. Send the first message below')}</div>}
        {shown.map((it) => <Bubble key={`${it.kind}:${it.id}`} it={it} onRef={stableRef} />)}
        {waiting.map((p) => <div key={p.at} className="chat-row me"><div className="bubble me pending">{splitRefs(p.text).body}<span className="chat-meta">{tr('보내는 중', 'Sending')}</span></div></div>)}
        </div>
      </div>
      {away && <button className="chat-bottom" onClick={toBottom} title={tr('맨 아래로', 'Jump to latest')}><IconChevron />{tr('맨 아래로', 'Latest')}</button>}
      {/* 상태 줄 — 목록 끝에 두면 스크롤에 가려 작업 중인지 몰랐다(2026-09-30 사용자). 입력칸 바로 위에 늘 */}
      {(state === 'blocked' || busy || compacting || ctx !== undefined || modelInfo?.model) && (
        <div className="chat-status">
          {compacting ? (
            <span className="chat-compact"><span className="spin" />{tr('대화 압축 중 — 앞 대화를 요약하고 있어요', 'Compacting — summarizing earlier conversation')}</span>
          ) : state === 'blocked' ? (
            <><span>{tr('터미널에서 선택을 기다리고 있어요', 'Waiting for a choice in the terminal')}</span><button className="chat-more" onClick={onTerminal}>{tr('터미널로 보기', 'Show terminal')}</button></>
          ) : busy ? (
            <><span className="spin" /><span>{tr('작업 중', 'Working')}{lastTool ? ` · ${lastTool}` : ''}</span></>
          ) : null}
          {modelInfo?.model && pickModel && (() => {
            const lockedWhy = termText ? tr('터미널 입력칸에 쓰던 글이 있어서 못 바꿔요 — 먼저 보내거나 지워 주세요', 'There is text in the terminal input — send or clear it first')
              : busy || compacting ? tr('작업 중엔 못 바꿔요 — 끝나면 바꿔 주세요', "Can't change while it's working") : state === 'blocked' ? tr('터미널에서 선택을 기다리는 중이라 못 바꿔요', 'Waiting for a choice in the terminal') : undefined;
            return <ModelChip info={modelInfo} pick={pickModel} locked={!!lockedWhy} lockedWhy={lockedWhy} />;
          })()}
          {ctx !== undefined && <CtxRing used={ctx} />}
        </div>
      )}
      {((termText && !stuckInInput(waiting.map((p) => p.text), termText)) || attached.length > 0) && (
        <div className="chat-term" title={tr('터미널 입력칸에 들어가 있는 것 — 보내기(Enter)하면 같이 간다', 'Already in the terminal input — goes out with your next send')}>
          {attached.length > 0 && (
            <span className="chat-attach">
              {attached.map((a) => (a.url
                ? <span key={a.key} className="chat-att"><img src={a.url} alt={a.name} title={a.name} />{a.label && <em>{a.label}</em>}</span>
                : <span key={a.key} className="chat-file" title={a.path ?? a.name}><IconFile />{a.label ?? a.name}</span>))}
            </span>
          )}
          {/* 그림은 썸네일로 보이니 [Image #n] 표시는 빼고, 남은 글(지구본 키로 받아 적은 말 등)만 */}
          {(() => {
            // 붙인 건 이름표로 보이니 [Image #n]·긴 파일 경로는 빼고 남은 글(지구본 키 말 등)만
            const rest = attached.length ? termRest(termText, attached.map((a) => a.path).filter((p): p is string => !!p)) : termText;
            return rest ? <span className="chat-term-text">{rest}</span> : <span className="chat-term-text" />;
          })()}
          <button className="mini" onClick={clearAttached} title={tr('터미널 입력칸에 붙인 것 전부 빼기', 'Remove everything attached in the terminal input')}>{tr('빼기', 'Remove')}</button>
        </div>
      )}
      {busy && (!!draft.trim() || waiting.length > 0) && hints && (
        <div className="chat-hint">
          <span>{draft.trim()
            ? tr('Enter 는 줄 서 있다가 중간에 들어가요 · ⌘Enter 는 하던 일을 끊고 바로 보내요', 'Enter queues it for the next step · ⌘Enter interrupts and sends now')
            : tr('줄 서 있는 말이 있어요 · ⌘Enter 로 하던 일을 끊고 바로 보내요', 'A message is queued · ⌘Enter interrupts and sends it now')}</span>
          <button onClick={() => { setHints(false); try { localStorage.setItem('chatHints', '0'); } catch { /* 이번 실행만 */ } }}>{tr('힌트 끄기', 'Hide hints')}</button>
        </div>
      )}
      {refs.length > 0 && (
        <div className="chat-refs">
          {refs.map((r) => (
            <span key={r.label} className="chat-ref" title={r.text}>
              <span className="at-chip">{r.label}</span><span className="dim">{r.who}</span><span className="q">{r.text.replace(/\s+/g, ' ')}</span>
              <button className="mini" onClick={() => dropRef(r.label)}>{tr('빼기', 'Remove')}</button>
            </span>
          ))}
        </div>
      )}
      {slashOpen && (
        <div className="chat-mention chat-slash" role="listbox">
          {slashList.map((it, i) => (
            <button key={it.name} role="option" aria-selected={i === slashSel} className={i === slashSel ? 'on' : ''} onMouseEnter={() => setSlashSel(i)}
              onMouseDown={(e) => { e.preventDefault(); slashFill(it.name); input.current?.focus(); }}>
              <b>/{it.name}</b><span className="dim">{it.desc}</span>{i === slashSel && <span className="dim key">Tab</span>}
            </button>
          ))}
        </div>
      )}
      {(() => {
        const m = draft.match(/@(\w*)$/);
        const opts = m ? [...attached.map((a) => a.label), ...refs.map((r) => r.label)].filter((l): l is string => !!l && l.startsWith(`@${m[1]}`) && l !== `@${m[1]}`) : [];
        if (!m || !opts.length) return null;
        const pick = (l: string) => { setDraft((d) => d.replace(/@\w*$/, `${l} `)); input.current?.focus(); };
        return (
          <div className="chat-mention" role="listbox">
            {opts.map((l, i) => <button key={l} role="option" aria-selected={i === 0} onMouseDown={(e) => { e.preventDefault(); pick(l); }}>{l}{i === 0 && <span className="dim"> Tab</span>}</button>)}
          </div>
        );
      })()}
      <div className="chat-input">
        <div className="chat-field">
        {/* 입력칸 뒤에 같은 글을 깔아 @img1·@file1 자리만 칠한다 — textarea 는 글자를 따로 꾸밀 수 없다 */}
        <div className="chat-backdrop" ref={backdrop} aria-hidden>{atMarks(draft)}{'\n'}</div>
        <textarea
          onScroll={(e) => { if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop; }}
          ref={input}
          value={draft}
          rows={1}
          placeholder={tr('메시지 — Enter 보내기, Shift+Enter 줄바꿈', 'Message — Enter to send, Shift+Enter for a new line')}
          onChange={(e) => { setDraft(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onFocus={onInputFocus}
          onKeyDown={(e) => {
            // / 자동완성이 떠 있으면: ↑↓ 고르기, Tab·Enter 채우기, Esc 닫기 — 터미널 Claude 와 같은 손버릇
            if (slashOpen && !e.nativeEvent.isComposing) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSlashSel((i) => (i + (e.key === 'ArrowDown' ? 1 : slashList.length - 1)) % slashList.length); return; }
              if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'Enter' && !e.shiftKey && !modKey(e, IS_WIN))) { e.preventDefault(); slashFill(slashList[slashSel]!.name); return; }
              if (e.key === 'Escape') { e.preventDefault(); setSlashOff(draft); return; }
            }
            // Enter = 보내기(일하는 중이면 줄 서 있다가 중간에 들어간다), ⌘Enter = 끊고 바로 보내기(2026-09-30 사용자)
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              // 입력칸이 빈 채로 ⌘Enter + 줄 서 있는 말이 있으면 그 말을 바로(멈추면 Claude 가 곧바로 보낸다)
              if (modKey(e, IS_WIN) && busy && !draft.trim() && !termText && waiting.length) { sendQueuedNow(); return; }
              submit(modKey(e, IS_WIN) && busy);
            }
            // Esc = CLI 처럼 하던 일 멈추기(일하는 중일 때만 — 2026-09-30 사용자)
            else if (e.key === 'Escape' && !e.nativeEvent.isComposing && (busy || waiting.length > 0)) { e.preventDefault(); interrupt(); } // 쉴 때 Esc 두 번은 Claude 되감기 메뉴라 안 보낸다
            // @ 뒤 Tab = 붙인 것 이름표 넣기
            else if (e.key === 'Tab' && !e.shiftKey && /@\w*$/.test(draft)) {
              const m = draft.match(/@(\w*)$/)!;
              const l = [...attached.map((a) => a.label), ...refs.map((r) => r.label)].find((x) => x && x.startsWith(`@${m[1]}`));
              if (l) { e.preventDefault(); setDraft((d) => d.replace(/@\w*$/, `${l} `)); }
            }
            // 터미널에서처럼 Ctrl+V = 클립보드 그림(맥만 — 윈도우 Ctrl+V 는 글 붙여넣기, 그림은 onPaste 가 받는다)
            else if (!IS_WIN && e.ctrlKey && !e.metaKey && (e.key === 'v' || e.key === 'ㅍ')) { e.preventDefault(); pasteImage(); }
          }}
          onPaste={(e) => {
            // ⌘V 인데 클립보드에 그림이 있으면 글 대신 그림을 터미널 입력칸으로 — Claude 가 [Image #n] 으로 받는다
            // 웹뷰가 클립보드 그림을 파일로 안 넘겨줄 때가 있다 — 붙일 글이 없으면 그림으로 보고 터미널로(아무것도 안 들어갔다, 2026-09-30)
            const item = [...e.clipboardData.items].find((i) => i.kind === 'file' || i.type.startsWith('image/'));
            const file = item?.getAsFile() ?? null;
            if (file || !e.clipboardData.getData('text/plain')) {
              e.preventDefault();
              pasteImage();
              empties.current = 0;
              addImage({ key: `clip:${Date.now()}`, name: file?.name || tr('붙인 그림', 'Pasted image'), ...(file?.type.startsWith('image/') ? { url: URL.createObjectURL(file) } : {}) });
            }
          }}
        />
        </div>
        {busy && !draft.trim() && <button className="btn icon" onClick={interrupt} aria-label={tr('멈추기', 'Stop')} title={tr('멈추기 — Esc 를 보내 하던 일을 멈춘다', 'Stop — send Esc to interrupt')}><IconStop /></button>}
        <button className="btn pri icon" disabled={!draft.trim() && !termText} onClick={() => submit()} aria-label={tr('보내기', 'Send')} title={tr('보내기 (Enter) · 끊고 보내기 (⌘Enter)', 'Send (Enter) · Interrupt & send (⌘Enter)')}><IconSend /></button>
      </div>
    </div>
  );
}

const hhmm = (ts: string) => { const d = new Date(ts); return Number.isNaN(d.getTime()) ? '' : ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
/** 말풍선 옆 "참조" — 누르면 입력칸에 @chatN */
const RefBtn = ({ onClick }: { onClick: () => void }) => (
  <button className="chat-refbtn" onClick={(e) => { e.stopPropagation(); onClick(); }} title={tr('이 말풍선을 입력칸에 참조로 넣기', 'Reference this bubble in the input')}>{tr('참조', 'Quote')}</button>
);

const Bubble = memo(function Bubble({ it, onRef }: { it: ChatItem; onRef: (who: string, text: string) => void }) {
  if (it.kind === 'user') {
    const { body, refs } = splitRefs(it.text);
    return (
      <div className="chat-row me">
        <RefBtn onClick={() => onRef(tr(`내 말${hhmm(it.ts)}`, `Me${hhmm(it.ts)}`), body)} />
        <div className="bubble me">
          {it.images && <div className="chat-thumbs">{it.images.map((src, i) => <Thumb key={i} src={src} label={`@img${i + 1}`} />)}</div>}
          {splitPaths(body).map((x, i) => ('text' in x ? <AtText key={i} text={x.text} /> : <span key={i} className="chat-file" title={x.path}><IconFile />{x.name}</span>))}
          {refs.map((r) => <div key={r.label} className="chat-quote" title={r.text}><span className="at-chip">{r.label}</span> <span className="dim">{r.who}</span><div className="q">{r.text}</div></div>)}
        </div>
      </div>
    );
  }
  if (it.kind === 'assistant') return <div className="chat-row"><div className="bubble md" dangerouslySetInnerHTML={{ __html: md(it.text) }} /><RefBtn onClick={() => onRef(tr(`답${hhmm(it.ts)}`, `Reply${hhmm(it.ts)}`), it.text)} /></div>;
  if (it.kind === 'note') return <div className="chat-note">{it.text}</div>;
  if (it.kind === 'relay') return <div className="chat-row relay"><Relay from={it.from} text={it.text} /><RefBtn onClick={() => onRef(it.from === '앱' ? tr('앱이 전함', 'From the app') : tr(`${it.from} 세션`, it.from), it.text)} /></div>;
  const last = it.tools[it.tools.length - 1]!;
  return (
    <details className="chat-tools">
      <summary>{tr(`도구 ${it.tools.length}번`, `${it.tools.length} tool calls`)} <span className="dim">— {last.name} {last.target}</span></summary>
      <ul>{it.tools.map((t, i) => <li key={i}><b>{t.name}</b> {t.target}</li>)}</ul>
    </details>
  );
});

/** 말풍선 속 그림 — 누르면 크게, 한 번 더 누르면 작게 */
function Thumb({ src, label }: { src: string; label: string }) {
  const [big, setBig] = useState(false);
  return (
    <span className="chat-att">
      <img className={`chat-thumb ${big ? 'big' : ''}`} src={src} alt={label} onClick={() => setBig((b) => !b)} />
      <em>{label}</em>
    </span>
  );
}

const AT_RE = /(@(?:img|file|chat)\d+)/g;
/** 입력칸 뒤판 — @img1·@file1 자리만 칠한 같은 글 */
function atMarks(text: string) {
  return text.split(AT_RE).map((p, i) => (i % 2 ? <mark key={i} className="at">{p}</mark> : p));
}
/** 말풍선 글 — @img1·@file1 을 칩으로 */
function AtText({ text }: { text: string }) {
  return <>{text.split(AT_RE).map((p, i) => (i % 2 ? <span key={i} className="at-chip">{p}</span> : p))}</>;
}

/** 다른 세션이 보낸 말·앱이 넘긴 줄 — 가운데 카드, 보낸 쪽 이름. 길면 여섯 줄까지, 누르면 펼침 */
function Relay({ from, text }: { from: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`chat-relay ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)} title={open ? tr('접기', 'Collapse') : tr('펼치기', 'Expand')}>
      <div className="who">{from === '앱' ? tr('앱이 전함', 'From the app') : tr(`${from} 세션이 보냄`, `From ${from}`)}</div>
      <div className="body">{text}</div>
    </div>
  );
}

/** 남은 컨텍스트 — 쓴 만큼 고리가 차고, 60% 넘으면 노랑·80% 넘으면 빨강(2026-09-30 사용자 "원형으로 게이지 차는 느낌") */
function CtxRing({ used }: { used: number }) {
  const u = Math.max(0, Math.min(100, Math.round(used)));
  const r = 7, c = 2 * Math.PI * r;
  return (
    <span className={`chat-ctx ${ctxLevel(u)}`} title={tr(`컨텍스트 ${u}% 씀 · 남은 ${100 - u}%`, `Context ${u}% used · ${100 - u}% left`)}>
      <svg viewBox="0 0 18 18" aria-hidden><circle cx="9" cy="9" r={r} className="bg" /><circle cx="9" cy="9" r={r} className="fg" strokeDasharray={`${(u / 100) * c} ${c}`} /></svg>
      {tr(`남은 ${100 - u}%`, `${100 - u}% left`)}
    </span>
  );
}
