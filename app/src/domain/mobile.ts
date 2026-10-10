// 폰 화면 판단 — 예약 담당 참모, 세션 목록에 붙은 컨텍스트, 그림 붙여 보내기 글. 화면·통신 없음
import { josa, machine, tr } from '../i18n';
import { askView, summarizeTranscript } from './activity';
import { chatBusy, splitPaths, type ChatItem } from './chat';
import { parseCtx, type Ctx } from './ctx';
import { dropText } from './drop';
import { findTarget } from './inbox';
import type { Session } from './session';
import { displayName, shownName, splitOrchName, withNick } from './orchLabel';
import { groupByProject, orchestratorLike } from './session';
import { homeRows, resumedOrch, type HomeRow } from './orchHome';
import { heldBy, holderMap } from './spaceNav';
import { parseStopped, resumable, stoppedOrchs } from './stopped';
import { foldTasks, splitCards, type TaskCard, type TaskEvent } from './tasks';
import { asksUser } from './status';
import { parseUsage } from './usage';

/** 예약 판을 열면 채팅이 따라갈 참모 — 이름에 '루틴'이 든 참모, 없으면 마지막으로 쓴 참모, 그것도 없으면 맨 앞(2026-10-02 참모-2 결정) */
export function routineOrch(orchs: { id: string; name: string }[], lastUsed: string | null): string | undefined {
  return (orchs.find((s) => s.name.includes('루틴')) ?? orchs.find((s) => s.id === lastUsed) ?? orchs[0])?.id;
}

/** /api/sessions 는 세션마다 그 ctx 파일 내용을 "ctx" 칸에 붙여 준다 → sessionId 별 컨텍스트 */
export function ctxFromAgents(json: string): Record<string, Ctx> {
  try {
    const list = JSON.parse(json) as { ctx?: unknown }[];
    return Array.isArray(list) ? parseCtx(list.filter((a) => a.ctx).map((a) => JSON.stringify(a.ctx))) : {};
  } catch {
    return {};
  }
}

/** 붙인 그림 경로 + 글 — 데스크톱 끌어 놓기(dropText)와 같은 모양이라 비서가 경로로 받아 읽는다 */
export const withAttachments = (text: string, paths: string[]) => `${dropText(paths)}${text}`.trim();

/** 폰이 올린 첨부 — 서버가 지은 이름 꼴(<데이터>/attach/<숫자>-phone.<확장자>, Rust mobile_files::phone_attach 와 같은 꼴) */
const PHONE_ATTACH = /\/attach\/\d+-phone\.(png|jpe?g|gif|webp|pdf|md|txt)$/;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/;
export type PhoneAtt = { path: string; label: string; image: boolean };

/** 폰이 보낸 말(withAttachments 모양) → 글 + 첨부. 첨부는 붙인 차례대로 @img1·@file1(데스크톱 입력칸 이름표와 같은 셈) */
export function phoneBubble(text: string): { body: string; atts: PhoneAtt[] } {
  const atts: PhoneAtt[] = [];
  let img = 0, file = 0;
  const body = splitPaths(text)
    .map((x) => {
      if ('text' in x || !PHONE_ATTACH.test(x.path)) return 'text' in x ? x.text : x.path;
      const image = IMAGE_EXT.test(x.path);
      atts.push({ path: x.path, label: image ? `@img${++img}` : `@file${++file}`, image });
      return '';
    })
    .join('');
  return atts.length ? { body: body.replace(/^\s+/, '').replace(/ {2,}/g, ' ').trim(), atts } : { body: text, atts };
}

/** 칩을 빼면 입력칸에서 그 이름표(+뒤 공백 하나)도 — @img1 을 빼도 @img10 은 남는다 */
export const dropLabel = (draft: string, label: string) => draft.replace(new RegExp(`${label}(?!\\d) ?`), '');


/** 채팅 시트 높이 — 살짝(손잡이+한 줄+입력칸, 화면이 잰 값)·반(화면 65%)·전체(위 24px 남김). 값은 시트 윗변 y.
 *  살짝은 고정값이면 그림 칩·여러 줄 입력이 생길 때 입력줄이 화면 밖으로 밀렸다(2026-10-02 사용자 실기기) — 잰 높이를 받되 반보다 크진 않게 */
export type Snap = 'peek' | 'half' | 'full';
export const PEEK_H = 128;
export function sheetTop(snap: Snap, viewport: number, peekH = PEEK_H): number {
  const half = Math.round(viewport * 0.35);
  if (snap === 'peek') return Math.max(half + 1, viewport - peekH);
  if (snap === 'half') return half;
  return 24;
}


/** 그 참모가 시킨 일(send.from) — 펼치면 물어봄 → 일하는 중 → 오늘 끝남(시안 v2 S). 주인 잃은 일·밀린 일은 폰에선 뺀다 */
export function orchTasks(events: TaskEvent[], sessions: Session[], orchId: string, now: number): { ask: TaskCard[]; doing: TaskCard[]; done: TaskCard[] } {
  const mine = new Set(events.filter((e) => e.type === 'send' && e.from === orchId).map((e) => e.task));
  const { active, doneToday } = splitCards(foldTasks(events, sessions).filter((c) => mine.has(c.id)), now);
  return { ask: active.filter((c) => c.status === 'needsInput'), doing: active.filter((c) => c.status !== 'needsInput'), done: doneToday };
}

/** 접힌 한 줄 — "시킨 일 4 · 물음 1 · 일함 2" */
export function foldSummary(g: { ask: TaskCard[]; doing: TaskCard[]; done: TaskCard[] }): string {
  const working = g.doing.filter((c) => c.status === 'working').length;
  return [`시킨 일 ${g.ask.length + g.doing.length + g.done.length}`, g.ask.length ? `물음 ${g.ask.length}` : '', working ? `일함 ${working}` : ''].filter(Boolean).join(' · ');
}

/** 그 참모가 잡고 있는 세션 id(마지막으로 일을 보낸 참모가 잡는다) — 파일 카드에 그 세션들이 보여 준 파일도 모은다 */
export function heldIds(events: TaskEvent[], sessions: Session[], orchId: string, now: number): string[] {
  // 세션 id 로 모아 마지막 참모만 — 이름·번호로 따로 보낸 세션이 넘겨준 참모에게도 남지 않게(holderMap). 다른 참모 목록을 모르니 보낸 사람 전부를 후보로
  const orchs = [...new Set(events.filter((e) => e.type === 'send' && e.from).map((e) => e.from!))];
  if (!orchs.includes(orchId)) orchs.push(orchId);
  const m = holderMap(events, orchs, (t) => findTarget(sessions, t)?.id, now);
  const order = heldBy(events, orchId, now).map((t) => findTarget(sessions, t)?.id);
  return [...new Set(order.filter((x): x is string => !!x && x !== orchId && !!m.get(x)?.includes(orchId)))];
}

/** 사용량 칩 — "5시간 62% · 주 40%"(남은 %) */
export function usageText(json: string, now: number): string {
  const u = parseUsage(json, now);
  return [u.five ? `5시간 ${u.five.left}%` : '', u.week ? `주 ${u.week.left}%` : ''].filter(Boolean).join(' · ');
}

/** 그 참모가 사용자에게 묻고 멈췄나 — 마지막 말이 묻는 답(asksUser)이고 일하는 중이 아니면 결론·질문(askView, 결정 대기함과 같은 판단) */
export function orchAsk(items: ChatItem[], state: Session['state']): { ts: string; lead: string; q: string } | null {
  if (state === 'working') return null;
  const last = [...items].reverse().find((it) => it.kind === 'user' || it.kind === 'assistant');
  if (last?.kind !== 'assistant' || !asksUser(last.text)) return null;
  return { ts: last.ts, ...askView(last.text) };
}

/** taskId = decide 의 작업 id — 폰에서 답하면 그 일에 answer 를 남겨 카드가 빠진다(/api/task-answer) */
export type Waiting = { orch: string; name: string; kind: 'ask' | 'blocked' | 'decide'; ts: string; q: string; lead?: string; taskId?: string };

/** 사용자 답을 기다리는 것 — 참모 답 끝 질문(asks: 참모 id → orchAsk) · 확인창·선택지에서 멈춤 · scripts/task ask(답 받을 참모 = to). 최근 위.
 *  하위 세션 물음은 참모가 대신 답하니 넣지 않는다(시안 v3 전제) */
export function waitingList(orchs: Session[], asks: Record<string, { ts: string; lead: string; q: string } | null>, events: TaskEvent[]): Waiting[] {
  const out: Waiting[] = [];
  for (const o of orchs) {
    const a = asks[o.id];
    if (a) out.push({ orch: o.id, name: o.name, kind: 'ask', ts: a.ts, q: a.q, ...(a.lead ? { lead: a.lead } : {}) });
    if (o.state === 'blocked') out.push({ orch: o.id, name: o.name, kind: 'blocked', ts: '', q: `확인창·선택지에서 멈춰 있어요 — ${machine()}에서 열어 골라 주세요` });
  }
  const last = new Map<string, TaskEvent>();
  for (const e of events) if (e.type !== 'send') last.set(e.task, e);
  for (const e of last.values()) {
    if (e.type !== 'ask' || !e.note) continue;
    const o = findTarget(orchs, e.to);
    if (o) out.push({ orch: o.id, name: o.name, kind: 'decide', ts: e.ts, q: e.note, taskId: e.task });
  }
  return out.sort((x, y) => (x.ts < y.ts ? 1 : x.ts > y.ts ? -1 : 0));
}

/** 이보다 빠르게(px/ms) 놓으면 플릭 — 거리와 상관없이 그 방향 다음 높이 */
export const FLICK = 0.35;
const ORDER: Snap[] = ['full', 'half', 'peek']; // 윗변이 작은 순

/** 끌다 놓을 때 붙을 높이(2026-10-02 사용자 "꽤 많이 끌어야 열리고 닫힌다") — v 는 놓을 때 속도(px/ms, 아래가 +).
 *  ① 플릭이면 그 방향 다음 높이 ② 아니면 다음 높이까지 거리의 25% 와 40px 중 작은 쪽을 넘었을 때만 움직이고,
 *  그 방향 높이들 중 놓은 곳에서 가장 가까운 데로(길게 끌면 두 칸도) ③ 못 넘었으면 그대로 */
export function releaseSnap(from: Snap, startTop: number, endTop: number, v: number, viewport: number, peekH = PEEK_H): Snap {
  const i = ORDER.indexOf(from);
  if (Math.abs(v) >= FLICK) return ORDER[Math.min(ORDER.length - 1, Math.max(0, i + (v > 0 ? 1 : -1)))]!;
  const d = endTop - startTop;
  const dir = d > 0 ? 1 : -1;
  const nb = i + dir;
  if (d === 0 || nb < 0 || nb >= ORDER.length) return from;
  const at = (x: Snap) => sheetTop(x, viewport, peekH);
  const gap = Math.abs(at(ORDER[nb]!) - at(from));
  if (Math.abs(d) < Math.min(gap * 0.25, 40)) return from;
  const ahead = dir > 0 ? ORDER.slice(nb) : ORDER.slice(0, nb + 1);
  return ahead.reduce((a, b) => (Math.abs(at(b) - endTop) < Math.abs(at(a) - endTop) ? b : a));
}

/** 끝(살짝 아래·전체 위)을 넘어 끌면 약한 고무줄 — 넘은 만큼의 35% 만 따라온다. 그 안에선 손가락과 1:1 */
export function rubberTop(raw: number, viewport: number, peekH = PEEK_H): number {
  const min = sheetTop('full', viewport);
  const max = sheetTop('peek', viewport, peekH);
  if (raw < min) return min - (min - raw) * 0.35;
  if (raw > max) return max + (raw - max) * 0.35;
  return raw;
}

/** 키보드가 떠 있나 — 같은 폭에서 본 가장 큰 보이는 높이보다 150px 넘게 작으면. 폭이 바뀌면(돌리면) 기준을 새로.
 *  iOS 26 사파리는 innerHeight 도 키보드와 같이 줄어 기준이 못 된다(2026-10-02 시뮬레이터) — 그래도 안 줄 때가 있어(키보드를 연 채 돌리면 새 기준이
 *  키보드 높이라 못 알아봤다, 2026-10-04) 레이아웃 높이(layoutH = innerHeight)보다 150px 넘게 작아도 키보드 */
export function keyboardOpen(tallest: { w: number; h: number }, w: number, h: number, layoutH = 0): { tallest: { w: number; h: number }; kb: boolean } {
  const t = w !== tallest.w ? { w, h } : { w, h: Math.max(tallest.h, h) };
  return { tallest: t, kb: h < t.h - 150 || h < layoutH - 150 };
}

/** 화면 틀(.m-app) 자리 — 글을 쓰는 중(키보드·입력칸 포커스)이면 iOS 가 문서를 올린 만큼(visualViewport.offsetTop) 따라가 입력줄을 키보드 위에 두고,
 *  아니면 맨 위(0)에 붙이고 밀린 문서를 되돌린다(scroll). 키보드가 닫힌 뒤에도 offsetTop 을 그대로 따라가서
 *  화면 틀이 상태 막대 높이(61pt)만큼 내려가 위가 비고 입력칸이 잘렸다(2026-10-04 사용자 실기기, 내비 라이브 액티비티 떠 있을 때). h = 화면 틀 높이 */
export function frameAt(o: { vvTop: number; vvH: number; layoutH: number; scrollY: number; kb: boolean; editing: boolean; fullH?: number }): { top: number; h: number; scroll: boolean } {
  if (o.kb || o.editing) return { top: o.vvTop, h: o.vvH, scroll: false };
  // 높이도 레이아웃 높이(documentElement.clientHeight = height:100%) — 키보드를 연 채 돌리고 닫으면 보이는 높이가 4px 모자란 채 남았다(2026-10-04 시뮬레이터)
  // fullH = 유령 키보드(ghostKeyboard)일 때 같은 폭에서 본 가장 큰 높이 — 레이아웃 높이까지 키보드만큼 줄어 남는다(iOS 26)
  return { top: 0, h: Math.max(o.layoutH || o.vvH, o.fullH ?? 0), scroll: o.vvTop !== 0 || o.scrollY !== 0 };
}

/** 유령 키보드를 볼 때까지 기다리는 시간 — 키보드가 내려가는 동안(0.3초쯤)은 진짜로 높이가 작다 */
export const GHOST_MS = 700;
/** 유령 키보드 — 키보드를 닫았는데 iOS 홈 화면 앱이 innerHeight·visualViewport.height 를 키보드 높이만큼 작은 채 둔다(WebKit 297779).
 *  우리 판정(keyboardOpen)은 그걸 '키보드가 떠 있다'로 읽어 화면 틀을 작은 높이에 두고 시트를 전체로 붙인 채 멈췄다
 *  (2026-10-08 사용자 실기기 — 입력칸이 화면 가운데, 그 아래 빈 검은 바닥). 키보드는 글 쓰는 칸에 포커스가 있어야만 뜨니,
 *  포커스 없이 GHOST_MS 넘게 '키보드 높이'면 유령으로 보고 키보드 없음으로 그린다. quietMs = 마지막으로 쓰는 중이었거나 포커스가 빠진 뒤 지난 시간.
 *  터치 없는 화면(데스크톱 창을 줄인 것)은 작은 높이가 진짜라 손대지 않는다 */
export function ghostKeyboard(o: { kb: boolean; typing: boolean; quietMs: number; touch: boolean }): boolean {
  return o.kb && !o.typing && o.touch && o.quietMs >= GHOST_MS;
}

/** 보이는 높이 고르기 — 보통은 visualViewport.height. iOS 26 홈 화면 앱은 한 번 꼬이면 그 값이 엉터리로 남는다(2026-10-09 사용자 실기기 진단:
 *  쉴 때 innerHeight - 874 = -62, 키보드를 열면 innerHeight 가 이미 키보드만큼 준 데서 또 빠져 145px — 화면 틀이 쪼그라들어 입력칸이 손잡이 밑에 붙고 아래가 비었다).
 *  0 이하이거나 innerHeight 보다 크면(보이는 화면이 레이아웃보다 클 수는 없다) innerHeight, innerHeight 가 벌써 키보드를 따라갔는데(fullH 보다 150px 넘게 작음)
 *  vvH 가 그보다 더 작으면 innerHeight. innerHeight 가 키보드를 안 따라가는 브라우저(iOS 18 이하)는 vvH 가 맞아서 그대로. fullH = 레이아웃 높이와 같은 폭에서 본 가장 큰 높이 중 큰 쪽 */
export function visibleHeight(o: { vvH: number | null; innerH: number; fullH: number }): number {
  if (o.vvH === null || !(o.vvH > 0) || o.vvH > o.innerH + 1) return o.innerH;
  if (o.vvH < o.innerH - 1 && o.innerH < o.fullH - 150) return o.innerH;
  return o.vvH;
}

/** 보이는 화면 한 번 읽기(useViewport read 의 계산 몫) — 높이·폭을 고르고, 키보드·유령 판정, 화면 틀 자리까지.
 *  vvH·vvW = visualViewport 높이·폭(없으면 null), innerH·innerW = window.innerHeight·innerWidth, layoutH = documentElement.clientHeight */
export function readViewport(o: {
  vvH: number | null; vvW: number | null; vvTop: number; innerH: number; innerW: number; layoutH: number; scrollY: number;
  tallest: { w: number; h: number }; editing: boolean; quietMs: number; touch: boolean;
}): { h: number; top: number; kb: boolean; scroll: boolean; ghost: boolean; tallest: { w: number; h: number }; fixed: boolean } {
  // 폭 0(가려진 채 읽힘)을 그대로 쓰면 같은 폭 기준(tallest)이 0 으로 새로 잡혀 키보드 판정이 엇나간다
  const w = o.vvW !== null && o.vvW > 0 ? o.vvW : o.innerW;
  const h = visibleHeight({ vvH: o.vvH, innerH: o.innerH, fullH: Math.max(o.layoutH, w === o.tallest.w ? o.tallest.h : 0) });
  const k = keyboardOpen(o.tallest, w, h, o.innerH);
  const ghost = ghostKeyboard({ kb: k.kb, typing: o.editing, quietMs: o.quietMs, touch: o.touch });
  const kb = k.kb && !ghost;
  const f = frameAt({ vvTop: o.vvTop, vvH: h, layoutH: o.layoutH, scrollY: o.scrollY, kb, editing: o.editing, fullH: ghost ? k.tallest.h : undefined });
  // fixed = 엉터리 vvH 를 innerHeight 로 바꿨나(진단 줄)
  return { h: f.h, top: f.top, kb, scroll: f.scroll, ghost, tallest: k.tallest, fixed: o.vvH !== null && h !== o.vvH };
}

/** 폰 진단 한 줄 — 키=값을 띄어 쓴다. 값은 숫자(반올림)·참거짓(1·0)·짧은 영문 낱말(판 번호·태그 이름)만, 나머지는 버린다 —
 *  입력칸 글 같은 게 실수로 실려도 맥 기록으로 안 나가게(서버도 같은 모양만 받는다) */
export function diagLine(f: Record<string, number | boolean | string>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(f)) {
    if (!/^[A-Za-z]{1,12}$/.test(k)) continue;
    let val: string | null = null;
    if (typeof v === 'boolean') val = v ? '1' : '0';
    else if (typeof v === 'number') val = Number.isFinite(v) ? String(Math.round(v)) : null;
    else if (/^[A-Za-z0-9._-]{1,24}$/.test(v)) val = v;
    if (val !== null) out.push(`${k}=${val}`);
  }
  return out.join(' ');
}

/** 그려진 자리 검사 — 키보드 없이 화면 틀의 실제 위(rectTop, getBoundingClientRect)가 두 번 연달아 같은 만큼(1px 안) 어긋나 있으면
 *  그만큼 보정(bias, top 에 더한다). iOS 가 사건 없이 화면을 옮기면 사건만 듣는 계산으론 못 돌아온다. 쓰는 중이면 보정을 버리고(iOS 키보드 올림과 싸우지 않게),
 *  화면 반 넘는 어긋남은 재다 만 값으로 본다 */
export function driftBias(o: { bias: number; rectTop: number; prevRect: number | null; editing: boolean; h: number }): number {
  if (o.editing) return 0;
  if (Math.abs(o.rectTop) <= 1 || Math.abs(o.rectTop) > o.h / 2) return o.bias;
  if (o.prevRect === null || Math.abs(o.rectTop - o.prevRect) > 1) return o.bias;
  return o.bias - Math.round(o.rectTop);
}

const NOT_TEXT = new Set(['button', 'checkbox', 'radio', 'file', 'submit', 'reset', 'range', 'color', 'image', 'hidden']);
/** 키보드를 부르는 칸에 포커스가 있나 — iframe 은 안쪽 칸을 못 보니 쓰는 중으로 친다 */
export const isTyping = (a: { tag: string; type: string; editable: boolean }) =>
  a.editable || a.tag === 'TEXTAREA' || a.tag === 'IFRAME' || (a.tag === 'INPUT' && !NOT_TEXT.has(a.type.toLowerCase()));

/** 도구 한 줄 — mcp__서버__ 접두는 떼고 대상과 함께(데스크톱 채팅 '작업 중 · 도구'와 같은 모양) */
export const toolLine = (t: { name: string; target: string }) => `${t.name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '')} ${t.target}`.trim();

/** 폰 일하는 중 표시 — 데스크톱 chatBusy(세션 working + 꼬리가 답이 아님)에 더해, 세션 상태를 마지막으로 읽은 뒤(stateAt)
 *  기록에 새로 생긴 꼬리(내 말·다른 세션 말·도구)도 일하는 중으로 — 상태는 3초마다라 그 사이 빈 표시가 없게. 보내는 중(pending)도.
 *  line = 마지막 도구 한 줄(없으면 생각 중), tools = 이번 턴(마지막 내 말 뒤) 도구 수, secs = 그때부터 지난 초 */
export function liveWork(o: { state: string; items: ChatItem[]; pending: number; stateAt: number; now: number }): { busy: boolean; line: string; tools: number; secs: number } {
  const tail = o.items[o.items.length - 1];
  const open = !!tail && (tail.kind === 'user' || tail.kind === 'relay' || tail.kind === 'tools');
  const fresh = open && Date.parse(tail.ts) > o.stateAt;
  const busy = o.pending > 0 || chatBusy(o.state, o.items) || fresh;
  if (!busy) return { busy, line: '', tools: 0, secs: 0 };
  let start = -1;
  for (let i = o.items.length - 1; i >= 0; i--) if (o.items[i]!.kind === 'user' || o.items[i]!.kind === 'relay') { start = i; break; }
  const turn = start < 0 ? [] : o.items.slice(start);
  const tools = turn.reduce((n, it) => n + (it.kind === 'tools' ? it.tools.length : 0), 0);
  const last = tail?.kind === 'tools' ? tail.tools[tail.tools.length - 1]! : null;
  const line = last ? toolLine(last) : '';
  const from = o.pending > 0 || start < 0 ? o.now : Date.parse(o.items[start]!.ts);
  return { busy, line, tools, secs: Math.max(0, Math.round((o.now - from) / 1000)) };
}

/** 참모 바꾸기 시트를 아래로 끌다 놓으면 닫나 — 80px 넘게 내렸거나 아래로 빠르게(0.5px/ms) 튕김. 위로 튕기면 제자리(채팅 시트 releaseSnap 과 같은 손맛) */
export const closeOnRelease = (dy: number, v: number) => (v <= -0.5 ? false : v >= 0.5 || dy > 80);

/** 폰 화면에 보일 이름 — 참모는 번호 없이(데스크톱 orchDisplay 와 같은 displayName, 별명이 겹치면 꼬리), 별명 없는 참모는 비서 이름.
 *  참모가 아닌 세션은 별명만 떼고 그대로(프로젝트 끝 번호는 이름의 일부). 폰엔 데스크톱 별명 저장소(localStorage)가 없어 진짜 이름에 실린 별명을 쓴다 */
export function phoneName(name: string, orchs: { name: string }[]): string {
  return orchestratorLike(name) ? displayName(name, undefined, orchs) : shownName(name);
}

/** 폰에서 바꾼 이름(id → 별명, 빈 글 = 처음 이름) — 맥이 쉬는 때 /rename 으로 진짜 이름에 실을 때까지 폰엔 바로 새 이름 */
export function pendingName(s: { id: string; name: string }, nicks: Record<string, string>, orchs: { name: string }[]): string {
  return s.id in nicks ? phoneName(withNick(s.name, nicks[s.id] ?? ''), orchs) : phoneName(s.name, orchs);
}

/** 진짜 이름에 실린 것은 뺀다 — 뺄 게 없으면 같은 객체 */
export function prunePendingNicks(nicks: Record<string, string>, orchs: { id: string; name: string }[]): Record<string, string> {
  const done = orchs.filter((o) => o.id in nicks && (splitOrchName(o.name).nick ?? '') === nicks[o.id]);
  if (!done.length) return nicks;
  const n = { ...nicks };
  for (const o of done) delete n[o.id];
  return n;
}

/** 폰 참모 깨우기 목록 — /api/stopped(HQ 의 꺼진 대화) 중 참모 이름인 것, 살아 있는 대화는 빼고, 마지막으로 일한 때 최근 순.
 *  하던 일 = /api/tails 꼬리(데스크톱 오케스트레이터 홈 homeRows 와 같은 셈) */
export function offOrchRows(stoppedJson: string, env: { devRoot: string; extraProjects: string[]; hqDir: string }, live: Session[], tails: Record<string, string>): HomeRow[] {
  const off = stoppedOrchs(resumable(parseStopped(stoppedJson, env.devRoot, env.extraProjects), live), env.hqDir, live);
  const activity = Object.fromEntries(Object.entries(tails).map(([k, v]) => [k, summarizeTranscript(v)]));
  return homeRows({ live: [], off, activity, ctx: {} }).off;
}

/** 깨운 참모가 살아 있는 목록에 떴으면 그 id — 되살린 대화는 sessionId 가 같고(respawn), 새 참모는 서버가 지은 이름으로 */
export function wokeOrch(w: { sessionId?: string; name?: string } | null, live: Session[]): string | undefined {
  if (!w) return undefined;
  return w.sessionId ? resumedOrch(w.sessionId, live) : live.find((s) => s.name === w.name)?.id;
}

/** 답 기다림 카드에서 바로 답할 글 — 그 참모에게 보낸다(하위 세션엔 참모가 전한다). 결정 대기함 물음엔 무엇에 대한 답인지 붙이고,
 *  확인창·선택지에서 멈춘 것은 글로 못 답하니 null */
export function waitAnswer(w: Waiting, answer: string): string | null {
  const a = answer.trim();
  if (!a || w.kind === 'blocked') return null;
  return w.kind === 'decide' ? `[결정 대기함] ${w.q}\n→ ${a}` : a;
}

/** 카드 열쇠 — 결정은 일 id, 그 밖은 참모·종류·시각(시트를 다시 열어도 같은 카드로 알아본다) */
export const waitKey = (w: Waiting) => (w.kind === 'decide' && w.taskId ? `task:${w.taskId}` : `${w.kind}:${w.orch}:${w.ts}`);

/** 폰에서 답한 카드(열쇠 → 답·보낸 때). fail = 결정 기록이 실패해 되돌림(카드가 다시 보이고 그 답을 채워 둔다) */
export type WaitSent = Record<string, { a: string; at: number; fail?: boolean }>;

/** 답한 결정 카드는 맥 기록(answer)이 따라올 때까지 숨긴다. 참모 물음 카드는 남겨 '보냈어요'(참모가 일을 시작하면 빠진다) */
export const shownWaiting = (list: Waiting[], sent: WaitSent) => list.filter((w) => w.kind !== 'decide' || !sent[waitKey(w)] || !!sent[waitKey(w)]!.fail);

/** 목록에서 빠진 카드의 보낸 표시는 지운다 — 남길 게 다 남으면 같은 객체 */
export function pruneWaitSent(sent: WaitSent, list: Waiting[]): WaitSent {
  const keys = new Set(list.map(waitKey));
  const next = Object.fromEntries(Object.entries(sent).filter(([k]) => keys.has(k)));
  return Object.keys(next).length === Object.keys(sent).length ? sent : next;
}

/** 같은 카드에 같은 답을 2분 안에 또 보내나 — 막는다(2026-10-06 사용자 ㄱㄱ 세 번) */
export const WAIT_DUP_MS = 120_000;
export const dupAnswer = (sent: WaitSent, key: string, answer: string, now: number) => {
  const p = sent[key];
  return !!p && !p.fail && p.a === answer.trim() && now - p.at <= WAIT_DUP_MS;
};

/** 결정 답 기록 실패 — not waiting(이미 답함·다른 데서 답함)·too soon(방금 보냄)은 숨긴 채 글을 안 보낸다, 나머지(끊김·502)는 되돌려 다시 */
export function answerFail(message: string): 'gone' | 'soon' | 'retry' {
  const m = message.trim();
  return m === 'not waiting' ? 'gone' : m === 'too soon' ? 'soon' : 'retry';
}

/** 이미 켜진 참모를 눌렀을 때(서버 already) — 오류가 아니다, 그 참모로 옮긴다 */
export const wakeAlreadyText = () => tr('이미 켜져 있어요 — 그리로 옮길게요', 'Already running — taking you there');
/** 켜기·만들기 실패 — 서버 낱말(mobile_http.rs 의 Resp::text)마다 사람 말로, 모르는 것은 원문 없이 한 줄.
 *  refresh = 꺼진 목록이 낡았다(이미 켜졌거나 지워짐) → 목록을 바로 다시 받는다 */
export function wakeFailText(message: string, mode: 'wake' | 'make'): { text: string; refresh: boolean } {
  switch (message.trim()) {
    case 'no such stopped assistant':
      return { text: tr('그 대화는 이미 켜졌거나 지워졌어요 — 목록을 새로 고쳤어요', 'That one is already running or was removed — list refreshed'), refresh: true };
    case 'too soon':
      return { text: tr('방금 눌렀어요 — 잠깐 뒤에 다시 해 주세요', 'Just tried — give it a moment'), refresh: false };
    case 'mac side took too long':
      return { text: tr(`${josa(machine(), '이', '가')} 바빠서 답이 늦어요 — 잠시 뒤 목록을 봐 주세요`, `The ${machine()} is busy — check the list in a moment`), refresh: true };
    case 'name taken':
      return { text: tr('이미 있는 이름이에요', 'That name is taken'), refresh: false };
    case 'bad name':
      return { text: tr('쓸 수 없는 이름이에요', "That name can't be used"), refresh: false };
    case 'Load failed':
    case 'Failed to fetch':
    case 'NetworkError when attempting to fetch resource.':
      return { text: tr(`${machine()}에 닿지 않아요 — 연결을 확인해 주세요`, `Can't reach the ${machine()} — check the connection`), refresh: false };
  }
  return mode === 'wake'
    ? { text: tr(`못 켰어요 — ${machine()}에서 확인해 주세요`, `Couldn't start it — check on the ${machine()}`), refresh: true }
    : { text: tr(`못 만들었어요 — ${machine()}에서 확인해 주세요`, `Couldn't create it — check on the ${machine()}`), refresh: false };
}

const RANK: Record<string, number> = { blocked: 0, working: 1 };
const rank = (x: Session) => RANK[x.state] ?? 2;
/** 폰 세션 화면 — 참모는 빼고 프로젝트별(HQ 도우미는 '도우미'). 묻는·일하는 세션이 있는 프로젝트가 위, 안에서도 물음 → 일함 → 쉼 */
export function sessionBoard(sessions: Session[], hqDir: string): { name: string; sessions: Session[] }[] {
  const g = groupByProject(sessions, hqDir);
  const groups = [...g.projects, ...(g.helpers.length ? [{ name: '도우미', sessions: g.helpers }] : [])]
    .map((p) => ({ name: p.name, sessions: [...p.sessions].sort((a, b) => rank(a) - rank(b)) }))
    .filter((p) => p.sessions.length);
  const top = (p: { sessions: Session[] }) => Math.min(...p.sessions.map(rank));
  return groups.map((p, i) => ({ p, i })).sort((a, b) => top(a.p) - top(b.p) || a.i - b.i).map((x) => x.p);
}

/** 대화 목록 바닥 근처를 보고 있나 — 남은 거리가 slack 안이면 */
export const nearBottom = (scrollHeight: number, scrollTop: number, clientHeight: number, slack = 80) => scrollHeight - scrollTop - clientHeight <= slack;

/** 목록이 줄거나(키보드) 말풍선이 늘 때 바닥에 붙일까 — 바닥 근처를 보던 중이었거나 내가 막 보냈으면. 옛 글을 보는 중이면 그대로(2026-10-03 사용자) */
export const stickBottom = (o: { wasNear: boolean; sentMine: boolean }) => o.wasNear || o.sentMine;

const SHRINK_SIDE = 2048;
const SHRINK_BYTES = 1_500_000;
/** 폰 사진을 올리기 전에 다시 구울 크기 — 긴 변 2048 넘거나 1.5MB 넘거나 HEIC 면 {w,h}(JPEG 0.85 로), 아니면 null(그대로).
 *  GIF 는 움직임이 깨지니 그대로. 큰 사진을 LTE 로 그대로 올리다 끊겼다(2026-10-03 'Load failed') */
export function shrinkPlan(w: number, h: number, bytes: number, type: string): { w: number; h: number } | null {
  if (type === 'image/gif' || w <= 0 || h <= 0) return null;
  const heic = /heic|heif/i.test(type);
  const k = Math.min(1, SHRINK_SIDE / Math.max(w, h));
  if (k === 1 && bytes <= SHRINK_BYTES && !heic) return null;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/** 앞 대화 상태 — older = 거슬러 읽어 앞에 붙인 말들, start = 그 첫 줄의 파일 자리(다음엔 그 앞을), done = 파일 처음까지 읽음 */
export type Earlier = { older: ChatItem[]; start: number; done: boolean };
/** 거슬러 읽은 묶음을 앞에 붙인다 — 같은 id 는 한 번만 */
export function withEarlier(s: Earlier, parsed: ChatItem[], start: number): Earlier {
  const seen = new Set(s.older.map((x) => x.id));
  return { older: [...parsed.filter((x) => !seen.has(x.id)), ...s.older], start, done: start <= 0 };
}

/** 앞 대화를 미리 불러올 때인가 — 위로 화면 한 장도 안 남았고(위 끝에 닿기 전에), 불러오는 중·다 읽음이 아니면.
 *  목록이 화면보다 짧아도(scrollTop 0) 참이라 화면이 찰 때까지 연달아 부른다 */
export const wantEarlier = (o: { scrollTop: number; clientHeight: number; loading: boolean; done: boolean }) =>
  !o.loading && !o.done && o.scrollTop < o.clientHeight;

/** 참모를 재운 뒤 볼 참모 — 지금 보던 참모면 남은 첫 참모(없으면 null = 참모 없음 화면), 다른 참모를 재웠으면 그대로 */
export function nextAfterStop(orchs: Session[], stopped: string, current: string): string | null {
  if (stopped !== current) return current;
  return orchs.find((o) => o.id !== stopped)?.id ?? null;
}

/** 참모 줄 마지막 말 자리 — 높이는 늘 한 줄(받으면서 줄이 커져 목록이 들썩였다). 아직 안 받았으면 회색 뼈대, 받았는데 없으면 빈 줄 */
export const lineSlot = (line: string | undefined): { skel: boolean; text: string } =>
  line === undefined ? { skel: true, text: '' } : { skel: false, text: line || ' ' };

export type OrchMenuKey = 'rename' | 'role' | 'pin' | 'unpin' | 'sleep' | 'wake' | 'remove';
/** 참모 줄 길게 누르기 메뉴 — 밀기 동작(고정·재우기·깨우기·제거)을 다 모으고 이름 바꾸기를 더한다(입력이 필요한 건 밀기가 아니라 메뉴, iOS 관례).
 *  이름은 켜진 참모만(/rename 은 살아 있는 세션에), 고정은 대화 id 가 있을 때. 제거는 빨강(누르면 경고) */
export function orchMenu(o: { live: boolean; pinned: boolean; canPin: boolean }): { key: OrchMenuKey; label: string; danger?: boolean }[] {
  const pin = o.canPin ? [o.pinned ? { key: 'unpin' as const, label: '고정 풀기' } : { key: 'pin' as const, label: '맨 위에 고정' }] : [];
  return o.live
    ? [{ key: 'rename', label: '이름 바꾸기' }, { key: 'role', label: '맡은 일' }, ...pin, { key: 'sleep', label: '재우기' }, { key: 'remove', label: '제거', danger: true }]
    : [{ key: 'wake', label: '깨우기' }, ...pin, { key: 'remove', label: '제거', danger: true }];
}
