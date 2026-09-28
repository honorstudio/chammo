const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { dataDir, browserRoot, checkProfile } = require('../src/paths');

const HOME = '/home/tester';
const none = () => false;
const only = (...dirs) => (d) => dirs.includes(d);

test('dataDir: CHAMMO_HOME 이 있으면 그대로 (~ 풀어서, 앞뒤 공백 무시)', () => {
  assert.strictEqual(dataDir({ home: HOME, env: { CHAMMO_HOME: '/data/c' }, exists: none }), '/data/c');
  assert.strictEqual(dataDir({ home: HOME, env: { CHAMMO_HOME: ' ~/x ' }, exists: none }), path.join(HOME, 'x'));
});

test('dataDir: 없으면 ~/.chammo', () => {
  assert.strictEqual(dataDir({ home: HOME, env: {}, exists: none }), path.join(HOME, '.chammo'));
  assert.strictEqual(dataDir({ home: HOME, env: { CHAMMO_HOME: '  ' }, exists: none }), path.join(HOME, '.chammo'));
});

test('dataDir: 새 폴더가 없고 옛 폴더만 있으면 옛 폴더(예전 설치)', () => {
  const old = path.join(HOME, '.honor-orchestrator');
  assert.strictEqual(dataDir({ home: HOME, env: {}, exists: only(old) }), old);
  // 둘 다 있으면 새 폴더가 이긴다
  const both = only(old, path.join(HOME, '.chammo'));
  assert.strictEqual(dataDir({ home: HOME, env: {}, exists: both }), path.join(HOME, '.chammo'));
});

test('browserRoot: 기본은 <데이터 폴더>/browser, CHAMMO_BROWSER_HOME 이 우선', () => {
  assert.strictEqual(browserRoot({ home: HOME, env: {}, exists: none }), path.join(HOME, '.chammo', 'browser'));
  assert.strictEqual(browserRoot({ home: HOME, env: { CHAMMO_HOME: '/d' }, exists: none }), path.join('/d', 'browser'));
  assert.strictEqual(
    browserRoot({ home: HOME, env: { CHAMMO_HOME: '/d', CHAMMO_BROWSER_HOME: '~/b' }, exists: none }),
    path.join(HOME, 'b'),
  );
});

test('checkProfile: 폴더 이름으로 쓸 수 있는 이름만 통과', () => {
  for (const ok of ['acme-shop', 'my.site_2', '한글 프로젝트']) assert.strictEqual(checkProfile(ok), null, ok);
  for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'a\0b', '.hidden', undefined]) {
    assert.ok(checkProfile(bad), `거부해야 함: ${JSON.stringify(bad)}`);
  }
});
