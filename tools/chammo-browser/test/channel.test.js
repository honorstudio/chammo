const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ch = require('../src/channel');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-ch-'));
// 정품 154 · 베타 156 둘 다 깔린 맥(2026-10 이 맥·아이맥 모양)
const both = { chrome: '154.0.8037.98', 'chrome-beta': '156.0.8078.4' };

test('버전 비교 — 자리마다 숫자로', () => {
  assert.equal(ch.cmpVersion('154.0.8037.98', '156.0.1.1'), -1);
  assert.equal(ch.cmpVersion('156.0.8078.4', '156.0.8078.4'), 0);
  assert.equal(ch.cmpVersion('156.0.10.0', '156.0.9.0'), 1);
  assert.equal(ch.cmpVersion('', '1.0'), null);
});

test('새 프로필은 기본(베타가 있으면 베타)으로 고르고 기억한다', () => {
  const d = tmp();
  const r = ch.pickChannel({ profileDir: d, versions: both });
  assert.deepEqual([r.channel, r.why], ['chrome-beta', 'default']);
  ch.remember(d, r.channel);
  assert.equal(ch.readMarker(d), 'chrome-beta');
  assert.equal(ch.pickChannel({ profileDir: d, versions: both }).why, 'remembered');
});

test('기억이 없는 옛 프로필은 Last Version 의 큰 번호가 같은 채널로 — 정품 154 로 만든 프로필을 베타로 열지 않는다(아이맥 project-x)', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'Last Version'), '154.0.8037.98');
  const r = ch.pickChannel({ profileDir: d, versions: both });
  assert.deepEqual([r.channel, r.why], ['chrome', 'last-version']);
  fs.writeFileSync(path.join(d, 'Last Version'), '156.0.8078.4');
  assert.equal(ch.pickChannel({ profileDir: d, versions: both }).channel, 'chrome-beta');
});

test('두 채널보다 오래된 프로필은 기본으로(둘 다 올려 열 수 있다)', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'Last Version'), '149.0.7827.201');
  assert.deepEqual(ch.pickChannel({ profileDir: d, versions: both }).channel, 'chrome-beta');
  assert.deepEqual(ch.pickChannel({ profileDir: d, versions: { chrome: both.chrome } }).channel, 'chrome');
});

test('기억한 채널이 프로필보다 낮은 판이면 열 수 있는 채널로 바꾸고 알린다(낮은 판은 새 프로필을 못 연다)', () => {
  const d = tmp();
  ch.remember(d, 'chrome');
  fs.writeFileSync(path.join(d, 'Last Version'), '156.0.8078.4'); // 누가 베타로 열어 올려 버림
  const r = ch.pickChannel({ profileDir: d, versions: both });
  assert.equal(r.channel, 'chrome-beta');
  assert.match(r.warn, /156/);
});

test('직접 고른 채널(--channel·CHAMMO_BROWSER_CHANNEL)이 이긴다 — 낮은 판이면 알리기만', () => {
  const d = tmp();
  ch.remember(d, 'chrome-beta');
  assert.deepEqual(ch.pickChannel({ profileDir: d, want: 'chrome', versions: both }).why, 'asked');
  assert.equal(ch.pickChannel({ profileDir: d, env: { CHAMMO_BROWSER_CHANNEL: 'chrome' }, versions: both }).channel, 'chrome');
  fs.writeFileSync(path.join(d, 'Last Version'), '156.0.8078.4');
  assert.match(ch.pickChannel({ profileDir: d, want: 'chrome', versions: both }).warn, /156/);
});

test('채널 이름 — chrome·chrome-beta(beta·stable 도 받음), 그 밖은 null', () => {
  assert.equal(ch.normalize('beta'), 'chrome-beta');
  assert.equal(ch.normalize('stable'), 'chrome');
  assert.equal(ch.normalize('Chrome'), 'chrome');
  assert.equal(ch.normalize('chromium'), null);
  assert.equal(ch.normalize(''), null);
});

test('기억 파일이 이상하면 없는 걸로 본다', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, ch.MARKER), 'msedge');
  assert.equal(ch.readMarker(d), null);
});

test('깔린 채널만 — 기억한 채널이 지워졌으면 깔린 쪽으로', () => {
  const d = tmp();
  ch.remember(d, 'chrome-beta');
  const r = ch.pickChannel({ profileDir: d, versions: { chrome: both.chrome } });
  assert.equal(r.channel, 'chrome');
});
