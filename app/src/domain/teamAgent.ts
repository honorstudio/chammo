// 팀 참모(ADR 0017) — 팀이 정의하고 부른 사람 기기·계정으로 돈다. Rust team_agent.rs 와 같은 모양·규칙
import { tr } from '../i18n';

export type AgentRef = { id: string; name: string };
/** 정의 한 판 — Rust team_agent::Def(camelCase) */
export type AgentDef = {
  t: string; origin: string; name: string; blurb: string; guide: string;
  model: 'haiku' | 'sonnet'; web: boolean; refs: AgentRef[]; attach: boolean;
  /** both = 만든 사람 + 팀장 · owner = 팀장만 */
  editors: 'both' | 'owner'; color: number; gone: boolean; created: number; at: number;
};
/** 접은 목록 한 줄 — Rust team_agent::Shown. ver = 지금 판 파일 id, by = 만든 사람 멤버 id */
export type AgentShown = { id: string; ver: string; def: AgentDef; by: string; edited: number; mine: boolean; canEdit: boolean; clash: boolean };
export type Confirmed = { ver: string; def: AgentDef };
export type AgentList = { team: string; agents: AgentShown[]; seen: Record<string, Confirmed>; owner: boolean; me: string };

export const NAME_MAX = 12;
export const BLURB_MAX = 80;
export const GUIDE_MAX = 8000;
export const REFS_MAX = 8;
/** 얼굴 색 — 둥근 네모(사람 동그라미와 갈림) */
export const AGENT_COLORS = ['#4f6bed', '#2f9e7a', '#d9822b', '#8e5bd6', '#e2557a', '#7a8290'] as const;
export const agentColor = (i: number) => AGENT_COLORS[i] ?? AGENT_COLORS[0];

export const blankDef = (): AgentDef => ({ t: 'agent', origin: '', name: '', blurb: '', guide: '', model: 'haiku', web: false, refs: [], attach: false, editors: 'both', color: 0, gone: false, created: 0, at: 0 });

/** 이름 문제(빈 글 = 괜찮음) — Rust name_ok·name_free 와 같다 */
export function nameProblem(name: string, people: string[], agents: AgentShown[], self = ''): string {
  const n = [...name];
  if (!n.length || n.length > NAME_MAX) return tr('이름은 1~12자', 'Names are 1–12 characters');
  if (!/^[\p{L}\p{N}]+$/u.test(name)) return tr('이름엔 글자·숫자만(빈칸·기호 없이)', 'Letters and digits only (no spaces or symbols)');
  const low = name.toLowerCase();
  if (low === '팀참모' || low === 'teamhelper') return tr('기본 팀 참모 이름은 못 써요', "That's the built-in team helper's name");
  if (people.some((p) => p.trim().toLowerCase() === low)) return tr('팀 사람 이름과 같아요', 'Same as a teammate’s name');
  if (agents.some((a) => a.id !== self && a.def.name.toLowerCase() === low)) return tr('같은 이름의 팀 참모가 있어요', 'A team agent already has that name');
  return '';
}

export type Template = { key: 'minutes' | 'summary' | 'translate' | 'schedule'; def: AgentDef };
const tpl = (key: Template['key'], o: Partial<AgentDef>): Template => ({ key, def: { ...blankDef(), ...o } });
export const TEMPLATES: Template[] = [
  tpl('minutes', {
    name: tr('회의록', 'Minutes'), blurb: tr('회의 대화를 결정·할 일·담당으로', 'Decisions, to-dos and owners from a meeting chat'), model: 'sonnet', attach: true, color: 0,
    guide: tr('이 방의 회의 대화를 아래 세 칸으로 정리한다.\n- 정한 것: 누가 무엇을 정했는지 이름을 붙여서\n- 할 일: 담당 · 기한(말에 없으면 \'기한 없음\')\n- 남은 질문\n고객 이름·금액은 대화에 나온 그대로 옮긴다. 파일로 달라고 하면 md 한 개로 준다.',
      'Sort this meeting chat into three parts.\n- Decided: who decided what, with names\n- To-dos: owner · due date (say "no date" if none)\n- Open questions\nCopy client names and amounts exactly. If asked for a file, give one md file.'),
  }),
  tpl('summary', {
    name: tr('요약', 'Summary'), blurb: tr('방 글을 짧게 요약·정리', 'Short summary of the room'), model: 'haiku', color: 5,
    guide: tr('부른 범위(오늘·어제·최근 N개)의 방 대화를 짧게 요약한다. 정한 것·할 일이 보이면 따로 뽑는다. 15줄 안팎, 줄머리 \'- \'.',
      'Summarize the room for the asked range (today, yesterday, last N). Pull out decisions and to-dos if any. About 15 lines, each starting with "- ".'),
  }),
  tpl('translate', {
    name: tr('번역', 'Translate'), blurb: tr('한↔영, 업계 말 그대로', 'Korean ↔ English, keeps trade terms'), model: 'haiku', color: 1,
    guide: tr('따옴표 안 글이 있으면 그것을, 없으면 부른 말 바로 위 글을 번역한다. 한국어면 영어로, 그 밖이면 한국어로. 참고 자료의 용어집이 있으면 그 말을 쓴다. 번역만 쓰고 설명은 붙이지 않는다.',
      'Translate the quoted text, or the message right above the call. Korean to English, anything else to Korean. Use the glossary in the references if there is one. Output only the translation.'),
  }),
  tpl('schedule', {
    name: tr('일정', 'Schedule'), blurb: tr('날짜 나온 말을 일정표로', 'Dates in the chat as a schedule'), model: 'haiku', attach: true, color: 2,
    guide: tr('대화에서 날짜·시간이 나온 말을 모아 표(날짜 | 시간 | 무엇 | 누가)로 정리한다. 모호한 날짜는 되묻지 말고 \'확인 필요\'로 적는다. 파일로 달라고 하면 csv 한 개로 준다.',
      'Collect every date and time in the chat into a table (date | time | what | who). Mark unclear dates "to confirm" instead of asking. If asked for a file, give one csv file.'),
  }),
];

/** 처음·바뀐 뒤 부를 때 확인 장이 필요한가(P2) */
export const needsConfirm = (a: AgentShown, seen: Record<string, Confirmed>) => seen[a.id]?.ver !== a.ver;

export type Tool = 'web' | 'refs' | 'attach';
const toolsOf = (d: AgentDef): Tool[] => [...(d.web ? ['web' as const] : []), ...(d.refs.length ? ['refs' as const] : []), ...(d.attach ? ['attach' as const] : [])];

/** 확인 장에 보일 바뀐 것 — prev = 이 기기가 마지막으로 확인한 판(없으면 처음) */
export function changesOf(prev: AgentDef | undefined, cur: AgentDef) {
  if (!prev) return { first: true, toolsOn: toolsOf(cur), toolsOff: [] as Tool[], model: null as [string, string] | null, added: [] as string[], removed: [] as string[], grew: toolsOf(cur).length > 0 };
  const a = toolsOf(prev), b = toolsOf(cur);
  const toolsOn = b.filter((t) => !a.includes(t)), toolsOff = a.filter((t) => !b.includes(t));
  const pl = prev.guide.split('\n'), cl = cur.guide.split('\n');
  return {
    first: false, toolsOn, toolsOff,
    model: prev.model !== cur.model ? [prev.model, cur.model] as [string, string] : null,
    added: cl.filter((l) => l.trim() && !pl.includes(l)),
    removed: pl.filter((l) => l.trim() && !cl.includes(l)),
    grew: toolsOn.length > 0,
  };
}

export const toolLabel = (t: Tool) => (t === 'web' ? tr('웹 검색', 'Web search') : t === 'refs' ? tr('참고 자료', 'References') : tr('답에 파일 붙이기', 'Attach files to answers'));
export const modelLabel = (m: string) => (m === 'sonnet' ? tr('소넷', 'Sonnet') : tr('하이쿠', 'Haiku'));

/** 긴 답 접기 — 8줄 넘으면 앞 6줄 + 전체 줄 수 */
export function foldLong(text: string, max = 8): { head: string; more: number } {
  const ls = text.split('\n');
  return ls.length > max ? { head: ls.slice(0, 6).join('\n'), more: ls.length } : { head: text, more: 0 };
}

/** 부를 때마다 대략 토큰 — Rust team_agent::estimate 와 같은 식 */
export const estimate = (d: AgentDef, refBytes: number) => 2600 + [...d.guide].length + Math.floor(refBytes / 4);
export const tokensLabel = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

const TEXT_EXT = ['md', 'txt', 'csv', 'tsv', 'json', 'markdown'];
/** 참고 자료로 고를 수 있는 팀 보관함 파일 — 팀 보관함(대화 파일 말고)·글로 읽히는 확장자만(Rust refs_block 과 같은 목록) */
export function refCandidates(items: { id: string; name: string; kind: string; room: string; state: string; why: string; dir?: boolean }[]): AgentRef[] {
  return items
    .filter((i) => !i.dir && !i.why && i.state === 'live' && (i.kind === 'file' || i.kind === '') && !i.room && TEXT_EXT.includes((i.name.split('.').pop() ?? '').toLowerCase()))
    .map((i) => ({ id: i.id, name: i.name }));
}

/** 보낼 글에서 부르는 팀 참모 — Rust team_agent::mention 과 같은 규칙(@ 앞은 줄머리·빈칸, 뒤는 글자·숫자 아님, 긴 이름 먼저, 이름 겹침 빼고) */
export function calledAgent(text: string, agents: AgentShown[]): AgentShown | null {
  const live = agents.filter((a) => !a.clash && a.def.name).sort((a, b) => [...b.def.name].length - [...a.def.name].length);
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '@' || (i > 0 && !/\s/.test(text[i - 1]!))) continue;
    const rest = text.slice(i + 1);
    const hit = live.find((a) => rest.toLowerCase().startsWith(a.def.name.toLowerCase()) && !/^[\p{L}\p{N}]/u.test(rest.slice(a.def.name.length)));
    if (hit) return hit;
  }
  return null;
}
