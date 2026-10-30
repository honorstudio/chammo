// 팀 홈 판(ADR 0018, 시안 team-home v1 B) — 블록 모음·템플릿 셋·꾸미기 동작·끌어 놓을 자리. 판·내용 모양은 Rust team_home 이 다시 고른다
import { tr } from '../i18n';
import { stamp } from './teamChat';
import type { AgentShown } from './teamAgent';
import type { LockerItem } from './teamLocker';

export type BlockKind = 'pin' | 'posts' | 'members' | 'agents' | 'files' | 'links' | 'note' | 'goals' | 'mode' | 'cal';
export type Width = 'half' | 'full';
export type HomeBlock = { id: string; k: BlockKind; w: Width; mode?: string };
export type Home = { t: 'home'; color: number; blurb: string; cover: string; blocks: HomeBlock[]; at: number };
export type Link = { name: string; url: string };
export type Goal = { name: string; done: number; total: number };
export type Content = { links: Link[]; note: { title: string; body: string }; goals: Goal[]; by: string; at: number };
export type HomeBoard = { team: string; rev: number; home: Home | null; by: string; content: Record<string, Content>; cover: string; owner: boolean; me: string };

/** 블록 내용으로 올리는 것(누가·언제는 Rust 가 붙인다) */
export type ContentDraft = Pick<Content, 'links' | 'note' | 'goals'>;
/** 판 길 — 데스크톱(Tauri 명령)·폰(맥 폰 서버). cover 는 데스크톱만(폰 꾸미기는 순서·더하기·빼기만, ADR 0018 4) */
export type HomeApi = {
  board: (team: string, seen: number | null) => Promise<HomeBoard | { same: true }>;
  save: (team: string, home: Home) => Promise<unknown>;
  content: (team: string, block: string, c: ContentDraft) => Promise<unknown>;
  cover?: (team: string, image: string) => Promise<string>;
};

/** 블록이 읽는 것 — 팀 참모·최근 파일·파일 열기·링크 열기(데스크톱·폰이 다르다) */
export type HomeSources = {
  agents: (team: string) => Promise<AgentShown[]>;
  /** fresh = 보관함 판이 올랐다(망으로 새로) */
  files: (team: string, fresh: boolean) => Promise<LockerItem[]>;
  openFile?: (team: string, i: LockerItem) => void;
  openUrl: (url: string) => void;
};

export const BLOCKS_MAX = 24;
export const LINKS_MAX = 12;
export const GOALS_MAX = 8;
export const BLURB_MAX = 80;
export const NOTE_MAX = 2000;

/** 팀 색 — 앱 사람 색과 겹치지 않는 차분한 여덟 */
export const TEAM_COLORS = ['#5a4fcf', '#2563eb', '#0f766e', '#2f9e6b', '#c2410c', '#b45309', '#be185d', '#475569'] as const;
export const teamColor = (i: number) => TEAM_COLORS[i] ?? TEAM_COLORS[0];
/** 팀 홈 판의 팀 색 — 판이 없거나 아직 못 읽었으면 없음(띠 팀 칸은 이름 색을 쓴다) */
export const homeColor = (b: HomeBoard | null | undefined): string | undefined => (b?.home ? teamColor(b.home.color) : undefined);

type Spec = { k: BlockKind; w: Width; one: boolean; group: 'news' | 'work'; name: () => string; hint: () => string };
/** 블록 모음 v1(ADR 0018 8) — 서랍 순서. one = 한 판에 하나 */
export const BLOCKS: Spec[] = [
  { k: 'pin', w: 'full', one: true, group: 'news', name: () => tr('고정 공지', 'Pinned notice'), hint: () => tr('팀장이 고정한 글', 'The post the owner pinned') },
  { k: 'posts', w: 'full', one: true, group: 'news', name: () => tr('글 목록', 'Posts'), hint: () => tr('팀 홈 글', 'Team home posts') },
  { k: 'note', w: 'half', one: false, group: 'news', name: () => tr('글 한 칸', 'Note'), hint: () => tr('짧은 글 — 누구나 고침', 'A short note anyone can edit') },
  { k: 'links', w: 'half', one: false, group: 'news', name: () => tr('링크 모음', 'Links'), hint: () => tr('자주 여는 주소', 'Addresses the team opens often') },
  { k: 'cal', w: 'half', one: true, group: 'work', name: () => tr('팀 캘린더', 'Team calendar'), hint: () => tr('다가오는 일정 — 넓히면 이번 주', 'Upcoming — this week when wide') },
  { k: 'members', w: 'half', one: true, group: 'work', name: () => tr('팀원', 'Members'), hint: () => tr('지금 상태', 'Who is around') },
  { k: 'goals', w: 'half', one: false, group: 'work', name: () => tr('진행 중', 'In progress'), hint: () => tr('손으로 적는 목표 막대', 'Goal bars the team updates') },
  { k: 'files', w: 'half', one: true, group: 'work', name: () => tr('최근 파일', 'Recent files'), hint: () => tr('팀 보관함', 'Team locker') },
  { k: 'agents', w: 'half', one: true, group: 'work', name: () => tr('팀 참모', 'Team helpers'), hint: () => tr('누르면 팀챗에 @이름', 'Tap to @mention in the team chat') },
  { k: 'mode', w: 'full', one: false, group: 'work', name: () => tr('참모 모드', 'Chammo mode'), hint: () => tr('현황판·달력 같은 가벼운 모드', 'A light mode like a board or calendar') },
];
export const specOf = (k: BlockKind) => BLOCKS.find((s) => s.k === k)!;

export type TemplateKey = 'basic' | 'project' | 'ops';
export const TEMPLATES: { key: TemplateKey; name: () => string; ks: BlockKind[] }[] = [
  { key: 'basic', name: () => tr('기본', 'Basic'), ks: ['pin', 'cal', 'members', 'files', 'posts'] },
  { key: 'project', name: () => tr('프로젝트팀', 'Project team'), ks: ['cal', 'goals', 'files', 'agents', 'links', 'posts'] },
  { key: 'ops', name: () => tr('운영팀', 'Operations team'), ks: ['pin', 'mode', 'members', 'agents', 'links', 'posts'] },
];

/** 글이 보일 자리 — 칸 구성과 상관없이 올린 글은 어딘가에 보여야 한다(팀원이 올린 글이 글 목록 칸 없는 판에서 사라졌다, 공개 이슈 #9).
 *  pinInList = 고정 공지 칸이 없어 고정한 글도 목록 맨 앞에 · listBelow = 글 목록 칸이 없어 판 아래에 글 타일. 판이 없으면 글 목록 판이 통째로 그려진다 */
export function postPlaces(home: Home | null): { pinInList: boolean; listBelow: boolean } {
  if (!home) return { pinInList: false, listBelow: false };
  const has = (k: BlockKind) => home.blocks.some((b) => b.k === k);
  return { pinInList: !has('pin'), listBelow: !has('posts') };
}

/** 판 안에서 안 겹치는 짧은 id — Rust block_id_ok(1~24자 글자·숫자·-_) */
export const newBlockId = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const blockOf = (k: BlockKind, id: string): HomeBlock => (k === 'mode' ? { id, k, w: specOf(k).w, mode: '' } : { id, k, w: specOf(k).w });

export const blankHome = (): Home => ({ t: 'home', color: 0, blurb: '', cover: '', blocks: [], at: 0 });

export function fromTemplate(key: TemplateKey, id: () => string = newBlockId): Home {
  const t = TEMPLATES.find((x) => x.key === key) ?? TEMPLATES[0]!;
  return { ...blankHome(), blocks: t.ks.map((k) => blockOf(k, id())) };
}

/** 끌어 놓기 — to = 빼기 전 목록의 끼울 자리(0..길이) */
export function moveBlock(bs: HomeBlock[], id: string, to: number): HomeBlock[] {
  const from = bs.findIndex((b) => b.id === id);
  if (from < 0) return bs;
  const rest = bs.filter((b) => b.id !== id);
  const at = Math.max(0, Math.min(rest.length, to > from ? to - 1 : to));
  return [...rest.slice(0, at), bs[from]!, ...rest.slice(at)];
}

export const setWidth = (bs: HomeBlock[], id: string, w: Width) => bs.map((b) => (b.id === id ? { ...b, w } : b));
export const removeBlock = (bs: HomeBlock[], id: string) => bs.filter((b) => b.id !== id);
export const canAdd = (bs: HomeBlock[], k: BlockKind) => bs.length < BLOCKS_MAX && !(specOf(k).one && bs.some((b) => b.k === k));
export const addBlock = (bs: HomeBlock[], k: BlockKind, id: string = newBlockId()) => (canAdd(bs, k) ? [...bs, blockOf(k, id)] : bs);
export const setMode = (bs: HomeBlock[], id: string, mode: string) => bs.map((b) => (b.id === id ? { ...b, mode } : b));

/** 완료 전후 같은 판인가(시각 빼고) — 같으면 올리지 않는다 */
export const homeSame = (a: Home, b: Home) => JSON.stringify({ ...a, at: 0 }) === JSON.stringify({ ...b, at: 0 });

type Rect = { x: number; y: number; w: number; h: number };
/** 끌어 놓을 자리 — 읽는 순서로 블록을 지났는지. 블록 위 틈이면 그 앞, 블록 안이면 전체 폭은 세로 가운데·반 폭은 가로 가운데로 가른다 */
export function dropAt(rects: Rect[], px: number, py: number): number {
  const widest = Math.max(0, ...rects.map((r) => r.w));
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    if (py < r.y) return i;
    if (py > r.y + r.h) continue;
    if (r.w >= widest * 0.75 ? py < r.y + r.h / 2 : px < r.x + r.w / 2) return i;
  }
  return rects.length;
}

/** 링크 한 줄 문제(빈 글 = 괜찮음) — http·https 만(누르는 사람 기기에서 열린다) */
export function linkProblem(l: Link): string {
  if (!l.name.trim()) return tr('이름을 적어 주세요', 'Add a name');
  if (!/^https?:\/\/\S+$/.test(l.url.trim()) || l.url.trim().length > 500) return tr('http:// 나 https:// 로 시작하는 주소만', 'Only http:// or https:// addresses');
  return '';
}

export function goalFix(g: Goal): Goal {
  const total = Math.max(1, Math.min(99, Math.round(g.total) || 1));
  return { name: g.name, done: Math.max(0, Math.min(total, Math.round(g.done) || 0)), total };
}

export const blankContent = (): Content => ({ links: [], note: { title: '', body: '' }, goals: [], by: '', at: 0 });

const hasBatchim = (s: string) => {
  const c = s.charCodeAt(s.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
};

/** '하린이 10:15 에 바꿈' — 판·내용을 마지막으로 바꾼 사람 */
export function changedLine(name: string, at: number, now: number): string {
  if (!name || !at) return '';
  const when = stamp(at, now);
  return tr(`${name}${hasBatchim(name) ? '이' : '가'} ${when}${/\d/.test(when) ? ' 에' : ''} 바꿈`, `Changed by ${name} · ${when}`);
}

/** 최근 파일 블록 — 사람이 올린 팀 파일만(대화 파일·앱 안쪽 줄·휴지통·폴더 줄·못 여는 것 빼고) 새것 먼저 */
export const recentFiles = (items: LockerItem[], n: number) =>
  items.filter((i) => i.kind === 'file' && !i.room && i.state === 'live' && !i.dir && !i.why).sort((a, b) => b.at - a.at).slice(0, n);

type ModeRowLike = { name: string; light?: boolean; on: boolean; hidden?: boolean };
/** 모드 칸 상태 — 빈 칸 · 이 기기에 없음 · 가볍지 않음 · 켜기 묻기 · 켜는 중 · 그림 */
export function modeBlockState(mode: string, row: ModeRowLike | undefined, ok: boolean): 'empty' | 'missing' | 'heavy' | 'ask' | 'start' | 'show' {
  if (!mode) return 'empty';
  if (!row) return 'missing';
  if (!row.light) return 'heavy';
  if (!ok) return 'ask';
  return row.on ? 'show' : 'start';
}
/** '켜기' 기억 열쇠 — 팀·블록·모드마다(꽂은 모드가 바뀌면 다시 묻는다) */
export const modeOkKey = (team: string, block: string, mode: string) => `${team}:${block}:${mode}`;
export const lightModes = <T extends ModeRowLike>(rows: T[]) => rows.filter((r) => r.light && !r.hidden);

/** 커버 사진 — 가운데 3:1 로 잘라 1200×400 webp(팀 아이콘과 같은 512KB 한도 안) */
export const COVER = { w: 1200, h: 400 };
export function coverCrop(w: number, h: number) {
  const ratio = COVER.w / COVER.h;
  if (w / h > ratio) { const sw = Math.round(h * ratio); return { sx: Math.round((w - sw) / 2), sy: 0, sw, sh: h }; }
  const sh = Math.round(w / ratio);
  return { sx: 0, sy: Math.round((h - sh) / 2), sw: w, sh };
}
