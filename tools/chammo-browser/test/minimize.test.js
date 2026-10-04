const { test } = require('node:test');
const assert = require('node:assert');
const { minimizePulledIn } = require('../src/minimize');

// 크롬 CDP 흉내 — 탭 둘(같은 창) + 탭 하나(다른 창)
function fakeWS(windows) {
  const sent = [];
  class WS {
    constructor() { setTimeout(() => this.onopen && this.onopen(), 0); }
    send(s) {
      const m = JSON.parse(s);
      sent.push(m);
      let result = {};
      if (m.method === 'Target.getTargets') result = { targetInfos: [{ type: 'page', targetId: 'a' }, { type: 'page', targetId: 'b' }, { type: 'page', targetId: 'c' }, { type: 'service_worker', targetId: 'w' }] };
      if (m.method === 'Browser.getWindowForTarget') result = windows[m.params.targetId];
      setTimeout(() => this.onmessage({ data: JSON.stringify({ id: m.id, result }) }), 0);
    }
    close() {}
  }
  return { WS, sent };
}

test('화면 밖에 띄웠는데 크롬이 화면 안으로 끌어온 창만 최소화(창마다 한 번)', async () => {
  const off = [9000, 0];
  const { WS, sent } = fakeWS({
    a: { windowId: 1, bounds: { left: 24, top: 48, windowState: 'normal' } },
    b: { windowId: 1, bounds: { left: 24, top: 48, windowState: 'normal' } },
    c: { windowId: 2, bounds: { left: 9000, top: 0, windowState: 'normal' } },
  });
  const n = await minimizePulledIn({ port: 1, wsPath: '/x' }, off, WS);
  assert.strictEqual(n, 1);
  const mins = sent.filter((m) => m.method === 'Browser.setWindowBounds');
  assert.deepStrictEqual(mins.map((m) => [m.params.windowId, m.params.bounds.windowState]), [[1, 'minimized']]);
});

test('WebSocket 이 없는 노드면 아무것도 안 함', async () => {
  assert.strictEqual(await minimizePulledIn({ port: 1, wsPath: '/x' }, [9000, 0], undefined), 0);
});
