// 참모 모드 — 모드 호스트가 준 UI 트리(ui_render → {type, props, children, press})를 그릴 마디로 바꾼다.
// 규약(@internal)이 바뀌면 이 파일 한 곳만 고치게 어댑터로 둔다. HTML 은 안 받는다 — 글은 글로, Markdown 만 앱 md 거름(DOMPurify)으로.
// 그리는 것: Box·Text·Button·Markdown·Code·Link·Input·Select, Svg(거른 뒤 <img>, domain/modeSvg). 모르는 것 = '못 그림' 칸(docs/research/2026-10-05-chammo-mod.md)
import type { CSSProperties } from 'react';
import { svgSrc } from './modeSvg';
import { tr } from '../i18n';

/** 누름 손잡이 — 모드 쪽(plugin·handle) 또는 Client 방 쪽(held: 방 런타임이 닫힌 함수를 쥔 번호) */
export type Press = { plugin: string; handle: number; held?: true };
export type Kid = string | TNode;

export type TNode =
  | { type: 'Box'; style: CSSProperties; children: TNode[] }
  | { type: 'Text'; style: CSSProperties; kids: Kid[] }
  | { type: 'Button'; key: string; label: string; primary: boolean; plain: boolean; dim: boolean; kids: Kid[]; press: Press | null }
  | { type: 'Markdown'; text: string; dim: boolean }
  | { type: 'Code'; source: string; language: string }
  | { type: 'Link'; href: string; label: string }
  | { type: 'Input'; key: string; label: string; placeholder: string; value: string; submitLabel: string; press: Press | null }
  | { type: 'Select'; key: string; label: string; value: string; options: { value: string; label: string }[]; press: Press | null }
  | { type: 'Svg'; src: string; alt: string }
  | { type: 'Client'; plugin: string; module: string; key: string; props: unknown; style: CSSProperties }
  | { type: 'Cant'; what: string; alt: string };

const MAX_DEPTH = 32;
type Raw = { type?: unknown; props?: Record<string, unknown>; children?: unknown; press?: unknown; held?: unknown; client?: { plugin?: unknown } };

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

// Client 방 트리는 press 를 안 믿는다(방이 모드 손잡이를 지어내 누르지 못하게) — 방 런타임이 단 held 번호만
function pressOf(r: Raw, inClient: boolean): Press | null {
  if (inClient) return typeof r.held === 'number' && Number.isSafeInteger(r.held) ? { plugin: '', handle: r.held, held: true } : null;
  const p = r.press as { plugin?: unknown; handle?: unknown } | null;
  return p && typeof p.plugin === 'string' && typeof p.handle === 'number' ? { plugin: p.plugin, handle: p.handle } : null;
}

function kidsOf(children: unknown, depth: number, inClient: boolean): Kid[] {
  if (!Array.isArray(children)) return typeof children === 'string' ? [children] : [];
  return children.flatMap((c): Kid[] => (typeof c === 'string' || typeof c === 'number' ? [String(c)] : c && typeof c === 'object' ? [normalize(c, depth + 1, inClient)] : []));
}

/** 규약 트리 한 마디 → 그릴 마디. 모르는 모양은 못 그림 칸(조용히 사라지지 않게). inClient = Client 방이 보낸 트리(domain/modeClient) */
export function normalize(raw: unknown, depth = 0, inClient = false): TNode {
  if (!raw || typeof raw !== 'object') return { type: 'Cant', what: '?', alt: '' };
  const r = raw as Raw;
  const t = str(r.type) || '?';
  if (depth >= MAX_DEPTH) return { type: 'Cant', what: t, alt: '' };
  const p = (r.props && typeof r.props === 'object' ? r.props : {}) as Record<string, unknown>;
  switch (t) {
    case 'Box':
      return { type: 'Box', style: boxStyle(p), children: kidsOf(r.children, depth, inClient).filter((k): k is TNode => typeof k !== 'string') };
    case 'Text':
      return { type: 'Text', style: textStyle(p), kids: kidsOf(r.children, depth, inClient) };
    case 'Button':
      return { type: 'Button', key: str(p.key), label: str(p.label), primary: p.variant === 'primary', plain: p.plain === true, dim: p.dimColor === true, kids: kidsOf(r.children, depth, inClient), press: pressOf(r, inClient) };
    case 'Markdown':
      return { type: 'Markdown', text: str(p.text), dim: p.dimColor === true };
    case 'Code':
      return { type: 'Code', source: str(p.source), language: str(p.language) };
    case 'Link':
      return { type: 'Link', href: str(p.href), label: str(p.label) || str(p.href) };
    case 'Input':
      return { type: 'Input', key: str(p.key), label: str(p.label), placeholder: str(p.placeholder), value: str(p.value), submitLabel: str(p.submitLabel), press: pressOf(r, inClient) };
    case 'Select': {
      const options = (Array.isArray(p.options) ? p.options : []).flatMap((o) => {
        const x = o as { value?: unknown; label?: unknown } | null;
        return x && typeof x.value === 'string' ? [{ value: x.value, label: str(x.label) || x.value }] : [];
      });
      return { type: 'Select', key: str(p.key), label: str(p.label), value: str(p.value), options, press: pressOf(r, inClient) };
    }
    case 'Client': {
      // 모드의 화면 모듈이 그리는 칸 — 방(ui/mode/ModeClient)에서 돈다. 방 안에 또 Client 는 없다
      const plugin = str(r.client?.plugin);
      if (inClient || !plugin || !str(p.module) || !str(p.key)) return { type: 'Cant', what: 'Client', alt: '' };
      const style: CSSProperties = {};
      if (size(p.width)) style.width = size(p.width);
      if (size(p.height)) style.height = size(p.height);
      if (typeof p.flexGrow === 'number') style.flexGrow = p.flexGrow;
      return { type: 'Client', plugin, module: str(p.module), key: str(p.key), props: p.props ?? {}, style };
    }
    case 'Svg': {
      if (inClient) return { type: 'Cant', what: 'Svg', alt: str(p.alt) };
      const src = svgSrc(p.source);
      return src ? { type: 'Svg', src, alt: str(p.alt) } : { type: 'Cant', what: 'Svg', alt: str(p.alt) };
    }
    default:
      // 엔진 몫({type:"engine"})·새 요소
      return { type: 'Cant', what: t, alt: str(p.alt) };
  }
}

export const textOf = (n: TNode | Kid): string =>
  typeof n === 'string' ? n : 'kids' in n ? n.kids.map(textOf).join('') : n.type === 'Box' ? n.children.map(textOf).join('') : '';

// ── 모양: 칸 단위(글자 칸) → px. 가로 한 칸 8px, 세로 한 칸은 줄 사이 4px 로 눌러 쓴다(desktop 표면은 글자 칸이 아니라 화면이라) ──
const CX = 8;
const CY = 4;
const px = (n: unknown, k: number) => (typeof n === 'number' && Number.isFinite(n) ? `${Math.max(0, n) * k}px` : undefined);
const size = (v: unknown) => (typeof v === 'number' ? `${v * CX}px` : typeof v === 'string' && /^\d+(\.\d+)?%$/.test(v) ? v : undefined);

export function boxStyle(p: Record<string, unknown>): CSSProperties {
  const s: CSSProperties = { display: p.display === 'none' ? 'none' : 'flex' };
  const pick = <T extends string>(v: unknown, ok: readonly T[]) => (ok.includes(v as T) ? (v as T) : undefined);
  s.flexDirection = pick(p.flexDirection, ['row', 'column', 'row-reverse', 'column-reverse'] as const);
  s.flexWrap = pick(p.flexWrap, ['nowrap', 'wrap', 'wrap-reverse'] as const);
  s.alignItems = pick(p.alignItems, ['flex-start', 'center', 'flex-end', 'stretch'] as const);
  s.alignSelf = pick(p.alignSelf, ['flex-start', 'center', 'flex-end', 'auto'] as const);
  s.justifyContent = pick(p.justifyContent, ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'] as const);
  if (typeof p.flexGrow === 'number') s.flexGrow = p.flexGrow;
  if (typeof p.flexShrink === 'number') s.flexShrink = p.flexShrink;
  s.gap = px(p.gap, CX);
  s.columnGap = px(p.columnGap, CX);
  s.rowGap = px(p.rowGap, CY);
  s.width = size(p.width);
  s.height = size(p.height);
  s.minWidth = size(p.minWidth);
  s.minHeight = size(p.minHeight);
  if (typeof p.padding === 'number') s.padding = `${p.padding * CY}px ${p.padding * CX}px`;
  if (typeof p.margin === 'number') s.margin = `${p.margin * CY}px ${p.margin * CX}px`;
  for (const [k, side, unit] of [['paddingX', ['paddingLeft', 'paddingRight'], CX], ['paddingY', ['paddingTop', 'paddingBottom'], CY], ['marginX', ['marginLeft', 'marginRight'], CX], ['marginY', ['marginTop', 'marginBottom'], CY]] as const) {
    if (typeof p[k] === 'number') for (const x of side) (s as Record<string, string>)[x] = `${(p[k] as number) * unit}px`;
  }
  for (const [k, unit] of [['paddingTop', CY], ['paddingBottom', CY], ['paddingLeft', CX], ['paddingRight', CX], ['marginTop', CY], ['marginBottom', CY], ['marginLeft', CX], ['marginRight', CX]] as const) {
    const v = px(p[k], unit);
    if (v) (s as Record<string, string>)[k] = v;
  }
  // 테두리는 사방 한 줄로만 — 한쪽 띠는 그리지 않는다(UI 규칙)
  if (typeof p.borderStyle === 'string' && p.borderStyle) {
    s.border = `1px solid ${colorOf(p.borderColor) ?? 'var(--line-strong)'}`;
    s.borderRadius = p.borderStyle === 'round' ? '8px' : '3px';
    if (!s.padding) s.padding = `${CY}px ${CX}px`;
  }
  const bg = colorOf(p.backgroundColor);
  if (bg) s.background = bg;
  if (p.overflow === 'hidden') s.overflow = 'hidden';
  for (const k of Object.keys(s) as (keyof CSSProperties)[]) if (s[k] === undefined) delete s[k];
  return s;
}

function textStyle(p: Record<string, unknown>): CSSProperties {
  const s: CSSProperties = {};
  const c = colorOf(p.color);
  if (c) s.color = c;
  const bg = colorOf(p.backgroundColor);
  if (bg) s.background = bg;
  if (p.dimColor === true) s.color = 'var(--text-3)';
  if (p.bold === true) s.fontWeight = 600;
  if (p.italic === true) s.fontStyle = 'italic';
  const deco = [p.underline === true && 'underline', p.strikethrough === true && 'line-through'].filter(Boolean).join(' ');
  if (deco) s.textDecoration = deco;
  if (p.inverse === true) Object.assign(s, { color: 'var(--surface)', background: 'var(--text)' });
  if (typeof p.wrap === 'string' && p.wrap.startsWith('truncate')) Object.assign(s, { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
  return s;
}

// 테마 이름 → 앱 토큰, 터미널 색 이름 → 차분한 색. 그 밖은 #hex 만(이름표·url() 같은 건 버린다)
const THEME: Record<string, string> = {
  text: 'var(--text)', inverseText: 'var(--surface)', inactive: 'var(--text-3)', subtle: 'var(--text-3)', suggestion: 'var(--working)',
  remember: 'var(--working)', success: 'var(--idle)', error: 'var(--danger-ink)', warning: 'var(--blocked)', merged: 'var(--working)',
  claude: '#d97757', permission: 'var(--working)', planMode: 'var(--idle)', autoAccept: 'var(--working)', promptBorder: 'var(--line-strong)',
  bashBorder: 'var(--line-strong)', ide: 'var(--working)', diffAdded: 'var(--idle)', diffRemoved: 'var(--danger-ink)',
  diffAddedDimmed: 'var(--text-3)', diffRemovedDimmed: 'var(--text-3)', diffAddedWord: 'var(--idle)', diffRemovedWord: 'var(--danger-ink)',
};
const NAMED: Record<string, string> = {
  black: '#1d1d20', red: '#c0392b', green: '#1f9a62', yellow: '#b8860b', blue: '#2f74e0', magenta: '#9b4dca', cyan: '#138a9e', white: '#e7e7ea',
  gray: '#8a8a92', grey: '#8a8a92', blackBright: '#4a4a52', redBright: '#e05545', greenBright: '#33b77a', yellowBright: '#e0a100',
  blueBright: '#5b9bff', magentaBright: '#b77be0', cyanBright: '#2bb3c8', whiteBright: '#ffffff',
};

export function colorOf(c: unknown): string | undefined {
  if (typeof c !== 'string') return undefined;
  if (THEME[c]) return THEME[c];
  if (NAMED[c]) return NAMED[c];
  return /^#[0-9a-f]{3,8}$/i.test(c) ? c : undefined;
}

export const hrefOk = (h: string) => /^(https?:|file:)/i.test(h.trim());

/** 칸 px → 글자 칸(viewport). 모드가 크기에 맞춰 그리게 */
export const cellsOf = (w: number, h: number) => ({ columns: Math.max(1, Math.floor(w / CX)), rows: Math.max(1, Math.floor(h / 18)) });

/** 누름 재료 — Rust mode_act 가 규약 요청으로 바꾼다(받는 칸만 골라 담는다) */
export type Act =
  | { kind: 'press'; plugin: string; handle: number; key?: string; href?: string; held?: true }
  | { kind: 'input'; plugin: string; handle: number; key?: string; value: string; submit: boolean; held?: true }
  | { kind: 'select'; plugin: string; handle: number; key?: string; value: string; held?: true };

export function actOf(n: TNode, o: { value?: string; submit?: boolean; href?: string } = {}): Act | null {
  if (!('press' in n) || !n.press) return null;
  const base = { plugin: n.press.plugin, handle: n.press.handle, ...(n.key ? { key: n.key } : {}), ...(n.press.held ? { held: true as const } : {}) };
  if (n.type === 'Button') return { kind: 'press', ...base, ...(o.href ? { href: o.href } : {}) };
  if (n.type === 'Input') return { kind: 'input', ...base, value: o.value ?? '', submit: o.submit ?? true };
  if (n.type === 'Select') return { kind: 'select', ...base, value: o.value ?? n.value };
  return null;
}

export type HostState = { alive: boolean; ready: boolean; unsupported: boolean; error: string | null; status?: string | null; panes?: { id: string; title: string; plugin?: string }[]; shown?: string | null; log?: string; pid?: number };

/** 모드 칸이 무엇을 보일까 — 판이 규약을 모름 / 멈춤(다시 켜기) / 띄우는 중 / 그림 */
export function modeNote(s: Pick<HostState, 'alive' | 'ready' | 'unsupported' | 'error'>): 'unsupported' | 'stopped' | 'starting' | 'ok' {
  if (s.unsupported) return 'unsupported';
  if (!s.alive && s.error) return 'stopped';
  return s.alive && s.ready ? 'ok' : 'starting';
}

/** mode_list 한 줄(Rust modes_host::ModeRow). dash = 대시보드 칸이면 어느 대시보드(참모·프로젝트 이름) */
export type ModeRow = { name: string; title: string; source: 'folder' | 'added' | 'plugin' | 'example'; dir: string; whereDefault: string; keepAlive?: boolean; on: boolean; where: string; alive: boolean; pid: number; dash?: string | null; top?: boolean };

/** 따로 창 '항상 위' — 처음엔 mode_list 의 기억(rows), 그 뒤엔 지금 값(boolean)에 Rust 밀림 {subtype:'top', on} 을 얹는다 */
export function modeTop(cur: ModeRow[] | boolean, name: string, msg?: { name: string; ev: { subtype?: string; on?: boolean } }): boolean {
  const now = typeof cur === 'boolean' ? cur : !!cur.find((r) => r.name === name)?.top;
  return msg && msg.name === name && msg.ev?.subtype === 'top' && typeof msg.ev.on === 'boolean' ? msg.ev.on : now;
}

/** 켜졌고 그 자리(panel·modal·full)인 것만 */
export const placedModes = (rows: ModeRow[], where: 'panel' | 'modal' | 'full') => rows.filter((r) => r.on && r.where === where);

/** 스페이스 패널에 붙일 것 — 켜졌고 자리가 패널인 것만 */
export const panelModes = (rows: ModeRow[]) => placedModes(rows, 'panel');

/** 이 대시보드 칸에 붙일 것 — 대상이 이 대시보드를 가리키는 말(참모 이름·id, 프로젝트 이름·폴더) 중 하나와 같을 때만 */
export const dashModes = (rows: ModeRow[], keys: string[]) => {
  const ks = new Set(keys.filter(Boolean));
  return rows.filter((r) => r.on && r.where === 'dash' && !!r.dash && ks.has(r.dash));
};

/** 메뉴 '새 모드 만들기…' — 지금 채팅 탭 참모 입력칸에 넣을 한 줄(보내기는 사람이, 끝에 보여 줄 것을 친다).
 *  모드는 devRoot 프로젝트로 만든다 — 그래야 그 세션이 사이드바에 보이고 문서가 남는다(데이터 폴더 안 세션은 참모 팀 밖) */
export const newModeAsk = () => tr(
  '새 참모 모드를 만들자 — scripts/new-project 로 <이름>-mode 프로젝트를 만들고 그 세션에 /plugin-authoring 으로 만들게 해 줘(표면 desktop, 띠는 AbovePrompt·큰 칸은 Pane, .claude-plugin/chammo.json 에 title·where). claude plugin validate 가 통과하면 scripts/app mode add <그 폴더> 다음 scripts/app mode open <이름>. 보여 줄 것: ',
  'Let\'s make a new Chammo mode — create a <name>-mode project with scripts/new-project and have its session build it with /plugin-authoring (desktop surface, a band in AbovePrompt, a big view in Pane, title and where in .claude-plugin/chammo.json). Once claude plugin validate passes, scripts/app mode add <that folder>, then scripts/app mode open <name>. What it shows: ',
);

/** ui_invalidate 하나에 무엇을 다시 그릴까 — instances 가 있으면 우리 표면(desktop)의 그 칸만, 없으면 다(2.1.296: 상태 쓰기·Client 고장일 때만 instances).
 *  mounted = 지금 그리는 띠(band)·칸(pane id) */
export function staleParts(ev: { instances?: unknown; [k: string]: unknown }, mounted: { band: boolean; pane: string | null }): { band: boolean; pane: boolean } {
  if (!Array.isArray(ev.instances)) return { band: mounted.band, pane: !!mounted.pane };
  const hit = (component: string, id: string | null) =>
    id !== null && (ev.instances as { surface?: unknown; component?: unknown; instance_id?: unknown }[]).some((x) => x && x.surface === 'desktop' && x.component === component && x.instance_id === id);
  return { band: mounted.band && hit('AbovePrompt', 'above-prompt'), pane: hit('Pane', mounted.pane) };
}
