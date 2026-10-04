const { test } = require('node:test');
const assert = require('node:assert');
const { guardTool } = require('../src/guard');

test('browser_install 은 늘 막는다 — 관리자 암호에서 멈추거나 Chrome for Testing 을 받는 길', () => {
  const r = guardTool('browser_install', true);
  assert.ok(r && r.isError);
  assert.match(r.content[0].text, /Chammo/);
  assert.doesNotMatch(r.content[0].text, /npx playwright install chrome/); // 따라 칠 명령을 주지 않는다
});

test('크롬이 하나도 없으면 브라우저 도구를 \'설치\' 안내로 막는다, 있으면 통과', () => {
  assert.ok(guardTool('browser_navigate', false).isError);
  assert.strictEqual(guardTool('browser_navigate', true), null);
  assert.strictEqual(guardTool('browser_close', false), null); // 닫기는 아무 일도 안 하니 그대로
  assert.strictEqual(guardTool('browser_ask_human', false), null); // 래퍼 도구는 래퍼가 맡는다
});
