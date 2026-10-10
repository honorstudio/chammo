import { describe, expect, it } from 'vitest';
import { clientTree, frameMsg, frameUrl, PostGate } from './modeClient';
import { actOf, normalize } from './modeTree';

// 2.1.296 실측(.shots/feature-chammo-mode-2/probe): Pane 트리에 실린 Client 마디
const CLIENT = { type: 'Client', props: { key: 'b1', module: 'hooks/board.tsx', props: { start: 5 } }, client: { plugin: 'tick' } };

describe('Client 마디', () => {
  it('플러그인·모듈·열쇠·props 를 담고, 크기는 Box 처럼', () => {
    expect(normalize(CLIENT)).toEqual({ type: 'Client', plugin: 'tick', module: 'hooks/board.tsx', key: 'b1', props: { start: 5 }, style: {} });
    const sized = normalize({ ...CLIENT, props: { ...CLIENT.props, width: 20, height: 6, flexGrow: 1 } });
    expect(sized.type === 'Client' && sized.style).toEqual({ width: '160px', height: '48px', flexGrow: 1 });
  });

  it('플러그인·모듈·열쇠가 없으면 못 그림', () => {
    expect(normalize({ type: 'Client', props: { key: 'b1' }, client: { plugin: 'tick' } })).toMatchObject({ type: 'Cant', what: 'Client' });
    expect(normalize({ type: 'Client', props: { key: 'b1', module: 'hooks/b.tsx' } })).toMatchObject({ type: 'Cant', what: 'Client' });
  });
});

describe('clientTree — 방이 보낸 트리 글', () => {
  // 방 런타임(exportTree)이 내는 모양: 누를 것엔 press 대신 held 번호
  const TEXT = JSON.stringify({ type: 'Box', props: { gap: 1 }, children: [
    { type: 'Text', children: ['count ', '5'] },
    { type: 'Button', props: { key: 'up', label: 'Up' }, held: 3 },
    { type: 'Input', props: { key: 'q' }, held: 4 },
  ] });

  it('held 번호를 누름 손잡이로 — 누르면 방 쪽 누름(held)', () => {
    const t = clientTree(TEXT);
    if (t.type !== 'Box') throw new Error(t.type);
    const b = t.children[1]!;
    expect(b.type === 'Button' && b.press).toEqual({ plugin: '', handle: 3, held: true });
    expect(actOf(b)).toEqual({ kind: 'press', plugin: '', handle: 3, key: 'up', held: true });
    expect(actOf(t.children[2]!, { value: 'x', submit: false })).toMatchObject({ kind: 'input', handle: 4, key: 'q', held: true, value: 'x', submit: false });
  });

  it('방 트리 안에선 press(모드 손잡이)를 안 믿는다 — 방이 남의 핸들을 못 누르게', () => {
    const t = clientTree(JSON.stringify({ type: 'Button', props: { key: 'x' }, press: { plugin: 'other', handle: 7 } }));
    expect(t.type === 'Button' && t.press).toBeNull();
  });

  it('방 트리 안 Client·Svg 는 못 그림', () => {
    expect(clientTree(JSON.stringify(CLIENT))).toMatchObject({ type: 'Cant', what: 'Client' });
    expect(clientTree(JSON.stringify({ type: 'Svg', props: { source: '<svg/>' } }))).toMatchObject({ type: 'Cant', what: 'Svg' });
  });

  it('깨진 글·너무 긴 글·글 아닌 것은 못 그림', () => {
    expect(clientTree('{nope')).toMatchObject({ type: 'Cant' });
    expect(clientTree('x'.repeat(200_001))).toMatchObject({ type: 'Cant' });
    expect(clientTree(42)).toMatchObject({ type: 'Cant' });
  });
});

describe('frameMsg — 방에서 온 말(믿지 않는다)', () => {
  it('아는 모양만', () => {
    expect(frameMsg({ mf: 'ready' })).toEqual({ mf: 'ready' });
    expect(frameMsg({ mf: 'tree', text: '{}' })).toEqual({ mf: 'tree', text: '{}' });
    expect(frameMsg({ mf: 'post', text: '{"n":1}' })).toEqual({ mf: 'post', data: { n: 1 } });
    expect(frameMsg({ mf: 'fault', phase: 'run', reason: 'boom' })).toEqual({ mf: 'fault', phase: 'run', reason: 'boom' });
  });

  it('모르는 것·틀린 모양·한도 넘은 글은 버린다', () => {
    for (const bad of [null, 'x', { mf: 'eval', code: '1' }, { mf: 'tree', text: 1 }, { mf: 'post', text: 'not json' }, { mf: 'post', text: 'null' },
      { mf: 'post', text: JSON.stringify({ a: 'x'.repeat(100_001) }) }, { mf: 'fault', phase: 'boot', reason: 'x' }, { hodoc: 'esc' }])
      expect(frameMsg(bad), JSON.stringify(bad)?.slice(0, 40)).toBeNull();
    const f = frameMsg({ mf: 'fault', phase: 'load', reason: `a\nb${'c'.repeat(400)}` });
    expect(f && f.mf === 'fault' && f.reason.length).toBe(200);
    expect(f && f.mf === 'fault' && f.reason.includes('\n')).toBe(false);
  });
});

describe('PostGate — 글 보내기 홍수 막이', () => {
  it('1초에 20개까지, 다음 초엔 다시', () => {
    const g = new PostGate(20);
    const ok = Array.from({ length: 25 }, () => g.take(1000)).filter(Boolean).length;
    expect(ok).toBe(20);
    expect(g.take(2001)).toBe(true);
  });
});

describe('frameUrl', () => {
  it('맥은 modeframe://, 윈도우는 http://modeframe.localhost', () => {
    expect(frameUrl(false)).toBe('modeframe://localhost/');
    expect(frameUrl(true)).toBe('http://modeframe.localhost/');
  });
});
