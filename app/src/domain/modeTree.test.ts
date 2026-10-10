import { describe, expect, it } from 'vitest';
import { actOf, boxStyle, cellsOf, colorOf, dashModes, hrefOk, modeNote, modeTop, newModeAsk, normalize, panelModes, placedModes, staleParts, textOf, type ModeRow } from './modeTree';

// 2.1.296 실측 트리(.shots/feature-chammo-mode/probe-2.1.296.txt) 그대로
const BAND = { type: 'Box', props: { gap: 1 }, children: [
  { type: 'Text', props: { color: 'cyan' }, children: ['Pressed ', '0'] },
  { type: 'Button', props: { key: 'inc', label: 'Up', variant: 'primary' }, press: { plugin: 'counter', handle: 445189693 } },
] };

describe('normalize', () => {
  it('규약 트리를 그릴 마디로 — 글 조각은 그대로, 누름 손잡이는 붙여 둔다', () => {
    const n = normalize(BAND);
    expect(n.type).toBe('Box');
    if (n.type !== 'Box') return;
    expect(n.children.map((c) => c.type)).toEqual(['Text', 'Button']);
    const b = n.children[1]!;
    expect(b.type === 'Button' && b.press).toEqual({ plugin: 'counter', handle: 445189693 });
    expect(textOf(n.children[0]!)).toBe('Pressed 0');
  });

  it('Svg 는 거른 뒤 data: 그림으로, 걸러지면 못 그림 칸(alt)', () => {
    const ok = normalize({ type: 'Svg', props: { source: '<svg viewBox="0 0 4 4"><rect width="4" height="4"/></svg>', alt: '상자' } });
    expect(ok).toMatchObject({ type: 'Svg', alt: '상자' });
    expect(ok.type === 'Svg' && ok.src.startsWith('data:image/svg+xml;')).toBe(true);
    expect(normalize({ type: 'Svg', props: { source: '<svg onload="alert(1)"/>', alt: '상자' } })).toEqual({ type: 'Cant', what: 'Svg', alt: '상자' });
    expect(normalize({ type: 'Svg', props: {} })).toEqual({ type: 'Cant', what: 'Svg', alt: '' });
  });

  it('모르는 것·엔진 몫은 못 그림 칸', () => {
    expect(normalize({ type: 'Client', props: { module: './x.tsx' } })).toEqual({ type: 'Cant', what: 'Client', alt: '' });
    expect(normalize({ type: 'engine', ref: 1 })).toEqual({ type: 'Cant', what: 'engine', alt: '' });
    expect(normalize({ type: 'Marquee' })).toEqual({ type: 'Cant', what: 'Marquee', alt: '' });
    expect(normalize(null)).toEqual({ type: 'Cant', what: '?', alt: '' });
  });

  it('너무 깊은 트리는 자른다(32단)', () => {
    let t: unknown = { type: 'Text', children: ['끝'] };
    for (let i = 0; i < 40; i++) t = { type: 'Box', children: [t] };
    let n = normalize(t);
    let depth = 0;
    while (n.type === 'Box' && n.children[0]) { n = n.children[0]; depth++; }
    expect(depth).toBeLessThanOrEqual(32);
    expect(n.type).toBe('Cant');
  });

  it('Input·Select·Link·Code·Markdown 칸을 받는다', () => {
    const f = normalize({ type: 'Box', children: [
      { type: 'Input', props: { key: 'name', label: 'Name', placeholder: 'type' }, press: { plugin: 'f', handle: 1 } },
      { type: 'Select', props: { key: 'pick', options: [{ value: 'a', label: 'A' }, { value: 'b' }], value: 'a' }, press: { plugin: 'f', handle: 2 } },
      { type: 'Link', props: { href: 'https://example.com', label: 'ex' } },
      { type: 'Code', props: { source: 'let a = 1', language: 'ts' } },
      { type: 'Markdown', props: { text: '- **1**' } },
    ] });
    if (f.type !== 'Box') throw new Error();
    const [i, s, l, c, m] = f.children;
    expect(i).toMatchObject({ type: 'Input', key: 'name', label: 'Name', placeholder: 'type' });
    expect(s).toMatchObject({ type: 'Select', value: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'b' }] });
    expect(l).toMatchObject({ type: 'Link', href: 'https://example.com', label: 'ex' });
    expect(c).toMatchObject({ type: 'Code', source: 'let a = 1', language: 'ts' });
    expect(m).toMatchObject({ type: 'Markdown', text: '- **1**' });
  });
});

describe('그리기 모양', () => {
  it('Box 칸 단위는 글자 칸 — 가로 8px, 세로 줄 높이', () => {
    expect(boxStyle({ flexDirection: 'column', gap: 1, padding: 1, borderStyle: 'round', width: '50%' })).toMatchObject({
      display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px 8px', width: '50%',
    });
    expect(boxStyle({ display: 'none' }).display).toBe('none');
    expect(boxStyle({ paddingX: 2, marginTop: 1 })).toMatchObject({ paddingLeft: '16px', paddingRight: '16px', marginTop: '4px' });
  });

  it('색은 테마 이름·터미널 이름·#hex 만 — 나머지는 버린다', () => {
    expect(colorOf('success')).toBe('var(--idle)');
    expect(colorOf('cyan')).toMatch(/^#|^var\(/);
    expect(colorOf('#a1b2c3')).toBe('#a1b2c3');
    expect(colorOf('red; background: url(x)')).toBeUndefined();
    expect(colorOf(undefined)).toBeUndefined();
  });

  it('링크는 http·https·file 만 연다', () => {
    expect(hrefOk('https://example.com')).toBe(true);
    expect(hrefOk('file:///Users/a/b.md')).toBe(true);
    expect(hrefOk('javascript:alert(1)')).toBe(false);
    expect(hrefOk('data:text/html,x')).toBe(false);
  });

  it('칸 크기 px → 글자 칸', () => {
    expect(cellsOf(800, 360)).toEqual({ columns: 100, rows: 20 });
    expect(cellsOf(0, 0)).toEqual({ columns: 1, rows: 1 });
  });
});

describe('누름', () => {
  it('Button·Input·Select → 규약 요청 재료(마지막 트리의 손잡이)', () => {
    const b = { type: 'Button' as const, key: 'inc', label: 'Up', primary: true, plain: false, dim: false, kids: [], press: { plugin: 'counter', handle: 7 } };
    expect(actOf(b)).toEqual({ kind: 'press', plugin: 'counter', handle: 7, key: 'inc' });
    const i = { type: 'Input' as const, key: 'name', label: '', placeholder: '', value: '', submitLabel: '', press: { plugin: 'f', handle: 1 } };
    expect(actOf(i, { value: 'hi' })).toEqual({ kind: 'input', plugin: 'f', handle: 1, key: 'name', value: 'hi', submit: true });
    const s = { type: 'Select' as const, key: 'pick', label: '', value: 'a', options: [], press: { plugin: 'f', handle: 2 } };
    expect(actOf(s, { value: 'b' })).toEqual({ kind: 'select', plugin: 'f', handle: 2, key: 'pick', value: 'b' });
    expect(actOf({ ...b, press: null })).toBeNull();
  });
});

describe('모드 칸 머리 글', () => {
  it('판이 규약을 모르면 한 줄, 멈췄으면 다시 켜기, 띄우는 중', () => {
    expect(modeNote({ alive: false, ready: false, unsupported: true, error: null })).toBe('unsupported');
    expect(modeNote({ alive: false, ready: false, unsupported: false, error: 'exit 1' })).toBe('stopped');
    expect(modeNote({ alive: true, ready: false, unsupported: false, error: null })).toBe('starting');
    expect(modeNote({ alive: true, ready: true, unsupported: false, error: null })).toBe('ok');
    expect(modeNote({ alive: false, ready: false, unsupported: false, error: null })).toBe('starting');
  });
});

const row = (name: string, on: boolean, where: string, dash: string | null = null): ModeRow => ({ name, title: name, source: 'folder', dir: '', whereDefault: 'window', on, where, alive: on, pid: 0, dash });

describe('스페이스 패널', () => {
  it('켜졌고 자리가 패널인 모드만 붙인다', () => {
    expect(panelModes([row('a', true, 'panel'), row('b', true, 'window'), row('c', false, 'panel')]).map((x) => x.name)).toEqual(['a']);
  });
});

describe('미리보기·꽉 채우기', () => {
  it('켜졌고 그 자리인 것만', () => {
    const rows = [row('a', true, 'modal'), row('b', true, 'full'), row('c', false, 'modal'), row('d', true, 'panel')];
    expect(placedModes(rows, 'modal').map((x) => x.name)).toEqual(['a']);
    expect(placedModes(rows, 'full').map((x) => x.name)).toEqual(['b']);
  });
});

describe('대시보드 칸', () => {
  it('대상이 이 대시보드 이름·id·폴더 중 하나와 같을 때만', () => {
    const rows = [row('a', true, 'dash', 'helper-2'), row('b', true, 'dash', '/u/dev/shop'), row('c', true, 'dash', 'shop'), row('d', false, 'dash', 'helper-2'), row('e', true, 'panel')];
    expect(dashModes(rows, ['helper-2', 'sess-1']).map((x) => x.name)).toEqual(['a']);
    expect(dashModes(rows, ['shop', '/u/dev/shop']).map((x) => x.name)).toEqual(['b', 'c']);
    expect(dashModes(rows, [])).toEqual([]);
    expect(dashModes([row('x', true, 'dash', null)], ['', 'helper-2'])).toEqual([]);
  });
});

describe('따로 창 항상 위', () => {
  it('목록의 기억을 읽고, 밀림(top)이 오면 그 값 — 다른 모드·다른 밀림은 그대로', () => {
    const rows = [{ ...row('a', true, 'window'), top: true }, row('b', true, 'window')];
    expect(modeTop(rows, 'a')).toBe(true);
    expect(modeTop(rows, 'b')).toBe(false);
    expect(modeTop(rows, 'none')).toBe(false);
    expect(modeTop(false, 'a', { name: 'a', ev: { subtype: 'top', on: true } })).toBe(true);
    expect(modeTop(true, 'a', { name: 'a', ev: { subtype: 'top', on: false } })).toBe(false);
    expect(modeTop(true, 'a', { name: 'b', ev: { subtype: 'top', on: false } })).toBe(true);
    expect(modeTop(true, 'a', { name: 'a', ev: { subtype: 'ready' } })).toBe(true);
  });
});

describe('새 모드 만들기', () => {
  it('참모에게 넣을 한 줄 — 프로젝트로 만들고(/plugin-authoring) 검사 뒤 더하고 켠다, 끝은 보여 줄 것 자리', () => {
    const t = newModeAsk();
    for (const k of ['scripts/new-project', '/plugin-authoring', 'AbovePrompt', 'Pane', 'claude plugin validate', 'scripts/app mode add', 'scripts/app mode open']) expect(t).toContain(k);
    expect(t.endsWith(': ')).toBe(true);
    expect(t).not.toMatch(/\n/);
  });
});

describe('staleParts — 밀림 하나에 무엇을 다시 그릴까', () => {
  const on = { band: true, pane: 'board' };
  it('instances 가 없으면 띠·칸 다', () => {
    expect(staleParts({ subtype: 'ui_invalidate', event: 'ui.render' }, on)).toEqual({ band: true, pane: true });
  });
  it('instances 가 있으면 우리(desktop) 것 중 그 칸만', () => {
    const ev = (xs: object[]) => ({ subtype: 'ui_invalidate', event: 'ui.render', instances: xs });
    expect(staleParts(ev([{ surface: 'desktop', component: 'Pane', instance_id: 'board' }]), on)).toEqual({ band: false, pane: true });
    expect(staleParts(ev([{ surface: 'desktop', component: 'AbovePrompt', instance_id: 'above-prompt' }]), on)).toEqual({ band: true, pane: false });
    expect(staleParts(ev([{ surface: 'desktop', component: 'Pane', instance_id: 'other' }]), on)).toEqual({ band: false, pane: false });
    expect(staleParts(ev([{ surface: 'mobile', component: 'Pane', instance_id: 'board' }]), on)).toEqual({ band: false, pane: false });
    expect(staleParts(ev([{ surface: 'desktop', component: 'Pane', instance_id: 'board' }]), { band: true, pane: null })).toEqual({ band: false, pane: false });
  });
  it('모양이 이상한 instances 는 없는 것으로(다 그린다 — 늘 맞는 쪽)', () => {
    expect(staleParts({ subtype: 'ui_invalidate', instances: 'x' }, on)).toEqual({ band: true, pane: true });
  });
});
