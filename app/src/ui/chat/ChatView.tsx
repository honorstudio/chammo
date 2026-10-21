import { memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { draftStore } from '../../domain/chatDraft';
import { interleave } from '../../domain/chatExtras';
import { isCompacting } from '../../domain/compacting';
import { ctxLevel } from '../../domain/ctx';
import { invoke } from '@tauri-apps/api/core';
import { ModelChip, type ModelInfo } from './ModelChip';
import { ChatDialog } from './ChatDialog';
import { modelCommand } from '../../domain/modelPick';
import { screenDialog, type ScreenDialog } from '../../domain/screenDialog';
import type { PickResult, PickWant } from './modelPickRun';
import { builtinSlash, completeSlash, isMemoryCmd, matchSlash, slashQuery, type SlashItem } from '../../domain/slash';
import { appendChat, chatBusy, chatEscStops, chatNorm, escUnsends, enterDelay, parseChat, clickFocusesInput, sentByMe, promptInput, sendControls, splitPaths, splitRefs, stillPending, stuckInInput, taskCounts, termRest, withRefs, type ChatItem, type ChatRef } from '../../domain/chat';
import type { LinkState } from '../../domain/attachExit';
import { LINK_WAIT } from '../../domain/paneLinks';
import { absorbedAt, absorbedLeft, againPlan, applyQueueOps, autoEnterTarget, DUP_CONFIRM, emptyQueue, inputLeftover, keepAfterRemove, LOST_AFTER, mineForLeftover, newPending, pendAct, pendingState, resent, waitingOf, type PendingState, type QueueState } from '../../domain/chatQueue';
import { mdToHtml } from '../md';
import { openTarget, readSessionTasks, readTranscript, type SessionTask, type TranscriptChunk } from '../../data/tauri';
import { modKey } from '../../domain/keys';
import { docUrl, IS_WIN } from '../../domain/reader';
import { DROP_EVENT, DROP_PATHS_EVENT } from '../fileDrop';
import { chipPastes } from '../../domain/drop';
import { assistant, tr } from '../../i18n';
import { IconChatSend, IconChevron, IconChevronDown, IconChevronUp, IconClose, IconEnter, IconFile, IconRefresh, IconSend, IconSpeaker, IconStop, IconTerminal } from '../Icons';
import { ChatVoice } from './chatVoice';
import { backdropStyle } from './backdrop';
import { sameName, shotChoices } from '../../domain/lockerShots';
import { expandMentions, lockerChoices, matchMentions, mentionPick, mentionQuery, mentionRoster, refQuery, REF_PREFIX, sentMentionLabel, splitTokens, type MentionWho } from '../../domain/chatTokens';
import { orchDisplay, orchRoster, useOrchLabels } from '../orchLabels';
import { orchRoleOf, useOrchRoleData } from '../orchRoleStore';
import { OrchAvatar } from '../avatar/OrchAvatar';
import { orchColor } from '../../domain/avatar';
import { lockerApi, useLockerTree, useRecentShots, type LockerOwner } from '../space/useLocker';
import { IconButton } from '../kit/IconButton';
import { CHAT_INSERT, PATH_MIME } from '../space/dragPath';
import { OPEN_PAGE } from '../space/PageBlock';
import { openChatFile } from './openChatFile';
import { attachToChat } from '../fileDrop';
import { every } from '../poll';
import './chat.css';

const POLL_MS = 1000;
/** 한 번에 그리는 항목 수 — 긴 대화는 "앞 대화 더 보기"로 늘린다 */
const PAGE = 150;

// 답 마크다운 → HTML 은 한 번 바꾼 걸 기억한다 — 탭 창을 다 붙여 두니 앱이 다시 그릴 때마다 채팅 넷이 말풍선 수백 개를
// 다시 바꿔서 탭 전환이 한참 걸렸다(2026-09-30 사용자)
const mdCache = new Map<string, string>();
const md = (text: string) => {
  const hit = mdCache.get(text);
  if (hit !== undefined) return hit;
  const html = mdToHtml(text);
  if (mdCache.size > 3000) mdCache.clear();
  mdCache.set(text, html);
  return html;
};

/** 남은 참조 중 가장 큰 번호 — 다음 #chatN 이 겹치지 않게(옛 @chatN 도 같은 자리 수) */
const topRef = (refs: ChatRef[]) => Math.max(0, ...refs.map((r) => Number(r.label.slice(5)) || 0));
// 쓰던 글은 세션마다 — 참모 탭을 옮겨도, 앱을 다시 켜도 남는다(2026-09-30 사용자: 1→2 옮기다 긴 글이 날아갔다)
// 보내는 중인 말도 세션마다 — 탭을 옮겨 창이 새로 그려져도 "보내는 중"이 남고, 안 보내졌으면 다시 Enter 를 넣을 수 있게
const pendingBy = new Map<string, { text: string; at: number; since?: number }[]>();
const drafts = draftStore((() => { try { return window.localStorage; } catch { return undefined; } })());

/**
 * 스페이스 모드의 채팅 보기(2026-09-30 사용자). 터미널(TUI)은 뒤에 그대로 붙어 있고, 이건 그 위에 덮는 판이다.
 * 읽기 = 대화 기록 이어 읽기, 쓰기 = 그 터미널 입력칸에 붙여넣고 Enter(send). 멈추기 = Esc
 */
export function ChatView({ extra = [], fontSize, sessionId, state, send, interrupt, rawKeys, onTerminal, onInputFocus, focusRef, screen, submitTerminal, pasteImage, voiceStop = 0, sendQueuedNow, typeOnly, clearTerminal, paneId, ctx, modelInfo, pickModel, cwd, locker, notice, link, remote = false, readFn }: {
  /** 다른 기기 참모 채팅(ADR 0011) — 뒤 터미널이 없다: 터미널·모델·/ 자동완성·보관함·그림 붙이기·멈춤·@ 멘션을 끈다 */
  remote?: boolean;
  /** 대화 기록 읽기 — 원격이면 그 기기 폰 서버(remoteApi), 없으면 이 기기 */
  readFn?: (sessionId: string, from?: number) => Promise<TranscriptChunk>;
  /** 대화 사이에 시각 순으로 끼울 것 — 직접 답하기 카드(useDirectCards)·보여 준 파일 카드(clip = 그려진 첫 말보다 앞이면 안 그림) */
  extra?: { ts: string; key: string; pin?: boolean; clip?: boolean; node: React.ReactNode }[];
  /** 글자 크기(⌘+/⌘−) — 바뀌면 입력칸 높이를 다시 잰다(채팅 글자가 이걸 따라 커진다, space.css --chat-k) */
  fontSize?: number;
  sessionId?: string;
  /** 컨텍스트 쓴 % — 입력칸 위 오른쪽 고리 */
  ctx?: number;
  /** 지금 모델·에포트(상태줄 파일) — 머리줄 칩. runCommand 로 /model·/effort 를 보내 바꾼다 */
  modelInfo?: ModelInfo;
  pickModel?: (want: PickWant) => Promise<PickResult>;
  /** 세션 폴더 — / 자동완성에 그 프로젝트 스킬·명령을 넣는다 */
  cwd?: string;
  /** 참모 채팅이면 그 참모 보관함 — # 고르기에 보관함 파일을 띄운다 */
  locker?: LockerOwner;
  /** 입력칸 바로 위 조용한 한 줄 — 참모를 깨우는 동안(뜨면 채팅이 그리로 넘어간다, 2026-10-12 rail-wake) */
  notice?: React.ReactNode;
  /** 뒤 터미널 보기가 세션에 붙어 있나(TerminalPane onLink) — 끊긴 동안 보낸 말은 붙으면 앱이 친다(SessionGrid typeAndSend) */
  link?: LinkState;
  state: string;
  send: (text: string) => void;
  interrupt: () => void;
  /** 터미널에 키를 하나씩(선택 창 버튼) — 한꺼번에 넣으면 TUI 가 놓친다 */
  rawKeys?: (seq: string[]) => Promise<void>;
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
  /** 입력칸에 넣기만(Enter 없이) — 말 하나를 빼고 남은 말을 입력칸에 되돌려 놓을 때 */
  typeOnly?: (text: string) => void;
  /** 입력칸에 포커스 — 지구본 키 말하기를 이 세션으로 */
  onInputFocus?: () => void;
  /** 이 창에 포커스를 줄 때(⌘₩·세션으로 가기) 터미널 대신 입력칸으로 */
  focusRef?: (fn: (() => void) | null) => void;
}) {
  const [items, setItems] = useState<ChatItem[]>([]);
  /** 이벤트·타이머 안에서 지금 기록 — 새 말풍선이 방금 간 같은 글 뒤부터 맞추게(newPending) */
  const itemsRef = useRef(items);
  itemsRef.current = items;
  /** Claude 대기열(기록의 queue-operation) — 보낸 말이 줄 서 있나 */
  const [queue, setQueue] = useState<QueueState>(emptyQueue);
  const [limit, setLimit] = useState(PAGE);
  const [draft, setDraft] = useState(() => drafts.load(paneId).text);
  const voice = useContext(ChatVoice); // 참모 채팅 열에만 — 입력칸 옆 음성 모드 단추
  // / 자동완성(2026-10-01 사용자) — 기본 명령 + 사용자·프로젝트 스킬·명령. 커서가 첫 단어 안일 때만 뜬다
  const [caret, setCaret] = useState(0);
  const [slashAll, setSlashAll] = useState<SlashItem[]>(builtinSlash);
  const [slashSel, setSlashSel] = useState(0);
  const [slashOff, setSlashOff] = useState<string | null>(null); // Esc 로 닫은 그 글자 — 글자가 바뀌면 다시 뜬다
  useEffect(() => {
    let alive = true;
    if (remote) return;
    void invoke<SlashItem[]>('slash_commands', { cwd: cwd ?? null }).then((x) => { if (alive) setSlashAll([...builtinSlash(), ...x]); }).catch(() => {});
    return () => { alive = false; };
  }, [cwd, remote]);
  const slashQ = slashQuery(draft, caret);
  const slashList = !remote && slashQ !== null && slashOff !== draft ? matchSlash(slashAll, slashQ) : [];
  const slashOpen = slashList.length > 0 && !(slashList.length === 1 && slashList[0]!.name === slashQ);
  useEffect(() => { setSlashSel(0); }, [slashQ]);
  const slashFill = (name: string) => { const v = completeSlash(draft, name); setDraft(v); setCaret(name.length + 2); requestAnimationFrame(() => input.current?.setSelectionRange(name.length + 2, name.length + 2)); };
  // /memory — 터미널 고를 창 대신 CLAUDE.md·메모리 md 목록, 누르면 스페이스 문서로(2026-10-04 사용자)
  const [memList, setMemList] = useState<MemoryFile[] | null>(null);
  const openMemory = () => void invoke<MemoryFile[]>('memory_files_for', { root: cwd ?? null }).then(setMemList).catch(() => setMemList([]));
  const openDoc = (path: string) => {
    setMemList(null);
    if (document.querySelector('.space-mode')) window.dispatchEvent(new CustomEvent(OPEN_PAGE, { detail: path }));
    else void openTarget('file', path);
  };
  const [pending, setPending] = useState<{ text: string; at: number; since?: number }[]>(() => (paneId ? pendingBy.get(paneId) ?? [] : []));
  useEffect(() => { if (paneId) pendingBy.set(paneId, pending); }, [paneId, pending]);
  const list = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // 보내기 전 붙인 것 — 그림은 썸네일, 나머지 파일은 이름(터미널 입력칸엔 [Image #n]·경로로 들어가 있다)
  const [attached, setAttached] = useState<{ key: string; url?: string; name: string; label?: string; path?: string }[]>([]);
  // 붙인 그림에 #img1 #img2 이름표 — 입력칸에도 넣어 어느 그림 얘기인지 쓸 수 있게(2026-09-30 사용자, 10-12 @ 는 참모 멘션이 가져가고 # 로)
  const imgCount = useRef(0); // 이번 메시지에 붙인 그림·파일 수 — 붙인 게 비면 0 으로
  const fileCount = useRef(0);
  const lastAttach = useRef(0);
  const attach = (item: { key: string; url?: string; name: string; path?: string }, kind: 'img' | 'file'): string => {
    lastAttach.current = Date.now();
    const label = kind === 'img' ? `${REF_PREFIX}img${++imgCount.current}` : `${REF_PREFIX}file${++fileCount.current}`;
    setAttached((a) => [...a, { ...item, label }]);
    setDraft((d) => `${d}${d && !/\s$/.test(d) ? ' ' : ''}${label} `);
    return label;
  };
  // 말풍선 참조 #chat1 — 앞 말풍선에 마우스를 올려 "참조"를 누르면 입력칸에 이름표, 보낼 때 인용으로 붙는다(2026-09-30 사용자)
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
    const label = `${REF_PREFIX}chat${++refCount.current}`;
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
  // # 고르기(붙인 그림·파일·말풍선 참조 + 보관함 + 파일 고르기)와 @ 참모 멘션은 같은 목록 틀(2026-10-12 사용자) — ↑↓ 고르기, Enter·Tab 넣기, Esc 닫기
  const [popSel, setPopSel] = useState(0);
  const [popOff, setPopOff] = useState<string | null>(null); // Esc 로 닫은 그 글 — 글자가 바뀌면 다시 뜬다
  // @ = 참모 멘션 — 띠 순서, 프사·이름·맡은 일, 쉬는 참모는 흐리게(지금 채팅 주인은 빼고). # 과 둘 다 걸리면 커서에 가까운 쪽
  const labels = useOrchLabels();
  const roles = useOrchRoleData();
  const who = useMemo(() => (remote ? [] : mentionRoster(orchRoster(), paneId, orchDisplay, (n) => orchRoleOf(n)?.text)), [labels, roles, paneId, remote]); // eslint-disable-line react-hooks/exhaustive-deps
  const hashQ0 = slashQ === null ? refQuery(draft, caret) : null;
  const atQ0 = slashQ === null ? mentionQuery(draft, caret) : null;
  const atLater = draft.slice(0, caret).lastIndexOf('@') > draft.slice(0, caret).lastIndexOf('#');
  const hashQ = hashQ0 !== null && (atQ0 === null || !atLater) ? hashQ0 : null;
  const atQ = atQ0 !== null && hashQ === null ? atQ0 : null;
  const lockerTree = useLockerTree(locker && hashQ !== null ? locker : null, 15000);
  // # 고르기 맨 위 — 최근 스크린샷 3~4장(썸네일 + n분 전). 고르면 파일을 붙이는 것과 똑같이 #img 참조로
  const recentShots = useRecentShots(!!locker && !!paneId && hashQ !== null);
  const fillAt = (next: { text: string; caret: number }) => {
    setDraft(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(next.caret, next.caret); });
  };
  /** 친 #글자를 지우고 그 파일들을 붙인다 — 붙이기가 #img·#file 이름표를 글 끝에 넣는다 */
  const attachInstead = (paths: string[]) => {
    if (!paneId || !paths.length) return;
    const at = draft.slice(0, caret).lastIndexOf('#');
    if (at >= 0) setDraft(draft.slice(0, at) + draft.slice(caret));
    attachToChat(paneId, paths);
    requestAnimationFrame(() => input.current?.focus());
  };
  const shotItems: PopItem[] = hashQ === null || !locker || !paneId ? [] : shotChoices(recentShots, hashQ, Date.now()).map((x) => ({
    key: `shot:${x.path}`, main: x.ago || tr('스크린샷', 'Screenshot'), sub: tr('스크린샷', 'Screenshot'), title: x.name,
    pic: <span className="chat-pop-pic"><img className="chat-pop-shot" src={docUrl(x.path)} alt="" draggable={false} /></span>,
    pick: () => attachInstead([x.path]),
  }));
  const hashItems: PopItem[] = hashQ === null ? [] : [
    ...shotItems,
    ...[...attached.map((a) => a.label), ...refs.map((r) => r.label)]
      .filter((l): l is string => !!l && l.startsWith(`${REF_PREFIX}${hashQ}`) && l !== `${REF_PREFIX}${hashQ}`)
      .map((l) => ({ key: l, main: l, pick: () => fillAt(mentionPick(draft, caret, l, '#')) })),
    // 맨 위로 올린 스크린샷은 보관함 줄(연결한 스크린샷 폴더)에서 한 번 더 안 보이게
    ...(locker && paneId ? lockerChoices(lockerTree, hashQ, 12).filter((f) => !shotItems.some((s) => sameName(s.title ?? '', f.name))).slice(0, 6) : []).map((f) => ({ key: f.path, main: f.name, sub: f.folder || tr('보관함', 'Locker'), pick: () => attachInstead([f.path]) })),
    ...(locker && paneId && !hashQ ? [{ key: ':choose', main: tr('파일 고르기…', 'Choose a file…'), sub: tr('고른 파일은 보관함에도 들어가요', 'Also goes into the locker'),
      pick: () => void lockerApi.choose(locker).then((r) => attachInstead((r?.added ?? []).map((a) => a.path)), () => {}) }] : []),
  ];
  const atItems: PopItem[] = atQ === null ? [] : matchMentions(who, atQ).map((w) => ({
    key: `@${w.id}`, main: w.label, sub: w.role, off: w.off, title: w.name,
    pic: <span className="chat-pop-pic"><OrchAvatar name={w.name} size={20} state={w.off ? 'off' : 'rest'} color={orchColor(w.name)} label={w.label} /></span>,
    pick: () => fillAt(mentionPick(draft, caret, w.label)),
  }));
  const popItems = atQ !== null ? atItems : hashItems;
  // 이름을 다 친 하나뿐이면 닫는다 — Enter 가 보내기로 가게(/ 명령과 같은 손버릇)
  const popOpen = popItems.length > 0 && popOff !== draft && !(atQ !== null && popItems.length === 1 && popItems[0]!.main === atQ);
  const popAt = Math.min(popSel, popItems.length - 1);
  useEffect(() => { setPopSel(0); }, [hashQ, atQ]);
  const addImage = (item: { key: string; url?: string; name: string; path?: string }) => attach(item, 'img');
  // 붙인 것 빼기 — Claude 입력칸 속 그림 표시를 하나만 골라 지울 믿을 만한 방법이 없어 통째로(2026-09-30 사용자)
  const clearAttached = () => {
    clearTerminal([...termText].length + 20);
    setAttached([]);
    imgCount.current = 0;
    fileCount.current = 0;
    setDraft((d) => d.replace(/[#@](img|file)\d+\s?/g, ''));
    quietUntil.current = Date.now() + 800;
    setTermText('');
    input.current?.focus();
  };
  useEffect(() => {
    const pane = root.current?.closest('.pane');
    if (!pane) return;
    const onPaths = (e: Event) => {
      const paths = (e as CustomEvent<string[]>).detail ?? [];
      const chips = paths.map((p) => {
        const it = { key: `${p}:${Date.now()}`, name: p.split('/').pop() ?? p, path: p };
        return { path: p, label: /\.(png|jpe?g|gif|webp|heic)$/i.test(p) ? attach({ ...it, url: docUrl(p) }, 'img') : attach(it, 'file') };
      });
      // 터미널 입력칸엔 이름표 바로 뒤 따옴표 경로로(그림은 이스케이프 따로 한 조각) — 조각 사이는 Claude 가 앞 붙여넣기를 다 읽게 조금 쉬고
      e.preventDefault();
      chipPastes(chips).forEach((t, i) => {
        const put = () => pane.dispatchEvent(new CustomEvent(DROP_EVENT, { detail: t }));
        if (i) window.setTimeout(put, 400 * i); else put();
      });
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
    setQueue(emptyQueue);
    setLimit(PAGE);
    if (!sessionId) return;
    let next: number | undefined;
    let alive = true;
    let busy = false;
    const tick = async () => {
      if (busy) return; // 앞 물음이 안 끝났으면 겹쳐 묻지 않는다(줄이 두 번 붙지 않게)
      busy = true;
      try {
        const c = await (readFn ?? readTranscript)(sessionId, next);
        if (!alive) return;
        // 0 이면 다음에도 '처음'으로(끝 1MB 부터) — from 0 은 상한 없이 기록 전체를 읽는다(처음 읽기를 못 했을 때)
        next = c.next || undefined;
        if (c.reset) { setItems(parseChat(c.text)); setQueue(applyQueueOps(emptyQueue, c.text)); }
        else if (c.text) { setItems((prev) => appendChat(prev, c.text)); setQueue((q) => applyQueueOps(q, c.text)); }
      } catch {
        // 다음 차례에 다시
      }
      busy = false;
    };
    void tick();
    const stop = every(() => void tick(), POLL_MS);
    return () => { alive = false; stop(); };
  }, [sessionId, readFn]);

  // 할 일 목록(터미널의 "N tasks …") — 2초마다. 접기·펴기는 이 컴퓨터에 기억
  const [tasks, setTasks] = useState<SessionTask[]>([]);
  useEffect(() => {
    setTasks([]);
    if (!sessionId || remote) return;
    let alive = true;
    const tick = () => void readSessionTasks(sessionId).then((t) => { if (alive) setTasks((p) => (JSON.stringify(p) === JSON.stringify(t) ? p : t)); }).catch(() => {});
    tick();
    const stop = every(tick, 2000);
    return () => { alive = false; stop(); };
  }, [sessionId]);
  const [hints, setHints] = useState(() => { try { return localStorage.getItem('chatHints') !== '0'; } catch { return true; } });
  const [tasksOpen, setTasksOpen] = useState(() => { try { return localStorage.getItem('chatTasksOpen') !== '0'; } catch { return true; } });

  useEffect(() => {
    if (!paneId) return;
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; text: string; at?: number }>).detail;
      if (d?.id === paneId) { setPending((p) => [...p, newPending(d.text, itemsRef.current, d.at ?? Date.now())]); stick.current = true; }
    };
    window.addEventListener('chat-pending', on);
    return () => window.removeEventListener('chat-pending', on);
  }, [paneId]);

  // 다시 붙으면 끊긴 동안 보낸 말은 지금 친 것으로 — 그 말은 붙는 순간 쳐지는데 보낸 시각이 옛것이면 기록이 오기 전에 '전달 안 됨'이 떴다
  const downAt = useRef<number | null>(null);
  useEffect(() => {
    if (link && link !== 'live') { downAt.current ??= Date.now(); return; }
    const d = downAt.current;
    downAt.current = null;
    // 80초(LINK_WAIT)를 넘겨 끊겼으면 줄에서 기다리던 말은 이미 포기됐다 — 그대로 두면 '전달 안 됨'으로 남아 다시 보낼 수 있다
    if (d != null) { const now = Date.now(); setPending((ps) => ps.map((p) => (p.at >= d - 1000 && now - p.at < LINK_WAIT ? resent(p, now) : p))); }
  }, [link]);
  const waiting = useMemo(() => waitingOf(pending, items, Date.now(), queue), [pending, items, queue]);
  // 기록에 들어간 것만 뺀다(그때 상태에서) — 렌더 때 계산한 waiting 으로 통째로 바꾸면 그사이 더한 새 말풍선이 지워졌다(2026-10-21 리뷰)
  useEffect(() => {
    if (waiting.length === pending.length) return;
    const gone = new Set(pending.filter((p) => !waiting.includes(p)));
    setPending((ps) => ps.filter((p) => !gone.has(p)));
  }, [waiting, pending]);
  // 일하는 도중 흡수된 말은 기록 줄이 끝내 안 읽혀도 몇 초 뒤 지운다(domain/chatQueue ABSORB_GRACE) — 그때 한 번 더 센다
  useEffect(() => {
    const left = absorbedLeft(pending, queue, Date.now());
    if (left === null) return;
    const t = window.setTimeout(() => setPending((p) => [...p]), left + 100);
    return () => window.clearTimeout(t);
  }, [pending, queue]);
  // / 명령은 4초 뒤 지우는데(domain/chat pendingLeft) 기록이 안 바뀌면 다시 셀 일이 없다 — 시계로 한 번 더 센다
  useEffect(() => {
    if (!pending.some((p) => p.text.trimStart().startsWith('/'))) return;
    const t = window.setTimeout(() => setPending((p) => [...p]), 4500);
    return () => window.clearTimeout(t);
  }, [pending]);

  // 뒤판(#img 칩 칠하는 층)을 입력칸 그대로 — 글꼴·여백·테두리·스크롤바 폭·스크롤. CSS 를 따로 두면 채팅 뷰 입력칸만 테두리 0 이 돼
  // 뒤판 글 폭이 2px 좁았고, 칸 끝에 걸린 줄이 뒤판에서만 한 번 더 꺾여 칩이 한 줄씩 밀렸다(2026-10-11 185·186.png)
  const syncBackdrop = useCallback(() => {
    const ta = input.current, bd = backdrop.current;
    if (!ta || !bd) return;
    const cs = getComputedStyle(ta);
    for (const [k, v] of Object.entries(backdropStyle((p) => cs.getPropertyValue(p), ta))) bd.style.setProperty(k, v);
    bd.scrollTop = ta.scrollTop;
    bd.scrollLeft = ta.scrollLeft;
  }, []);
  // 칸 폭이 바뀌면(채팅 칸 끌기·창 크기) 줄바꿈도 다시
  useEffect(() => {
    const ta = input.current;
    if (!ta) return;
    const ro = new ResizeObserver(syncBackdrop);
    ro.observe(ta);
    return () => ro.disconnect();
  }, [syncBackdrop]);
  // 입력칸은 글 높이만큼 늘어난다(줄바꿈 수로 세면 긴 한 줄이 두 줄에서 멈췄다 — 2026-09-30 사용자)
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    // 상한은 이 채팅 칸 높이의 45% — 창 높이로 재면 쌓기 보기의 작은 칸에서 입력칸이 칸을 넘어 아래가 잘렸다(2026-09-30)
    const room = root.current?.clientHeight ?? window.innerHeight;
    // 테두리는 실제 두께로 — 2px 를 늘 더하니 테두리 없는 채팅 뷰에선 한 줄 칸이 2px 커져 보내기 버튼이 아래로 쏠렸다(2026-10-02 사용자)
    const cs = getComputedStyle(el);
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    el.style.height = `${Math.min(el.scrollHeight + border, Math.max(60, Math.round(room * 0.45)))}px`;
    syncBackdrop();
    const l = list.current; // 입력칸이 커져 목록이 줄면 맨 아래가 가려졌다 — 그 자리에서 바로 내린다
    if (l && stick.current) l.scrollTop = l.scrollHeight;
  }, [draft, fontSize]);

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
  // 터미널에 뜬 선택 창 — 채팅에 버튼으로(2026-10-01 사용자 "cli 안 거치게")
  const [dialog, setDialog] = useState<ScreenDialog | null>(null);
  /** 늘리면 모델 칩 메뉴가 열린다(채팅에 /model 만 쳤을 때) */
  const [chipOpen, setChipOpen] = useState(0);
  const dialogRef = useRef<ScreenDialog | null>(null);
  dialogRef.current = dialog;
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
      const d = s ? screenDialog(s.lines) : null;
      setDialog((prev) => (JSON.stringify(prev) === JSON.stringify(d) ? prev : d));
      // 터미널 입력칸이 비면(보냈거나 지웠거나) 붙인 것도 비운다 — 한 번 빈칸으로 읽혔다고 지우면 썸네일이 사라지고 [Image #n] 만 남았다
      empties.current = t ? 0 : empties.current + 1;
      // 입력칸에 #file·#img 이름표가 남아 있거나 방금 붙였으면 아직 쓰는 중 — 번호를 1로 되돌리면 두 파일이 같은 @file1 이 됐다(2026-09-30 사용자)
      if (empties.current >= 4 && !/[#@](img|file)\d+/.test(draftRef.current) && Date.now() - lastAttach.current > 5000) { imgCount.current = 0; fileCount.current = 0; setAttached((a) => (a.length ? [] : a)); }
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
      if (!left || /\[Image #\d+\]/.test(left) || draftRef.current.trim() || dialogRef.current) return;
      submitTerminal();
      setPending((p) => [...p, newPending(left, itemsRef.current, Date.now())]);
      quietUntil.current = Date.now() + 1500;
    }, 4000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceStop]);

  const busy = chatBusy(state, items);
  const ctl = sendControls(busy, draft, termText);

  // 보낸 말이 지금 어디 있나 — 보내는 중·대기 중(Claude 대기열)·입력칸에 걸림·안 갔음(domain/chatQueue). 기록이 안 바뀌어도
  // '안 갔음'으로 넘어가게 보내는 중인 말이 있는 동안 1초마다 다시 센다
  const [clock, setClock] = useState(0);
  useEffect(() => {
    if (!waiting.length) return;
    const t = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [waiting.length]);
  const enterWait = Math.max(0, ...waiting.map((p) => enterDelay(p.text.length, IS_WIN)));
  const stateOf = new Map<number, PendingState>(waiting.map((p) => [p.at, pendingState(p, { queue, termText, now: Date.now(), enterWait, link })]));
  /** 지금 Esc 를 넘기면 방금 보낸 말이 거둬들여지나(domain/chat escUnsends) — 그땐 채팅 Esc·⌘Enter·지금 보내기가 Esc 를 안 넘긴다. ■ 멈춤 버튼은 그대로 */
  const unsendsNow = () => escUnsends(items, waiting.some((p) => stateOf.get(p.at) === 'sending' && absorbedAt(queue, p) === null)); // 흡수된 말은 이미 턴 안에 있다 — Esc 는 멈춤

  // 보낸 말이 Enter 없이 입력칸에 그대로 남았으면 Enter 를 다시(2초 그대로일 때, 같은 말에 세 번까지). 일하는 중이어도 —
  // 일하는 중 Enter 는 줄 서기다. 예전엔 쉴 때 한 번만 눌러, 일하는 중 걸린 말은 '보내는 중'으로 10분 남았다(2026-10-06 사용자)
  const tries = useRef<Record<number, number>>({});
  const [tryN, setTryN] = useState(0);
  const stuckTarget = state === 'blocked' || dialog || compacting || (link && link !== 'live') ? null
    : autoEnterTarget(waiting, { queue, termText, now: Date.now(), enterWait, tries: tries.current });
  useEffect(() => {
    if (!stuckTarget) return;
    const t = window.setTimeout(() => {
      if (stuckInInput([stuckTarget], termRef.current) !== stuckTarget || dialogRef.current) return; // 선택 창이 뜨면 Enter 가 창에서 골라 버린다
      const at = waiting.find((p) => p.text === stuckTarget)?.at ?? 0;
      tries.current[at] = (tries.current[at] ?? 0) + 1;
      submitTerminal();
      quietUntil.current = Date.now() + 1500;
      setTryN((n) => n + 1);
    }, 2000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stuckTarget, tryN]);

  // 입력칸에 남은 게 내가 보낸 말뿐인가 — 걸린 말·막 보내고 Esc 로 끊겨 되돌아온 말. 새 말을 치기 전에 비워 한 말로 붙어 가지 않게
  const recentMine = useMemo(() => mineForLeftover(sentByMe(items)), [items]);
  const knownRef = useRef<string[]>([]);
  knownRef.current = [...waiting.map((p) => p.text), ...recentMine];
  const leftover = termText ? inputLeftover(termText, knownRef.current) : null;
  // 거둬들여져 입력칸에 되돌아온 말 — 기록엔 보낸 말로 남았지만 참모는 못 받았다. 말풍선은 빼고 입력칸 줄(다시 보내기) 하나로만(2026-10-16 사용자 두 번 보임)
  const lastItem = items[items.length - 1];
  const rewound = lastItem?.kind === 'user' && leftover?.length === 1 && chatNorm(leftover[0]!) === chatNorm(lastItem.text) && escUnsends(items, false) ? lastItem : null;
  const liveItems = useMemo(() => (rewound ? items.filter((i) => i !== rewound) : items), [items, rewound]);
  const dropPending = (at: number) => setPending((ps) => ps.filter((x) => x.at !== at));
  // 방금 간 글을 또 보내려 하면 한 번 막는다 — 간 줄이 화면에 남아 보여 보내기를 계속 눌렀다(2026-10-10 사용자). 곧 한 번 더 누르면 보낸다
  const [dupWarn, setDupWarn] = useState<{ text: string; at: number } | null>(null);
  useEffect(() => {
    if (!dupWarn) return;
    const t = window.setTimeout(() => setDupWarn(null), DUP_CONFIRM);
    return () => window.clearTimeout(t);
  }, [dupWarn]);
  const dupBlocked = (text: string) => {
    const now = Date.now();
    if (againPlan(text, liveItems, now, dupWarn) === 'send') { setDupWarn(null); return false; }
    setDupWarn({ text, at: now });
    return true;
  };
  /** 다시 보낸 말은 보낸 시각을 새로 — 안 그러면 입력칸이 잠깐 비어 보이는 사이 '안 갔어요'가 떠 두 번 누르게 된다 */
  const repend = (p: { text: string; at: number; since?: number }) => setPending((ps) => [...ps.filter((x) => x.at !== p.at), resent(p, Date.now())]);
  /** 손으로 넣는 Enter 도 선택 창이 떠 있으면 안 넣는다 — 창에서 골라 버린다 */
  const enterOk = () => !dialogRef.current && state !== 'blocked';
  /** 입력칸을 비우고 → (first 가 있으면 그 말을 보내고) → 남길 말만 다시 넣는다(Enter 없이). 세션 쪽이 차례대로 친다 */
  const rebuildInput = (keep: string[], first?: string) => {
    clearTerminal([...termText].length + 20);
    if (first) send(first);
    if (keep.length && typeOnly) typeOnly(keep.join('\n'));
    quietUntil.current = Date.now() + 1500;
    setTermText('');
  };
  /** 새 말을 치기 전에 — 입력칸에 걸린 내 말이 하나면 먼저 보내고(보내려던 말이다), 되돌아온 말·여럿이면 비운다(말풍선에 남아 다시 보낼 수 있다).
   *  모르는 글(받아 적은 말·붙인 그림)은 그대로 — 그건 같이 가는 게 맞다 */
  const flushLeftover = (left = leftover, term = termText) => {
    if (!left) return;
    const mine = left.length === 1 ? waiting.find((p) => p.text === left[0]) : undefined;
    if (mine && stuckInInput(left, term) && enterOk()) { submitTerminal(); repend(mine); }
    else {
      clearTerminal([...term].length + 20);
      // 말풍선이 없는 것(끊겨서 되돌아온 말)은 '안 갔어요'로 남겨 다시 보낼 수 있게 — 조용히 지우지 않는다
      const now = Date.now();
      const back = left.filter((t) => !waiting.some((p) => p.text === t));
      if (back.length) setPending((ps) => [...ps, ...back.map((t, i) => ({ text: t, at: now - LOST_AFTER - 2000 + i, since: now }))]);
    }
    quietUntil.current = Date.now() + 1500;
    setTermText('');
  };
  // 줄 선 말 빼기 — Claude 의 ↑ 가 줄 선 말을 전부 입력칸으로 되돌린다(popAll). 되돌아오면 뺄 말만 빼고 나머지는 하나씩 다시 줄 세운다
  const removing = useRef<{ at: number; text: string; until: number } | null>(null);
  useEffect(() => {
    const r = removing.current;
    if (!r) return;
    if (Date.now() > r.until) { removing.current = null; return; }
    const back = queue.popped.some((q) => q.ts >= r.at - 10_000 && chatNorm(q.text) === chatNorm(r.text));
    if (!back || !leftover?.includes(r.text)) return;
    removing.current = null;
    // 다시 줄 세울 말은 입력칸에 실제로 되돌아온 것에서 — 누른 순간의 대기열(1초 늦음)로 정하면 그사이 나간 말이 또 갔다(리뷰)
    const others = keepAfterRemove(leftover, r.text);
    rebuildInput([]);
    dropPending(r.at);
    others.forEach((t) => send(t)); // 줄 세우기는 세션 쪽에서 앞 글 Enter 뒤로 차례대로(SessionGrid typeAndSend)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, termText, clock]);
  const act = (p: { text: string; at: number }, what: 'now' | 'drop' | 'again') => {
    const st = stateOf.get(p.at);
    if (what === 'again') { if (dupBlocked(p.text)) return; flushLeftover(); send(p.text); repend(p); return; }
    if (st === 'queued') {
      if (what === 'now') { if (busy && !unsendsNow()) sendQueuedNow(); return; } // 쉬고 있으면 Claude 가 곧 꺼내 보낸다 · 앞 말에 답이 없으면 줄 선 채로(Esc 가 앞 말을 거둬들인다)
      // ↑ 는 대기열이 비면 지난 말을 불러온다 — 일하는 중이고 그 말이 아직 줄에 있을 때만
      if (!rawKeys || !busy || termRef.current || !queue.waiting.some((q) => chatNorm(q.text) === chatNorm(p.text))) return;
      removing.current = { at: p.at, text: p.text, until: Date.now() + 4000 };
      void rawKeys(['\x1b[A']);
      return;
    }
    if (st === 'input') {
      // 입력칸에 이 말뿐이거나 모르는 글과 섞였으면 입력칸 그대로 보내기, 내 말 여럿이면 이 말만 따로 보내고 나머지는 입력칸에 되돌림
      if (what === 'now') {
        if (!enterOk()) return;
        if (!leftover || leftover.length === 1) { submitTerminal(); quietUntil.current = Date.now() + 1500; repend(p); return; }
        rebuildInput(keepAfterRemove(leftover, p.text), p.text);
        repend(p);
        return;
      }
      if (leftover) rebuildInput(keepAfterRemove(leftover, p.text));
    }
    dropPending(p.at);
  };

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
  const shown = liveItems.length > limit ? liveItems.slice(liveItems.length - limit) : liveItems;

  const submit = (now = false) => {
    // 멘션 칩(@가나 담당)은 진짜 SendMessage 이름 @[참모-3 · 가나 담당] 으로 풀어 보낸다 — 참모가 누구에게 전할지 헷갈리지 않게
    const text = withRefs(expandMentions(draft.trim(), who), refs);
    if (!text && termText && dupBlocked(termText)) return;
    quietUntil.current = Date.now() + 1500;
    if (!text && termText) { submitTerminal(); setPending((p) => [...p, newPending(termText, items, Date.now())]); stick.current = true; return; }
    if (!text) return;
    // /model·/effort 는 터미널 고르는 창 대신 칩으로 — 창은 보낸 Enter 가 바로 골라 기본값이 저장됐다(2026-10-01 시험)
    if (isMemoryCmd(text)) { setDraft(''); setSlashOff(''); openMemory(); return; }
    const mc = pickModel ? modelCommand(text) : null;
    if (mc && pickModel) {
      setDraft(''); setSlashOff('');
      if ('open' in mc) setChipOpen((n) => n + 1);
      else void pickModel(mc.want);
      return;
    }
    if (now) {
      // 끊고 바로 보내기 — 막 보낸 말을 Esc 로 끊으면 Claude 가 그 말을 입력칸에 되돌려 놓는다. 끊은 뒤 입력칸을 새로 읽어 정리하고 친다(리뷰)
      interrupt();
      window.setTimeout(() => {
        const s = screen?.();
        const t = s ? promptInput(s.lines, s.cursor) ?? '' : '';
        flushLeftover(t ? inputLeftover(t, knownRef.current) : null, t);
        send(text);
      }, 700);
    } else {
      flushLeftover();
      send(text);
    }
    setPending((p) => [...p, newPending(text, items, Date.now())]);
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

  // Esc = 하던 일 멈추기 — 입력칸이든 채팅 칸 안(말 목록·버튼·글 고른 채)이든 같은 판단(domain/chat chatEscStops, 2026-10-15 사용자)
  const escOverlay = () => popOpen || slashOpen || !!memList || !!dialog
    || !!root.current?.querySelector('.mc-pop, [role="listbox"], [role="menu"]') || !!document.querySelector('.od-back, .dash-preview');
  const escStops = (e: React.KeyboardEvent, inInput: boolean) => chatEscStops({
    key: e.key, composing: e.nativeEvent.isComposing, prevented: e.defaultPrevented, working: busy || state === 'working',
    overlay: e.key === 'Escape' && escOverlay(), inInput, review: !!document.querySelector('.cur-mode'), unsends: e.key === 'Escape' && unsendsNow(),
  });

  return (
    // tabIndex -1 — 글을 고른 채(입력칸으로 안 감)·말 목록을 누른 뒤에도 Esc 가 이 칸으로 온다
    <div className={`chat ${dropHot ? 'drop-hot' : ''}`} ref={root} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.target !== input.current && escStops(e, false)) { e.preventDefault(); interrupt(); } }}
      // 창 아무 데나 눌러도 입력칸으로 — 쌓기 보기에서 급할 때 입력칸 찾아 누르기 어려웠다(2026-09-30 사용자). 글 고르기·버튼·링크는 그대로
      onMouseUp={(e) => { const t = e.target as HTMLElement; if (clickFocusesInput({ interactive: !!t.closest('button, a, input, textarea, select, summary, [contenteditable="true"], [role="button"]'), selected: window.getSelection()?.toString() ?? '' })) input.current?.focus(); }}
      // 스페이스에서 끌어온 파일 — 끌어다 놓기와 똑같이 붙인다(터미널 입력칸에 경로 + #file·#img 이름표)
      onDragOver={(e) => { if (paneId && !remote && e.dataTransfer.types.includes(PATH_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!dropHot) setDropHot(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHot(false); }}
      onDrop={(e) => { const p = e.dataTransfer.getData(PATH_MIME); setDropHot(false); if (p && paneId && !remote) { e.preventDefault(); attachToChat(paneId, [p]); requestAnimationFrame(() => input.current?.focus()); } }}>
      {tasks.length > 0 && (() => {
        const c = taskCounts(tasks);
        const now = tasks.find((t) => t.status === 'in_progress');
        return (
          <div className={`chat-tasks ${tasksOpen ? 'open' : ''}`}>
            <button className="chat-tasks-head" aria-expanded={tasksOpen} onClick={() => setTasksOpen((o) => { try { localStorage.setItem('chatTasksOpen', o ? '0' : '1'); } catch { /* 기억 못 해도 된다 */ } return !o; })}>
              <b>{tr(`할 일 ${tasks.length}`, `${tasks.length} tasks`)}</b>
              <span className="dim">{tr(`끝남 ${c.done} · 진행 ${c.doing} · 남음 ${c.open}`, `${c.done} done · ${c.doing} in progress · ${c.open} open`)}</span>
              {!tasksOpen && now && <span className="chat-tasks-now">{now.activeForm || now.subject}</span>}
              <span className="chat-tasks-fold" aria-hidden>{tasksOpen ? <IconChevronUp /> : <IconChevronDown />}</span>
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
        {/* 끼울 것(직접 답하기 카드)을 시각 순으로 말풍선 사이에 — 답을 기다리는 카드(pin)는 맨 아래(domain/chatExtras) */}
        {interleave(shown, extra).map((x) => ('item' in x
          ? <Bubble key={`${x.item.kind}:${x.item.id}`} it={x.item} by={paneId ?? ''} onRef={stableRef} />
          : <div key={x.extra.key}>{x.extra.node}</div>))}
        {waiting.map((p) => {
          const st = stateOf.get(p.at) ?? 'sending';
          // 줄 선 말 빼기는 ↑(줄 선 말 전부 입력칸으로)를 쓰니, 대기열이 다 이 채팅이 보낸 말이고 입력칸이 빌 때만 —
          // 다른 세션 말까지 입력칸에 쏟아지고, 입력칸에 글이 있으면 ↑ 는 그 안에서 커서만 옮긴다
          const canDrop = st === 'input' ? !!leftover?.includes(p.text) // 모르는 글과 섞였으면 그 말만 뺄 수 없다 — 입력칸 줄의 빼기로
            : st !== 'queued' || (!!rawKeys && busy && !termText && queue.waiting.every((q) => waiting.some((w) => chatNorm(w.text) === chatNorm(q.text))));
          return (
            <div key={p.at} className="chat-row me">
              <div className={`bubble me pending st-${st}`}>
                <AtText text={splitRefs(p.text).body} />
                <span className="chat-meta">{{
                  sending: tr('보내는 중', 'Sending'),
                  queued: tr('대기 중 — 지금 도구가 끝나면 가요', 'Queued — goes in when the current tool finishes'), // 일하는 도중엔 도구 사이에 들어간다 — '일이 끝나면'은 안 간 것처럼 읽혔다(2026-10-21 사용자)
                  input: tr('입력칸에 걸려 있어요', 'Stuck in the terminal input'),
                  lost: tr('전달 안 됨', 'Not delivered'),
                  wait: tr('다시 붙는 중 — 붙으면 보내요', 'Reattaching — sends when it is back'),
                }[st]}</span>
                {pendAct(st) && link !== 'gone' && ( /* 끊긴 채면 다시 보내도 줄에서 기다리다 붙는 순간 두 번 간다 — 안내 줄이 '다시 켜지면 다시 보내 줘' */
                  <span className="chat-pend-acts">
                    {pendAct(st) === 'again'
                      ? <IconButton size="s" tone="line" label={tr('다시 보내기', 'Send again')} onClick={() => act(p, 'again')}><IconRefresh /></IconButton>
                      : <IconButton size="s" tone="line" label={tr('지금 보내기', 'Send now')} title={st === 'queued' ? tr('지금 보내기 — 하던 일을 멈추고 이 말을 바로 보낸다', 'Send now — interrupt and send this now') : undefined} onClick={() => act(p, 'now')}><IconSend /></IconButton>}
                    {canDrop && <IconButton size="s" tone="line" label={tr('빼기', 'Remove')} onClick={() => act(p, 'drop')}><IconClose /></IconButton>}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        </div>
      </div>
      {away && <button className="chat-bottom" onClick={toBottom} aria-label={tr('맨 아래로', 'Jump to latest')} title={tr('맨 아래로', 'Jump to latest')}><IconChevronDown /></button>}
      {dialog && rawKeys && <ChatDialog d={dialog} keys={rawKeys} read={() => { const s = screen?.(); return s ? screenDialog(s.lines) : null; }} onTerminal={onTerminal} />}
      {/* 상태 줄 — 목록 끝에 두면 스크롤에 가려 작업 중인지 몰랐다(2026-09-30 사용자). 입력칸 바로 위에 늘 */}
      {(state === 'blocked' || busy || compacting || ctx !== undefined || modelInfo?.model) && (
        <div className="chat-status">
          {compacting ? (
            <span className="chat-compact"><span className="spin" />{tr('대화 압축 중 — 앞 대화를 요약하고 있어요', 'Compacting — summarizing earlier conversation')}</span>
          ) : state === 'blocked' && !(dialog && rawKeys) ? (
            <><span>{tr('터미널에서 선택을 기다리고 있어요', 'Waiting for a choice in the terminal')}</span>{!remote && <IconButton className="chat-ic-pill" label={tr('터미널로 보기', 'Show terminal')} onClick={onTerminal}><IconTerminal /></IconButton>}</>
          ) : busy ? (
            <><span className="spin" /><span>{tr('작업 중', 'Working')}{lastTool ? ` · ${lastTool}` : ''}</span></>
          ) : null}
          {modelInfo?.model && pickModel && (() => {
            const lockedWhy = termText ? tr('터미널 입력칸에 쓰던 글이 있어서 못 바꿔요 — 먼저 보내거나 지워 주세요', 'There is text in the terminal input — send or clear it first')
              // 일하는 중에도 바꾼다 — /model·/effort 는 일하는 중에도 바로 먹는다(2026-10-01 실측). 압축 중만 막는다
              : compacting ? tr('대화를 줄이는 중이라 못 바꿔요 — 끝나면 바꿔 주세요', "Can't change while compacting") : state === 'blocked' ? tr('터미널에서 선택을 기다리는 중이라 못 바꿔요', 'Waiting for a choice in the terminal') : undefined;
            return <ModelChip info={modelInfo} pick={pickModel} locked={!!lockedWhy} lockedWhy={lockedWhy} openSignal={chipOpen} />;
          })()}
          {ctx !== undefined && <CtxRing used={ctx} />}
        </div>
      )}
      {((termText && !stuckInInput(waiting.map((p) => p.text), termText)) || attached.length > 0) && (
        <div className="chat-term" title={leftover
          ? tr('보냈다가 멈춰서 입력칸으로 돌아온 말 — 새 말을 보내면 지우고 보낸다', 'Came back to the input after an interrupt — cleared when you send a new message')
          : tr('터미널 입력칸에 들어가 있는 것 — 보내기(Enter)하면 같이 간다', 'Already in the terminal input — goes out with your next send')}>
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
          {leftover?.length === 1 && <IconButton size="s" tone="line" label={tr('다시 보내기', 'Send again')} onClick={() => { if (!enterOk()) return; const t = leftover[0]!; if (dupBlocked(t)) return; const now = Date.now(); submitTerminal(); quietUntil.current = now + 1500; setTermText(''); setPending((p) => [...p, { text: t, at: now, since: now }]); }}><IconRefresh /></IconButton>}
          <IconButton size="s" tone="line" label={tr('빼기', 'Remove')} title={tr('빼기 — 터미널 입력칸에 붙인 것 전부', 'Remove everything attached in the terminal input')} onClick={clearAttached}><IconClose /></IconButton>
        </div>
      )}
      {dupWarn && (
        <div className="chat-hint chat-dup" role="status">
          <span>{tr('방금 이미 간 말이에요 — 또 보내려면 한 번 더 눌러 주세요', 'This was just sent — press again to send it once more')}</span>
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
              <IconButton size="s" tone="line" label={tr('빼기', 'Remove')} onClick={() => dropRef(r.label)}><IconClose /></IconButton>
            </span>
          ))}
        </div>
      )}
      {memList && (
        <div className="chat-mention chat-slash chat-mem" role="listbox" aria-label={tr('메모리 문서', 'Memory files')} onKeyDown={(e) => { if (e.key === 'Escape') { setMemList(null); input.current?.focus(); } }}>
          {memList.length === 0 && <div className="dim chat-mem-empty">{tr('CLAUDE.md·메모리 문서가 아직 없어요', 'No CLAUDE.md or memory files yet')}</div>}
          {memList.map((m, i) => (
            <button key={m.path} role="option" aria-selected={false} autoFocus={i === 0} onClick={() => openDoc(m.path)} title={m.path}>
              <b>{memoryLabel(m.kind)}</b><span className="dim">{m.path.replace(/^.*?(\/[^/]+\/[^/]+)$/, '…$1')}</span>
            </button>
          ))}
          <button className="chat-mem-close" onClick={() => { setMemList(null); input.current?.focus(); }} aria-label={tr('닫기', 'Close')} title={tr('닫기', 'Close')}><IconClose /></button>
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
      {popOpen && (
        <div className="chat-mention chat-slash chat-pop" role="listbox">
          {popItems.map((it, i) => (
            <button key={it.key} role="option" aria-selected={i === popAt} className={`${i === popAt ? 'on' : ''}${it.off ? ' off' : ''}`} title={it.title} onMouseEnter={() => setPopSel(i)}
              onMouseDown={(e) => { e.preventDefault(); it.pick(); }}>
              {it.pic}<b>{it.main}</b>{it.sub && <span className="dim">{it.sub}</span>}{i === popAt && <span className="dim key">Tab</span>}
            </button>
          ))}
        </div>
      )}
      {notice && <div className="chat-wake" role="status">{notice}</div>}
      <div className="chat-input">
        <div className="chat-field">
        {/* 입력칸 뒤에 같은 글을 깔아 #img1·#file1·@참모 자리만 칠한다 — textarea 는 글자를 따로 꾸밀 수 없다 */}
        <div className="chat-backdrop" ref={backdrop} aria-hidden>{atMarks(draft, who)}{'\n'}</div>
        <textarea
          onScroll={syncBackdrop}
          ref={input}
          value={draft}
          rows={1}
          placeholder={tr('메시지 — Enter 보내기, Shift+Enter 줄바꿈', 'Message — Enter to send, Shift+Enter for a new line')}
          onChange={(e) => { setDraft(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onFocus={onInputFocus}
          onKeyDown={(e) => {
            // # 고르기·@ 멘션 목록이 떠 있으면: ↑↓ 고르기, Tab·Enter 넣기, Esc 닫기(하던 일 멈추기보다 먼저)
            if (popOpen && !e.nativeEvent.isComposing) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setPopSel((popAt + (e.key === 'ArrowDown' ? 1 : popItems.length - 1)) % popItems.length); return; }
              if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'Enter' && !e.shiftKey && !modKey(e, IS_WIN))) { e.preventDefault(); popItems[popAt]?.pick(); return; }
              if (e.key === 'Escape') { e.preventDefault(); setPopOff(draft); return; }
            }
            // / 자동완성이 떠 있으면: ↑↓ 고르기, Tab·Enter 채우기, Esc 닫기 — 터미널 Claude 와 같은 손버릇
            if (slashOpen && !e.nativeEvent.isComposing) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSlashSel((i) => (i + (e.key === 'ArrowDown' ? 1 : slashList.length - 1)) % slashList.length); return; }
              // 이미 다 친 이름(/model)에서 Enter 는 보내기 — 비슷한 이름이 더 있으면 채우기만 해서 Enter 를 두 번 눌러야 했다(2026-10-01 시험)
              const exact = slashList[slashSel]!.name === slashQ;
              if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'Enter' && !e.shiftKey && !modKey(e, IS_WIN) && !exact)) { e.preventDefault(); slashFill(slashList[slashSel]!.name); return; }
              if (e.key === 'Escape') { e.preventDefault(); setSlashOff(draft); return; }
            }
            // Enter = 보내기(일하는 중이면 줄 서 있다가 중간에 들어간다), ⌘Enter = 끊고 바로 보내기(2026-09-30 사용자)
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              // 입력칸이 빈 채로 ⌘Enter + 줄 서 있는 말이 있으면 그 말을 바로(멈추면 Claude 가 곧바로 보낸다)
              // 보낸 말에 아직 답이 없으면 끊지 않고 그냥 보낸다 — Esc 가 앞 말을 거둬들여 참모에게 안 간다(domain/chat escUnsends)
              const cut = modKey(e, IS_WIN) && busy && !unsendsNow();
              if (cut && !draft.trim() && !termText && waiting.length) { sendQueuedNow(); return; }
              submit(cut);
            }
            // Esc = CLI 처럼 하던 일 멈추기(일하는 중일 때만 — 2026-09-30 사용자)
            // 일하는 중일 때만 넘긴다 — 쉴 때 Esc 두 번은 Claude 의 되감기 창·입력칸 지우기라 걸린 말이 흔적 없이 지워졌다(2026-10-06).
            // 보내는 중인 말이 있다는 것만으론 안 넘긴다. 연타(1.5초 안)는 세션 쪽이 거른다 — 그래서 상태가 working 이면 넘겨도 두 번이 안 된다
            else if (escStops(e, true)) { e.preventDefault(); interrupt(); }
            // 터미널에서처럼 Ctrl+V = 클립보드 그림(맥만 — 윈도우 Ctrl+V 는 글 붙여넣기, 그림은 onPaste 가 받는다)
            else if (!remote && !IS_WIN && e.ctrlKey && !e.metaKey && (e.key === 'v' || e.key === 'ㅍ')) { e.preventDefault(); pasteImage(); }
          }}
          onPaste={(e) => {
            // ⌘V 인데 클립보드에 그림이 있으면 글 대신 그림을 터미널 입력칸으로 — Claude 가 [Image #n] 으로 받는다
            // 웹뷰가 클립보드 그림을 파일로 안 넘겨줄 때가 있다 — 붙일 글이 없으면 그림으로 보고 터미널로(아무것도 안 들어갔다, 2026-09-30)
            if (remote) return; // 원격엔 그림을 넘길 터미널이 없다 — 글만
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
        {voice && <button className={`btn chat-voice${voice.on ? ' on' : ''}`} onClick={voice.toggle} aria-label={tr('음성 모드', 'Voice mode')} aria-pressed={voice.on}
          title={voice.on ? tr(`음성 모드 켜짐 — ${assistant()}가 답하면 소리로 읽어줘 (눌러서 끄기)`, `Voice mode on — ${assistant()}'s replies are read aloud (click to turn off)`) : tr(`음성 모드 — ${assistant()} 답을 소리로 (눌러서 켜기)`, `Voice mode — read ${assistant()}'s replies aloud (click to turn on)`)}><IconSpeaker /></button>}
        {ctl.stop && !remote && <button className="btn chat-stop" onClick={interrupt} aria-label={tr('멈춤', 'Stop')} title={tr('멈춤 — Esc 를 보내 하던 일을 멈춘다', 'Stop — send Esc to interrupt')}><IconStop /></button>}
        <button className="btn chat-send" disabled={!ctl.canSend} onClick={() => submit()} aria-label={tr('보내기', 'Send')} title={tr('보내기 (Enter) · 끊고 보내기 (⌘Enter)', 'Send (Enter) · Interrupt & send (⌘Enter)')}><IconEnter /></button>
      </div>
    </div>
  );
}

/** # 고르기·@ 멘션 목록 한 줄 */
type PopItem = { key: string; main: string; sub?: string; off?: boolean; title?: string; pic?: React.ReactNode; pick: () => void };

const hhmm = (ts: string) => { const d = new Date(ts); return Number.isNaN(d.getTime()) ? '' : ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
/** 말풍선 옆 "참조" — 누르면 입력칸에 #chatN. '참모에게 보내기'(SendToOrch)와 같은 뜻이라 같은 참모 색 말풍선(2026-10-12 사용자 208.png — 클립이었다) */
type MemoryFile = { kind: 'user' | 'project' | 'local' | 'memory'; path: string };

const RefBtn = ({ onClick }: { onClick: () => void }) => (
  <IconButton size="s" className="chat-refbtn send-orch" label={tr('이 말풍선을 입력칸에 #참조로 넣기', 'Reference this bubble in the input')} title={tr('이 말풍선을 입력칸에 #참조로 넣기', 'Reference this bubble in the input')} onClick={(e) => { e.stopPropagation(); onClick(); }}><IconChatSend /></IconButton>
);

const Bubble = memo(function Bubble({ it, by, onRef }: { it: ChatItem; by: string; onRef: (who: string, text: string) => void }) {
  if (it.kind === 'user') {
    const { body, refs } = splitRefs(it.text);
    return (
      <div className="chat-row me">
        <RefBtn onClick={() => onRef(tr(`내 말${hhmm(it.ts)}`, `Me${hhmm(it.ts)}`), body)} />
        <div className="bubble me">
          {it.images && <div className="chat-thumbs">{it.images.map((src, i) => <Thumb key={i} src={src} by={by} label={`${REF_PREFIX}img${i + 1}`} />)}</div>}
          {splitPaths(body).map((x, i) => ('text' in x ? <AtText key={i} text={x.text} /> : <button type="button" key={i} className="chat-file" title={x.path} onClick={() => void openChatFile(x.path, by)}><IconFile />{x.name}</button>))}
          {refs.map((r) => <div key={r.label} className="chat-quote" title={r.text}><span className="at-chip">{r.label}</span> <span className="dim">{r.who}</span><div className="q">{r.text}</div></div>)}
        </div>
      </div>
    );
  }
  if (it.kind === 'assistant') return <div className="chat-row"><div className="bubble md" dangerouslySetInnerHTML={{ __html: md(it.text) }} /><RefBtn onClick={() => onRef(tr(`답${hhmm(it.ts)}`, `Reply${hhmm(it.ts)}`), it.text)} /></div>;
  if (it.kind === 'note') return it.out ? <CmdOut name={it.text} out={it.out} /> : <div className="chat-note">{it.text}</div>;
  if (it.kind === 'relay') return <div className="chat-row relay"><Relay from={it.from} text={it.text} /><RefBtn onClick={() => onRef(it.from === '앱' ? tr('앱이 전함', 'From the app') : tr(`${it.from} 세션`, it.from), it.text)} /></div>;
  const last = it.tools[it.tools.length - 1]!;
  return (
    <details className="chat-tools">
      <summary>{tr(`도구 ${it.tools.length}번`, `${it.tools.length} tool calls`)} <span className="dim">— {last.name} {last.target}</span></summary>
      <ul>{it.tools.map((t, i) => <li key={i}><b>{t.name}</b> {t.target}</li>)}</ul>
    </details>
  );
});

/** 명령 결과(/context·/cost 등) — 고정폭 글, 길면 접어 두고 화살표로 펼치기 */
function CmdOut({ name, out }: { name: string; out: string }) {
  const [open, setOpen] = useState(false);
  const long = out.split('\n').length > 12;
  return (
    <div className={`chat-cmd ${long && !open ? 'clip' : ''}`}>
      {name && <div className="chat-cmd-name">{name}</div>}
      <pre>{out}</pre>
      {long && <button className={`chat-cmd-fold ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)} aria-label={open ? tr('접기', 'Collapse') : tr('펼치기', 'Expand')} title={open ? tr('접기', 'Collapse') : tr('펼치기', 'Expand')}><IconChevron /></button>}
    </div>
  );
}

/** /memory 목록 이름 — 어느 범위 파일인지 */
const memoryLabel = (k: MemoryFile['kind']) =>
  k === 'user' ? tr('내 CLAUDE.md — 모든 프로젝트', 'My CLAUDE.md — all projects')
  : k === 'project' ? tr('프로젝트 CLAUDE.md', 'Project CLAUDE.md')
  : k === 'local' ? tr('CLAUDE.local.md — 나만', 'CLAUDE.local.md — just me')
  : tr('자동 메모리', 'Auto memory');

/** 말풍선 속 그림 — 누르면 show 가 여는 곳(채팅 뷰는 스페이스 탭, 터미널 뷰는 리더)에 크게(2026-10-19 사용자 — 예전엔 제자리에서 크게) */
function Thumb({ src, by, label }: { src: string; by: string; label: string }) {
  return (
    <span className="chat-att">
      <img className="chat-thumb" src={src} alt={label} onClick={() => void openChatFile(src, by)} />
      <em>{label}</em>
    </span>
  );
}

/** 입력칸 뒤판 — #img1·#file1(옛 @img1) 자리만 칠한 같은 글. 글자는 하나도 바꾸지 않는다(줄바꿈이 입력칸과 같아야 칠한 자리가 맞는다) */
function atMarks(text: string, who: MentionWho[]) {
  return splitTokens(text, who).map((t, i) => (typeof t === 'string' ? t : <mark key={i} className="at">{'ref' in t ? t.ref : 'live' in t ? t.live : `@[${t.mention}]`}</mark>));
}
/** 말풍선 글 — #img1·#file1 을 칩으로, 보낸 멘션 @[참모-3 · 가나 담당] 은 화면 이름 칩으로 */
function AtText({ text }: { text: string }) {
  return <>{splitTokens(text).map((t, i) => (typeof t === 'string' ? t
    : 'mention' in t ? <span key={i} className="at-chip at-who" title={t.mention}>@{sentMentionLabel(t.mention)}</span>
    : <span key={i} className="at-chip">{'ref' in t ? t.ref : t.live}</span>))}</>;
}

/** 다른 세션이 보낸 말·앱이 넘긴 줄 — 가운데 카드, 보낸 쪽 이름. 길면 여섯 줄까지, 누르면 펼침.
 *  앱이 넘긴 줄([앱] …)은 사람에게 하는 말이 아니라 참모에게 가는 일이라 작은 회색 한 줄(알림 N1, 2026-10-11) */
function Relay({ from, text }: { from: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`chat-relay ${from === '앱' ? 'app' : ''} ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)} title={open ? tr('접기', 'Collapse') : tr('펼치기', 'Expand')}>
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
