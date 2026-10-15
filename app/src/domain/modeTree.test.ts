import { describe, expect, it } from 'vitest';
import modeCss from '../ui/mode/mode.css?raw';
import { actOf, boxStyle, cellsOf, colorOf, dashModes, START_SLOW_MS, hrefOk, modeNote, modeTop, newModeAsk, normalize, panelModes, placedModes, staleParts, textOf, type ModeRow } from './modeTree';

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
    expect(ok.type === 'Svg' && ok.svg).toBe('<svg viewBox="0 0 4 4"><rect width="4" height="4"/></svg>'); // 거른 글만 — 주소는 그릴 때 지금 테마로(ui/mode/ModeSvg)
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

  // 10/12 달력 모드 글줄 겹침 — height 7 이 가로 칸 폭(8px)으로 56px 이 돼 줄이 포개졌다. 세로는 줄 높이(cellsOf 와 같은 18px)
  it('세로 크기(height·minHeight)는 줄 단위, 가로(width·minWidth)는 글자 칸 단위', () => {
    const s = boxStyle({ width: 10, height: 7, minWidth: 4, minHeight: 2 });
    expect(s).toMatchObject({ width: '80px', height: '126px', minWidth: '32px', minHeight: '36px' });
    expect(cellsOf(100, 126).rows).toBe(7);
    expect(boxStyle({ height: '50%' }).height).toBe('50%');
  });
  it('높이를 정한 Box 는 넘치는 줄을 제 경계에서 자른다(옆 칸 위에 겹쳐 그리지 않게)', () => {
    expect(boxStyle({ height: 3 }).overflow).toBe('hidden');
    expect(boxStyle({ flexDirection: 'column' }).overflow).toBeUndefined();
  });
  it('Client 칸 높이도 줄 단위', () => {
    const n = normalize({ type: 'Client', client: { plugin: 'p' }, props: { module: 'm', key: 'k', width: 10, height: 4 } });
    expect(n.type === 'Client' && n.style).toMatchObject({ width: '80px', height: '72px' });
  });

  // 10/12 실측: 모드 호스트는 모르는 속성이 하나라도 있으면 트리를 통째로 버리고(engine), 모르는 값은 그 속성만 뺀다.
  // 그래서 앱 모양(알약·카드·구분선·막대)은 호스트가 받는 속성의 조합을 보고 렌더러가 고른다(모드 쪽은 hq-mode-kit 의 kit.tsx 함수)
  describe('받는 속성 조합 → 앱 모양(look)', () => {
    const box = (props: Record<string, unknown>, children: unknown[] = []) => { const n = normalize({ type: 'Box', props, children }); if (n.type !== 'Box') throw new Error(n.type); return n; };
    const text = (props: Record<string, unknown>, s: string) => { const n = normalize({ type: 'Text', props, children: [s] }); if (n.type !== 'Text') throw new Error(n.type); return n; };
    it('round + borderDimColor = 카드(흐린 선, 10px 모서리)', () => {
      const n = box({ borderStyle: 'round', borderDimColor: true, paddingX: 1 }, [{ type: 'Text', children: ['머리'] }, { type: 'Text', children: ['본문'] }]);
      expect(n.look).toBe('card');
      expect(n.style).toMatchObject({ border: '1px solid var(--line)', borderRadius: '10px' });
    });
    it('round 상자 안에 Text 하나 = 알약(tag)', () => {
      expect(box({ borderStyle: 'round', borderColor: 'success' }, [{ type: 'Text', children: ['끝'] }]).look).toBe('tag');
      expect(box({ borderStyle: 'round' }, [{ type: 'Text', children: ['a'] }, { type: 'Text', children: ['b'] }]).look).toBeUndefined();
      expect(box({ borderStyle: 'single' }, [{ type: 'Text', children: ['a'] }]).look).toBeUndefined();
    });
    it('borderDimColor 만 = 흐린 선', () => {
      expect(box({ borderStyle: 'single', borderDimColor: true }, [{ type: 'Text', children: ['a'] }, { type: 'Text', children: ['b'] }]).style.border).toBe('1px solid var(--line)');
    });
    it('backgroundColor 가 있는 Text = 칩(꽉 찬 알약)', () => {
      expect(text({ backgroundColor: 'success', color: 'inverseText' }, ' 끝 5 ').look).toBe('chip');
      expect(text({ color: 'success' }, '끝 5').look).toBeUndefined();
    });
    it('─ 만 있는 Text(3자 이상) = 구분선', () => {
      expect(text({ dimColor: true }, '────────').look).toBe('divider');
      expect(text({}, '──').look).toBeUndefined();
      expect(text({}, '── 제목 ──').look).toBeUndefined();
    });
    // 10/12 schedule-mode: 14% 칸 카드 안 알약이 칸 밖으로 넘치고(알약이 글 폭 그대로), 겹 Text 말줄임이 두 줄로 감겼다
    it('truncate Text 는 trunc 표시 — 안쪽 Text 가 줄바꿈을 다시 걸지 않게(.mdv-trunc .mdv-text)', () => {
      const n = normalize({ type: 'Text', props: { wrap: 'truncate-end' }, children: [{ type: 'Text', props: { dimColor: true }, children: ['11:00'] }, ' ', { type: 'Text', children: ['카드뉴스 시안 검토'] }] });
      expect(n.type === 'Text' && n.trunc).toBe(true);
      expect(text({}, '그냥 글').trunc).toBeUndefined();
      expect(text({ wrap: 'wrap' }, '그냥 글').trunc).toBeUndefined();
    });
    it('카드 안 알약은 칸 폭까지만 — 알약 max-width 100%·min-width 0, 카드는 넘침 자름, 말줄임 안쪽 글은 white-space inherit', () => {
      const rule = (sel: string) => (modeCss.match(new RegExp(`${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`)) ?? [])[1] ?? '';
      expect(rule('.mdv-box.mdv-look-tag')).toMatch(/max-width:\s*100%/);
      expect(rule('.mdv-box.mdv-look-tag')).toMatch(/min-width:\s*0/);
      expect(rule('.mdv-box.mdv-look-card')).toMatch(/overflow:\s*hidden/);
      expect(rule('.mdv-trunc .mdv-text')).toMatch(/white-space:\s*inherit/);
    });
    it('█·░ 만 있는 Text = 진행 막대, 채운 비율을 --mdv-pct 로', () => {
      const n = text({ color: 'success' }, '██████░░░░');
      expect(n.look).toBe('bar');
      expect(n.style).toMatchObject({ '--mdv-pct': '60%' });
      expect(text({}, '░░░░').style).toMatchObject({ '--mdv-pct': '0%' });
    });
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

// 10/13 사용자: 호스트가 없는데 까닭도 없으면 '모드 켜는 중'이 영원히 돌았다 — 오래 걸리면 다시 켜기를 보인다
describe('모드 켜는 중이 오래 걸리면', () => {
  const s = { alive: false, ready: false, unsupported: false, error: null };
  it('정한 시간이 지나면 slow — 다시 켜기 단추와 까닭 한 줄', () => {
    expect(modeNote(s, false)).toBe('starting');
    expect(modeNote(s, true)).toBe('slow');
    expect(modeNote({ ...s, alive: true, ready: true }, true)).toBe('ok');
    expect(START_SLOW_MS).toBeGreaterThanOrEqual(30_000);
    expect(START_SLOW_MS).toBeLessThanOrEqual(90_000);
  });
});

// 10/13 참모-7: scripts/app mode open x --where dash 참모-7 이 짧은 이름으로 저장돼 칸이 안 떴다(이젠 Rust 가 전체 이름으로 맞추지만, 이미 저장된 것도 보이게)
describe('대시보드 칸 — 짧은 이름으로 저장된 것도 그 참모 칸에', () => {
  const r = (dash: string): ModeRow => ({ name: 'm', title: 'M', source: 'added', dir: '/H/m', whereDefault: 'dash', on: true, where: 'dash', alive: true, pid: 0, dash });
  it('기본 이름(" · " 앞)이 같으면 같은 참모', () => {
    expect(dashModes([r('참모-7')], ['참모-7 · 가나 담당', 'a1'])).toHaveLength(1);
    expect(dashModes([r('참모-7 · 옛 역할')], ['참모-7 · 가나 담당'])).toHaveLength(1);
    expect(dashModes([r('참모-70')], ['참모-7 · 가나 담당'])).toHaveLength(0);
    expect(dashModes([r('참모-7')], ['참모-8 · 다라 담당'])).toHaveLength(0);
  });
});

