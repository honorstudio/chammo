// 세션마다 "지금 뭐 하는 중인지"를 대화 기록(~/.claude/projects/*/<sessionId>.jsonl) 꼬리에서 뽑는다.
// 참모가 시킨 일이 아니어도(사용자가 직접 시킨 일) 작업 패널에 보이게 하려는 것.

import { asksUser } from './status';
import { speakable } from './voice';

/** asks: 자르기 전 전체 답으로 판단한 '사용자에게 묻는가'(text 는 화면용으로 잘린 것). say: 음성 모드로 읽을 글(domain/voice).
 *  midTurn: 도구를 부르기 전 중간 멘트("먼저 찾아볼게") — 턴 끝 답이 아니라 읽지·알리지 않는다
 *  turnEnd: 턴 끝 답(stop_reason end_turn) — 세션 상태가 계속 작업 중으로 나와도 답이 끝난 걸 안다(백그라운드 job 참모) */
export type Line = { ts: string; text: string; /** 답 끝 200자 — 넘길 때 끝의 질문·요청이 보이게(text 는 앞에서 자른다) */ tail?: string; asks?: boolean; say?: string; midTurn?: boolean; turnEnd?: boolean; /** 물어볼 때만 — 결정 대기함용 결론·질문(askView) */ ask?: AskView };
/** tool = 마지막으로 부른 도구(사무실 행동·머리 위 한 줄) */
export type Tool = { name: string; target: string; ts: string };
/** messaged = 마지막으로 SendMessage 를 부른 시각 — 이미 참모에게 보고했는지(참모 기록이 커서 거기선 못 찾았다, 2026-09-30) */
export type Activity = { prompt?: Line; reply?: Line; tool?: Tool; messaged?: string; /** 사용 한도 오류로 멈춤 — 그 오류 줄이 마지막(뒤에 새 줄이 없음)일 때만 */ limit?: { ts: string; text: string }; /** 마지막 대화 줄(user·assistant·attachment) 시각 — 글 없는 도구 줄·다른 세션 메시지·작업 알림까지. 답보다 늦으면 그 뒤 턴이 돌던 중(lostTriage) */ lastAt?: string };

/** 사용 한도 오류 줄인가 — API 오류 줄(isApiErrorMessage)이면서 오류 종류가 rate_limit 류이거나 글에 "hit your … limit".
 *  문구가 바뀐 적이 있어 둘 중 하나만 맞아도 잡는다. 일시적 429·529·과부하는 Claude Code 가 다시 시도하니 아니다(2026-10-02) */
export function isLimitError(d: { isApiErrorMessage?: boolean; error?: string }, text: string): boolean {
  if (d.isApiErrorMessage !== true) return false;
  if (/\b(429|529)\b|overloaded|try again in a moment/i.test(text)) return false;
  return /rate_limit/i.test(d.error ?? '') || /hit your\b.*\blimit/i.test(text) || /usage limit reached|(5-hour|weekly|session) limit reached/i.test(text);
}

const MAX = 240;

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b): b is { type: string; text: string } => !!b && typeof b === 'object' && (b as { type?: string }).type === 'text')
    .map((b) => b.text)
    .join('\n');
};

const squash = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > MAX ? t.slice(0, MAX) + '…' : t;
};

// 사람이 친 지시가 아닌 것: 슬래시 명령·훅 주입(<…>로 시작), 다른 세션이 보낸 메시지
// 붙여넣은 글(<pasted_content …>)은 사람이 보낸 것 — 훅 주입으로 치면 지시 시각이 옛것으로 남는다(2026-09-28)
const isInjected = (t: string) => (t.startsWith('<') && !t.startsWith('<pasted_content')) || t.startsWith('Another Claude session sent a message');

export function summarizeTranscript(tail: string): Activity {
  const out: Activity = {};
  for (const raw of tail.split('\n')) {
    if (!raw.trim()) continue;
    let d: { type?: string; timestamp?: string; isMeta?: boolean; isApiErrorMessage?: boolean; error?: string; message?: { content?: unknown; stop_reason?: string } };
    try {
      d = JSON.parse(raw);
    } catch {
      continue; // 꼬리를 잘라 읽어서 첫 줄은 깨져 있을 수 있다
    }
    const ts = d.timestamp ?? '';
    if (ts && (d.type === 'user' || d.type === 'assistant' || d.type === 'attachment')) out.lastAt = ts;
    if (d.type === 'user' || d.type === 'assistant') delete out.limit; // 오류 뒤에 새 줄이 오면 멈춘 게 아니다
    if (d.type === 'assistant') {
      const t = lastTool(d.message?.content, ts);
      if (t) out.tool = t;
      if (Array.isArray(d.message?.content) && d.message!.content.some((b) => (b as { type?: string; name?: string }).type === 'tool_use' && (b as { name?: string }).name === 'SendMessage')) out.messaged = ts;
    }
    const text = textOf(d.message?.content).trim();
    if (!text) continue;
    if (d.type === 'assistant' && isLimitError(d, text)) out.limit = { ts, text: text.slice(0, MAX) }; // 답으로도 그대로 남긴다(대시보드에 보이게)
    if (d.type === 'user' && !d.isMeta && !isInjected(text)) out.prompt = { ts, text: squash(text) };
    else if (d.type === 'assistant') {
      const asks = asksUser(text);
      const flat = text.replace(/\s+/g, ' ').trim();
      out.reply = { ts, text: squash(text), tail: flat.length > 200 ? '…' + flat.slice(-200) : flat, asks, say: speakable(text), ...(asks ? { ask: askView(text) } : {}) };
      if (d.message?.stop_reason === 'tool_use') out.reply.midTurn = true;
      if (d.message?.stop_reason === 'end_turn') out.reply.turnEnd = true;
    }
  }
  return out;
}

export type AskView = { lead: string; q: string };

/** 마크다운 기호 지우기 — 굵게·코드·목록·제목 기호 */
const plain = (s: string) => s.replace(/\*\*|__|`/g, '').replace(/^\s*(?:[-*•]|\d+\.|#+|>)\s+/, '').trim();

/**
 * 결정 대기함에 띄울 물음: 결론 첫 문장(lead) + 마지막 질문(q). 답은 결론을 먼저, 질문을 끝에 쓰니
 * 앞에서 자르면 질문이 잘린다(2026-09-27). 마크다운 기호는 지운다
 */
export function askView(text: string): AskView {
  const lines = text.split('\n').map(plain).filter(Boolean);
  const last = lines[lines.length - 1] ?? '';
  const sentences = last.split(/(?<=[.?!])\s+/);
  const q = sentences.filter((x) => /\?$/.test(x)).pop() ?? sentences[sentences.length - 1] ?? '';
  const first = (lines[0] ?? '').split(/(?<=[.?!])\s+/)[0] ?? '';
  return { lead: first === q ? '' : first, q };
}

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p;
const cut = (s: string, n = 17) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s);

/** 답 안의 마지막 tool_use → 이름 + 대상(파일 이름·명령 앞부분·찾는 말·주소) */
function lastTool(content: unknown, ts: string): Tool | null {
  if (!Array.isArray(content)) return null;
  const uses = content.filter((b): b is { type: string; name: string; input?: Record<string, unknown> } => !!b && typeof b === 'object' && (b as { type?: string }).type === 'tool_use');
  const u = uses[uses.length - 1];
  if (!u) return null;
  return { name: u.name, target: toolTarget(u.input), ts };
}

/** 도구 입력 → 대상 한 토막(파일 이름·명령 앞부분·찾는 말·주소). 채팅 도구 묶음(domain/chat)도 쓴다 */
export function toolTarget(input: Record<string, unknown> | undefined): string {
  const i = input ?? {};
  const str = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '');
  if (str('file_path')) return base(str('file_path'));
  if (str('command')) return cut(str('command').replace(/\s+/g, ' ').trim());
  if (str('pattern')) return cut(str('pattern'));
  if (str('url')) return cut(str('url').replace(/^https?:\/\//, ''));
  if (str('query')) return cut(str('query'));
  if (str('description')) return cut(str('description'));
  return '';
}

/** 사무실 행동 — 고치기(타닥타닥)·읽기(서류 넘김)·실행(진행 막대·톱니)·웹(지구본)·분신·생각(전구) */
export type WorkAct = 'type' | 'read' | 'run' | 'web' | 'agent' | 'think';
export function workAct(t: Tool | undefined): WorkAct {
  if (!t) return 'think';
  const n = t.name;
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(n)) return 'type';
  if (/^(Read|Grep|Glob|LS)$/.test(n)) return 'read';
  if (/^(Bash|Monitor)$/.test(n)) return 'run';
  if (/^(Agent|Task|Workflow)$/.test(n)) return 'agent';
  if (/^Web|playwright|browser|computer-use|peekaboo/i.test(n)) return 'web';
  return 'think';
}
