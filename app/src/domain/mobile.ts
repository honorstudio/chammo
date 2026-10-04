// 폰 화면 판단 — 예약 담당 참모, 세션 목록에 붙은 컨텍스트, 그림 붙여 보내기 글. 화면·통신 없음
import { askView, summarizeTranscript } from './activity';
import { chatBusy, splitPaths, type ChatItem } from './chat';
import { parseCtx, type Ctx } from './ctx';
import { dropText } from './drop';
import { findTarget } from './inbox';
import type { Session } from './session';
import { displayName, shownName } from './orchLabel';
import { groupByProject, orchestratorLike } from './session';
import { homeRows, resumedOrch, type HomeRow } from './orchHome';
import { heldBy } from './spaceNav';
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
  return [...new Set(heldBy(events, orchId, now).map((t) => findTarget(sessions, t)?.id).filter((x): x is string => !!x && x !== orchId))];
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

export type Waiting = { orch: string; name: string; kind: 'ask' | 'blocked' | 'decide'; ts: string; q: string; lead?: string };

/** 사용자 답을 기다리는 것 — 참모 답 끝 질문(asks: 참모 id → orchAsk) · 확인창·선택지에서 멈춤 · scripts/task ask(답 받을 참모 = to). 최근 위.
 *  하위 세션 물음은 참모가 대신 답하니 넣지 않는다(시안 v3 전제) */
export function waitingList(orchs: Session[], asks: Record<string, { ts: string; lead: string; q: string } | null>, events: TaskEvent[]): Waiting[] {
  const out: Waiting[] = [];
  for (const o of orchs) {
    const a = asks[o.id];
    if (a) out.push({ orch: o.id, name: o.name, kind: 'ask', ts: a.ts, q: a.q, ...(a.lead ? { lead: a.lead } : {}) });
    if (o.state === 'blocked') out.push({ orch: o.id, name: o.name, kind: 'blocked', ts: '', q: '확인창·선택지에서 멈춰 있어요 — 맥에서 열어 골라 주세요' });
  }
  const last = new Map<string, TaskEvent>();
  for (const e of events) if (e.type !== 'send') last.set(e.task, e);
  for (const e of last.values()) {
    if (e.type !== 'ask' || !e.note) continue;
    const o = findTarget(orchs, e.to);
    if (o) out.push({ orch: o.id, name: o.name, kind: 'decide', ts: e.ts, q: e.note });
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
export function frameAt(o: { vvTop: number; vvH: number; layoutH: number; scrollY: number; kb: boolean; editing: boolean }): { top: number; h: number; scroll: boolean } {
  if (o.kb || o.editing) return { top: o.vvTop, h: o.vvH, scroll: false };
  // 높이도 레이아웃 높이(documentElement.clientHeight = height:100%) — 키보드를 연 채 돌리고 닫으면 보이는 높이가 4px 모자란 채 남았다(2026-10-04 시뮬레이터)
  return { top: 0, h: o.layoutH || o.vvH, scroll: o.vvTop !== 0 || o.scrollY !== 0 };
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
