// 스페이스 모드 채팅: 세션 대화 기록(~/.claude/projects/*/<sessionId>.jsonl)을 말풍선 항목으로.
// 터미널(TUI)은 뒤에 그대로 살아 있고, 이건 그 기록을 읽기 좋게 다시 그리는 보기일 뿐이다(원칙 1 — 2026-09-30 사용자).

import { toolTarget } from './activity';

export type ChatTool = { name: string; target: string };
export type ChatItem =
  | { kind: 'user'; id: string; ts: string; text: string; /** 붙인 그림(data URL) — 말풍선 썸네일 */ images?: string[] }
  | { kind: 'assistant'; id: string; ts: string; text: string }
  | { kind: 'tools'; id: string; ts: string; tools: ChatTool[] }
  /** 슬래시 명령 — 말풍선 대신 작은 줄 */
  | { kind: 'note'; id: string; ts: string; text: string }
  /** 다른 세션이 보낸 말·앱이 넘긴 줄 — 가운데 카드(from = 보낸 쪽). 사용자 말풍선처럼 보였다(2026-09-30) */
  | { kind: 'relay'; id: string; ts: string; from: string; text: string };

type Block = { type?: string; text?: string; name?: string; input?: Record<string, unknown>; source?: { type?: string; media_type?: string; data?: string } };
type Rec = { type?: string; uuid?: string; timestamp?: string; isMeta?: boolean; isSidechain?: boolean; isCompactSummary?: boolean; message?: { content?: unknown };
  /** 일하는 중에 끼어든 메시지는 user 줄이 아니라 queued_command 첨부로 남는다(2026-09-30 실측) */
  attachment?: { type?: string; prompt?: unknown; origin?: { kind?: string } } };

const blocks = (content: unknown): Block[] =>
  typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content.filter((b): b is Block => !!b && typeof b === 'object') : [];

/** 붙인 그림 자리표시 — Claude 가 글 앞에 [Image #n] 을 붙인다. 화면엔 썸네일로 보이니 글에선 뺀다 */
const IMAGE_TOKEN = /\[Image #\d+\]/g;
const PASTED_TAG = /<\/?pasted_content[^>]*>/g;
/** 그림을 받으면 Claude 가 따로 남기는 "[Image: source: 경로]" 줄 — 사람 말처럼 한 번 더 보였다(2026-09-30) */
const IMAGE_SOURCE = /^(\s*\[Image: source: [^\]]*\]\s*)+$/;

/** 사람이 친 글 + 붙인 그림. 도구 결과만 있으면 둘 다 빈 것 */
function userParts(content: unknown): { text: string; images: string[] } {
  const bs = blocks(content);
  const text = bs
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n')
    .replace(IMAGE_TOKEN, '')
    .replace(PASTED_TAG, '') // 긴 글은 붙여넣기 태그로 감싸져 기록된다 — 사람 눈엔 태그 없이
    .trim();
  const images = bs
    .filter((b) => b.type === 'image' && b.source?.type === 'base64' && b.source.data)
    .map((b) => `data:${b.source!.media_type ?? 'image/png'};base64,${b.source!.data}`);
  return { text: IMAGE_SOURCE.test(text) ? '' : text, images };
}
const userText = (content: unknown) => userParts(content).text;

/** 다른 세션이 보낸 말(<cross-session-message from-name=…>)·앱이 넘긴 줄([앱] …) → 보낸 쪽과 본문 */
function relayOf(t: string): { from: string; text: string } | null {
  if (t.startsWith('[앱] ')) return { from: '앱', text: t.replace(/^\[앱\]\s*/, '').trim() };
  const m = t.match(/<cross-session-message\b[^>]*?from-name="([^"]*)"[^>]*>([\s\S]*?)<\/cross-session-message>/);
  return m ? { from: m[1]!, text: m[2]!.trim() } : null;
}

/** 사람이 친 게 아닌 user 줄 — 슬래시 명령·다른 세션 메시지는 알림 줄, 나머지 주입(<system-reminder> 등)은 숨김 */
function injected(t: string): { note: string } | 'hide' | null {
  const cmd = t.match(/^<command-name>(\/[^<]*)<\/command-name>/);
  if (cmd) return { note: cmd[1]!.trim() };
  if (/^\[Request interrupted by user[^\]]*\]$/.test(t)) return 'hide'; // 멈추기 뒤 Claude 가 남기는 표시 — 말풍선으로는 군더더기(2026-09-30 사용자)
  if (t.startsWith('<') && !t.startsWith('<pasted_content')) return 'hide';
  return null;
}

/** 채팅에선 명령 앞부분(cd /Users/…)보다 설명 한 줄이 읽기 좋다 — 설명이 있으면 설명(자르기는 화면 CSS 가) */
const chatTarget = (input: Record<string, unknown> | undefined) =>
  typeof input?.description === 'string' && input.description.trim() ? input.description.trim() : toolTarget(input);

/** 한 줄 → 새 항목들(합치기 전) */
function itemsOf(r: Rec): ChatItem[] {
  if (r.isSidechain) return [];
  const id = r.uuid ?? '';
  const ts = r.timestamp ?? '';
  if (r.type === 'user') {
    if (r.isMeta) return [];
    // 컨텍스트가 차서 앞부분을 요약해 넣은 글 — 사용자가 친 말이 아니다
    if (r.isCompactSummary) return [{ kind: 'note', id, ts, text: '대화가 길어서 앞부분을 요약했어' }];
    const { text, images } = userParts(r.message?.content);
    if (!text && !images.length) return [];
    const rel = text ? relayOf(text) : null;
    if (rel) return [{ kind: 'relay', id, ts, ...rel }];
    if (text.startsWith('Another Claude session sent a message')) return [{ kind: 'relay', id, ts, from: '다른 세션', text: text.replace(/^Another Claude session sent a message:?\s*/, '') }];
    const inj = text ? injected(text) : null;
    if (inj === 'hide') return [];
    if (inj) return [{ kind: 'note', id, ts, text: inj.note }];
    return [images.length ? { kind: 'user', id, ts, text, images } : { kind: 'user', id, ts, text }];
  }
  if (r.type === 'attachment') {
    const a = r.attachment;
    if (a?.type !== 'queued_command') return [];
    const text = userText(a.prompt);
    const rel = text ? relayOf(text) : null;
    if (rel) return [{ kind: 'relay', id, ts, ...rel }]; // 일하는 중에 들어온 다른 세션 말
    return text && a.origin?.kind === 'human' ? [{ kind: 'user', id, ts, text }] : [];
  }
  if (r.type === 'assistant') {
    const out: ChatItem[] = [];
    for (const b of blocks(r.message?.content)) {
      if (b.type === 'text' && b.text?.trim()) out.push({ kind: 'assistant', id, ts, text: b.text.trim() });
      else if (b.type === 'tool_use' && b.name) out.push({ kind: 'tools', id, ts, tools: [{ name: b.name, target: chatTarget(b.input) }] });
    }
    return out;
  }
  return [];
}

/** 끝 항목과 이어지면 합친다 — 도구끼리는 한 묶음, 답 조각끼리는 한 말풍선. list 를 제자리에서 바꾼다 */
function push(list: ChatItem[], it: ChatItem) {
  const last = list[list.length - 1];
  if (last?.kind === 'tools' && it.kind === 'tools') list[list.length - 1] = { ...last, tools: [...last.tools, ...it.tools] };
  else if (last?.kind === 'assistant' && it.kind === 'assistant') list[list.length - 1] = { ...last, text: `${last.text}\n\n${it.text}` };
  else list.push(it);
}

function feed(list: ChatItem[], chunk: string): boolean {
  let added = false;
  for (const raw of chunk.split('\n')) {
    if (!raw.trim()) continue;
    let r: Rec;
    try {
      r = JSON.parse(raw);
    } catch {
      continue; // 꼬리를 잘라 읽어 첫 줄은 깨져 있을 수 있다
    }
    for (const it of itemsOf(r)) { push(list, it); added = true; }
  }
  return added;
}

export function parseChat(jsonl: string): ChatItem[] {
  const list: ChatItem[] = [];
  feed(list, jsonl);
  return list;
}

/** 새로 붙은 기록만 이어 붙인다. 바뀐 게 없으면 prev 그대로(React 가 다시 그리지 않게), 있으면 새 배열 */
export function appendChat(prev: ChatItem[], chunk: string): ChatItem[] {
  const list = [...prev];
  return feed(list, chunk) ? list : prev;
}

/** 입력칸에서 보낸 글 중 아직 기록에 안 뜬 것 — 세션이 바쁘면 줄 서 있다가 나중에 뜬다 */
export function stillPending(pending: string[], items: ChatItem[]): string[] {
  // 역슬래시는 빼고 비교 — 줄 끝 \ 는 Claude 입력칸이 '줄 이어 쓰기'로 먹는다
  const norm = (t: string) => t.replace(IMAGE_TOKEN, '').replace(/\\/g, '').replace(/\s+/g, ' ').trim();
  const seen = items.filter((i) => i.kind === 'user').map((i) => norm((i as { text: string }).text));
  // 그림을 같이 보내면 기록엔 [Image #n] 이 붙는다 — 그 표시는 빼고 비교(2026-09-30: 보내는 중이 안 사라졌다)
  return pending.filter((p) => { const n = norm(p); return !!n && !seen.some((t) => t === n || t.includes(n)); });
}

/** 보내는 중 말풍선 중 아직 기록에 안 들어온 것 — 보낸 뒤(몇 초 여유)에 들어온 내 말하고만 맞춘다.
 *  기록 전체와 맞추니 예전 말에 같은 글("한국말로")이 있으면 방금 보낸 말이 바로 사라졌다(2026-09-30 사용자) */
export function pendingLeft<T extends { text: string; at: number }>(pending: T[], items: ChatItem[], now = Date.now()): T[] {
  return pending.filter((p) => {
    // / 명령(/rc·/model 등)은 보통 말처럼 기록에 안 남을 때가 있다 — 4초 지나면 보낸 걸로 친다(2026-10-01 사용자)
    if (p.text.trimStart().startsWith('/') && now - p.at > SLASH_PENDING_MS) return false;
    return stillPending([p.text], items.filter((i) => i.kind === 'user' && Date.parse(i.ts) >= p.at - 10_000)).length > 0;
  });
}
const SLASH_PENDING_MS = 4000;

/** 보내는 중인 말이 Enter 없이 터미널 입력칸에 그대로 있으면 그 말 — 쉬는데 남아 있으면 Enter 를 다시 넣는다 */
export function stuckInInput(pending: string[], input: string): string | null {
  const sq = (t: string) => t.replace(/\s+/g, '');
  const n = sq(input);
  if (!n) return null;
  return pending.find((p) => sq(p) === n) ?? null;
}

/** 작업 중 = 세션이 working 이고 마지막이 답이 아님. 백그라운드 job 참모는 쉬어도 working 으로 나와서 마지막 항목으로 가른다 */
export const chatBusy = (state: string, items: ChatItem[]) => state === 'working' && items[items.length - 1]?.kind !== 'assistant';

/**
 * 터미널 화면(보이는 줄들)에서 Claude 입력칸 글. 입력칸 = 마지막 구분선 두 개 사이, 첫 줄은 `>`/`❯` 로 시작.
 * cursor = [칸, 줄](보이는 줄 기준). 커서가 프롬프트 바로 뒤면 빈 칸 — 흐린 안내 문구는 글자만으론 구분이 안 돼서.
 * 입력칸 모양이 아니면 null(선택지 창 등). 지구본 키로 받아 적은 말을 채팅 화면에 보여 주는 데 쓴다(2026-09-30 사용자)
 */
export function promptInput(lines: string[], cursor: [number, number]): string | null {
  const rules: number[] = [];
  lines.forEach((l, i) => { if (/^\s*─{4,}/.test(l)) rules.push(i); });
  if (rules.length < 2) return null;
  const a = rules[rules.length - 2]!, b = rules[rules.length - 1]!;
  const body = lines.slice(a + 1, b);
  const m = body[0]?.match(/^(\s*[>❯]\s?)(.*)$/);
  if (!m) return null;
  const [cx, cy] = cursor;
  if (cy === a + 1 && cx <= m[1]!.length && body.length === 1) return '';
  return [m[2]!, ...body.slice(1).map((l) => l.replace(/^ {2}/, ''))].map((l) => l.trimEnd()).join('\n').trim();
}

/** 할 일 칸 머리줄 — 터미널의 "N tasks (1 done, 1 in progress, 0 open)" */
export function taskCounts(tasks: { status: string }[]): { done: number; doing: number; open: number } {
  const n = (st: string) => tasks.filter((t) => t.status === st).length;
  return { done: n('completed'), doing: n('in_progress'), open: tasks.length - n('completed') - n('in_progress') };
}

/** 마크다운 손질 — 물결표 하나는 범위(700~900)라 취소선이 되면 안 된다. 두 개(~~)만 취소선(2026-09-30 캡처) */
export const mdSafe = (text: string) =>
  text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/) // 코드 칸(~/.claude 경로)은 건드리지 않는다
    .map((part, i) => (i % 2 ? part : part.replace(/(?<!~)~(?!~)/g, '\\~')))
    .join('');


/**
 * 채팅에서 보낼 글을 사람이 치듯 나눈 조각들. 붙여넣기 표시(bracketed paste)로 감싸면 긴 글은 Claude 가 "붙여넣은 글"로 받아
 * 사용자 지시로 덜 믿는다 — 감싸지 않고 치되 줄바꿈은 Option+Enter(ESC CR), 탭은 띄어쓰기(탭은 자동완성이 된다).
 * 마지막 Enter 는 보내는 쪽이 조금 쉬었다가 따로 넣는다(바로 넣으면 줄바꿈으로 먹힌다). 2026-09-30 시험 세션 실측
 */
/** 글을 다 친 뒤 Enter 까지 기다릴 시간(ms). 윈도우는 가짜 콘솔(ConPTY)이 글을 늦게 넘겨 긴 지시의 Enter 가 줄바꿈으로 들어갔다 — 글 길이만큼 더(최대 +3초) */
export const enterDelay = (len: number, win: boolean): number => (win ? 400 + Math.min(len, 3000) : 400);

export function typedChunks(text: string, size = 200): string[] {
  const out: string[] = [];
  text.replace(/\t/g, '  ').split('\n').forEach((line, i) => {
    if (i > 0) out.push('\x1b\r');
    const cs = [...line];
    for (let k = 0; k < cs.length; k += size) out.push(cs.slice(k, k + size).join(''));
  });
  return out;
}

/** 파일 경로(끌어 놓으면 셸 이스케이프된 절대 경로가 들어간다) — /… 또는 ~/… 로 시작, 띄어쓰기는 "\ " */
const PATH_RE = /(?:^|(?<=\s))((?:\/|~\/)(?:\\ |[^\s])+)/g;
export type Seg = { text: string } | { path: string; name: string };
/** 사람 말 속 파일 경로를 이름 칸으로 떼어 낸다 — 말풍선이 긴 경로로 지저분했다(2026-09-30 사용자) */
export function splitPaths(text: string): Seg[] {
  const out: Seg[] = [];
  let last = 0;
  for (const m of text.matchAll(PATH_RE)) {
    if (!m[1]!.slice(1).includes('/')) continue; // /compact 같은 슬래시 명령은 경로가 아니다
    const at = m.index! + (m[0].length - m[1]!.length);
    if (at > last) out.push({ text: text.slice(last, at) });
    const path = m[1]!.replace(/\\ /g, ' ');
    out.push({ path, name: path.split('/').pop() || path });
    last = at + m[1]!.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

/**
 * 첨부 줄(채팅 입력칸 위)에 남길 터미널 입력칸 글 — 붙인 그림 표시 [Image #n] 과 붙인 파일 경로는 이름표로 보이니 뺀다.
 * 터미널 입력칸이 좁아 긴 경로가 두 줄로 접혀 조각이 남았다(2026-09-30 캡처) → 줄을 이어 붙인 뒤 알고 있는 경로를 통째로 뺀다
 */
export function termRest(termText: string, paths: string[]): string {
  if (!paths.length && !/\[Image #\d+\]/.test(termText)) return termText;
  let s = termText.split('\n').map((l) => l.trim()).join('');
  for (const p of paths) s = s.split(p.replace(/ /g, '\\ ')).join(' ').split(p).join(' ');
  s = s.replace(/\[Image #\d+\]/g, ' ');
  return splitPaths(s).map((x) => ('text' in x ? x.text : ' ')).join('').replace(/\s+/g, ' ').trim();
}

/** 말풍선 참조 — 앞 말풍선을 @chat1 로 입력칸에 끌어온 것(2026-09-30 사용자) */
export type ChatRef = { label: string; who: string; text: string };
const REF_MAX = 600;
const REF_HEAD = /^\[참조 (@chat\d+) · ([^\]]*)\]$/;

/** 보낼 글 = 쓴 글 + 글에 남아 있는 이름표의 인용 블록. 빈 줄은 빼고 600자에서 자른다 */
export function withRefs(text: string, refs: ChatRef[]): string {
  const used = refs.filter((r) => new RegExp(`${r.label}(?!\\d)`).test(text));
  if (!used.length) return text;
  const quote = (t: string) => {
    const flat = t.split('\n').filter((l) => l.trim()).join('\n');
    const cut = [...flat].length > REF_MAX ? `${[...flat].slice(0, REF_MAX).join('')}…` : flat;
    return cut.split('\n').map((l) => `> ${l}`).join('\n');
  };
  return [text, ...used.map((r) => `[참조 ${r.label} · ${r.who}]\n${quote(r.text)}`)].join('\n\n');
}

/** 보낸 말풍선에서 본문과 참조 블록을 가른다 — withRefs 의 반대 */
export function splitRefs(text: string): { body: string; refs: ChatRef[] } {
  const at = text.search(/\n\n\[참조 @chat\d+ · [^\]]*\]\n/);
  if (at < 0) return { body: text, refs: [] };
  const refs: ChatRef[] = [];
  for (const block of text.slice(at + 2).split('\n\n')) {
    const [head = '', ...lines] = block.split('\n');
    const m = head.match(REF_HEAD);
    if (m) refs.push({ label: m[1]!, who: m[2]!, text: lines.map((l) => l.replace(/^> ?/, '')).join('\n') });
  }
  return { body: text.slice(0, at), refs };
}

/** 채팅 창을 누른 뒤 입력칸으로 커서를 옮길지 — 버튼·링크·입력칸이 아니고, 글을 끌어 고르는 중이 아니면(2026-09-30 사용자) */
export const clickFocusesInput = (c: { interactive: boolean; selected: string }) => !c.interactive && !c.selected.trim();
