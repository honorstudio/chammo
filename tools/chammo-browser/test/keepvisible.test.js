const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { keepVisible, matches } = require('../src/keepvisible');
const { placement } = require('../src/window');

// 숨기지 않을 프로필 — 운영 수집처럼 사람이 창을 직접 봐야 하는 크롬(캡차·스크롤 확인). 윈도우 숨은 데스크톱·앱 안전망(win_stray)이 같은 목록
test('이름 그대로·앞자리* 가 맞고, 대소문자는 안 가린다', () => {
  assert.ok(matches('shop-scraper', ['shop-scraper']));
  assert.ok(matches('Shop-Scraper-b', ['shop-scraper*']));
  assert.ok(!matches('tax-site', ['shop-scraper*']));
  assert.ok(!matches('shop', ['shop-scraper*']));
  assert.ok(!matches('x', 'x'), '배열이 아니면 아무것도 안 맞는다');
  assert.ok(!matches('x', ['', '*x', 3]), '빈 줄·숫자는 무시, 앞 * 는 글자 그대로');
});

test('목록 파일은 <데이터>/browser/keep-visible.json — 없거나 깨졌으면 아무것도 안 뺀다', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'keepvis-'));
  assert.strictEqual(keepVisible(d, 'shop-scraper'), false);
  fs.mkdirSync(path.join(d, 'browser'));
  fs.writeFileSync(path.join(d, 'browser', 'keep-visible.json'), '{깨짐');
  assert.strictEqual(keepVisible(d, 'shop-scraper'), false);
  fs.writeFileSync(path.join(d, 'browser', 'keep-visible.json'), JSON.stringify(['shop-*']));
  assert.strictEqual(keepVisible(d, 'shop-scraper'), true);
  assert.strictEqual(keepVisible(d, 'tax-site'), false);
});

test('윈도우: 목록에 있는 프로필은 숨은 데스크톱으로 안 보낸다', () => {
  const base = { profile: 'shop-scraper', watchable: true, appHere: true, vdFile: '/없음', mac: false, win: true, wait: 0 };
  assert.strictEqual(placement(base).desk, true);
  assert.ok(!placement({ ...base, keep: true }).desk);
});
