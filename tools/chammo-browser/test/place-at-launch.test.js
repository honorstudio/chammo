const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { swapPlace, askApp } = require('../src/place-at-launch');

// 2026-10-20: 가짜 화면을 필요할 때만 띄우니 세션 시작 때 정한 자리가 크롬이 뜰 때쯤 낡는다 — 뜰 때 자리를 다시 넣는다
test('크롬이 뜰 때 창 자리·크기 인자만 새 값으로 바꾼다', () => {
  const args = ['--test-type', '--window-position=9000,0', '--window-size=1280,800', '--remote-debugging-port=0', '--user-data-dir=/p'];
  assert.deepStrictEqual(swapPlace(args, { pos: [-2886, 980], size: [1394, 852] }),
    ['--test-type', '--window-position=-2886,980', '--window-size=1394,852', '--remote-debugging-port=0', '--user-data-dir=/p']);
  // 새 자리에 크기가 없으면 크기 인자는 뺀다(크롬이 정하게)
  assert.deepStrictEqual(swapPlace(['--window-position=1,2', '--window-size=3,4', '--x'], { pos: [5, 6], size: null }), ['--window-position=5,6', '--x']);
  // 자리를 못 정했으면 그대로
  assert.deepStrictEqual(swapPlace(['--window-position=1,2'], { pos: null, size: null }), ['--window-position=1,2']);
});

test('앱에 가짜 화면 부탁 — 데이터 폴더 app.jsonl 에 한 줄', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-ask-'));
  askApp(d);
  const line = JSON.parse(fs.readFileSync(path.join(d, 'app.jsonl'), 'utf8').trim());
  assert.strictEqual(line.action, 'vdisplay');
  assert.deepStrictEqual(line.arg, { verb: 'want' });
  assert.match(line.id, /^[0-9a-f]{12}$/);
  assert.doesNotThrow(() => askApp(path.join(d, 'no', 'such')), '못 써도 크롬은 뜬다');
});
