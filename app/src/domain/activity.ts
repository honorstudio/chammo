// 세션마다 "지금 뭐 하는 중인지"를 대화 기록(~/.claude/projects/*/<sessionId>.jsonl) 꼬리에서 뽑는다.
// 참모가 시킨 일이 아니어도(사용자가 직접 시킨 일) 작업 패널에 보이게 하려는 것.

import { asksUser } from './status';
import { speakable } from './voice';

/** asks: 자르기 전 전체 답으로 판단한 '사용자에게 묻는가'(text 는 화면용으로 잘린 것). say: 음성 모드로 읽을 글(domain/voice).
 *  midTurn: 도구를 부르기 전 중간 멘트("먼저 찾아볼게") — 턴 끝 답이 아니라 읽지·알리지 않는다 */
export type Line = { ts: string; text: string; asks?: boolean; say?: string; midTurn?: boolean; /** 물어볼 때만 — 결정 대기함용 결론·질문(askView) */ ask?: AskView };
/** tool = 마지막으로 부른 도구(사무실 행동·머리 위 한 줄) */
export type Tool = { name: string; target: string; ts: string };
export type Activity = { prompt?: Line; reply?: Line; tool?: Tool };

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
const isInjected = (t: string) => t.startsWith('<') || t.startsWith('Another Claude session sent a message');

export function summarizeTranscript(tail: string): Activity {
  const out: Activity = {};
  for (const raw of tail.split('\n')) {
    if (!raw.trim()) continue;
    let d: { type?: string; timestamp?: string; isMeta?: boolean; message?: { content?: unknown; stop_reason?: string } };
    try {
      d = JSON.parse(raw);
    } catch {
      continue; // 꼬리를 잘라 읽어서 첫 줄은 깨져 있을 수 있다
    }
    const ts = d.timestamp ?? '';
    if (d.type === 'assistant') { const t = lastTool(d.message?.content, ts); if (t) out.tool = t; }
    const text = textOf(d.message?.content).trim();
    if (!text) continue;
    if (d.type === 'user' && !d.isMeta && !isInjected(text)) out.prompt = { ts, text: squash(text) };
    else if (d.type === 'assistant') {
      const asks = asksUser(text);
      out.reply = { ts, text: squash(text), asks, say: speakable(text), ...(asks ? { ask: askView(text) } : {}) };
      if (d.message?.stop_reason === 'tool_use') out.reply.midTurn = true;
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
  const i = u.input ?? {};
  const str = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '');
  let target = '';
  if (str('file_path')) target = base(str('file_path'));
  else if (str('command')) target = cut(str('command').replace(/\s+/g, ' ').trim());
  else if (str('pattern')) target = cut(str('pattern'));
  else if (str('url')) target = cut(str('url').replace(/^https?:\/\//, ''));
  else if (str('query')) target = cut(str('query'));
  else if (str('description')) target = cut(str('description'));
  return { name: u.name, target, ts };
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
