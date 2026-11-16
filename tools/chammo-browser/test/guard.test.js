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

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { markMissing, missingFile, MSG } = require('../src/guard');

test('#28 — 못 찾음 안내는 \'설치\'가 아니라 실제로 보이는 \'다시 찾기\'와 세션 다시 켜기를 준다', () => {
  assert.match(MSG, /다시 찾기/);
  assert.match(MSG, /Find again/);
  assert.match(MSG, /다시 켜/);
  assert.doesNotMatch(MSG, /크롬 베타/); // 윈도우 기본은 정식 — 베타만 없다고 말하지 않는다
});

test('#28 — 못 찾은 래퍼는 앱 도구 폴더에 .missing 을 남기고, 찾으면 지운다. 앱 폴더가 없으면 안 쓴다', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-missing-'));
  markMissing(d, true, 'p1');
  assert.strictEqual(fs.existsSync(missingFile(d)), false, '앱 도구 폴더가 없는 기계엔 안 만든다');
  fs.mkdirSync(path.dirname(missingFile(d)), { recursive: true });
  markMissing(d, true, 'p1', () => '2026-01-01T00:00:00.000Z');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(missingFile(d), 'utf8')), { profile: 'p1', at: '2026-01-01T00:00:00.000Z' });
  markMissing(d, false, 'p2');
  assert.strictEqual(fs.existsSync(missingFile(d)), false);
  markMissing(d, false, 'p2'); // 없을 때 지워도 조용히
  fs.rmSync(d, { recursive: true, force: true });
});
