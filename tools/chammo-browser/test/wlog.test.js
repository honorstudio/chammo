const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { attachLog } = require('../src/wlog');

// 2026-10-29 — 세션 MCP 로그(~/Library/Caches/claude-cli-nodejs/*/mcp-logs-*)엔 래퍼 stderr 가 안 남는다(10-28 한 세션 로그 255줄 중 0).
// 래퍼가 무엇을 버리고 무엇이 실패했는지 <브라우저 루트>/run/<프로필>.log 에 직접 남긴다
function rig(max) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-wlog-'));
  const file = path.join(dir, 'run', 'shop.log');
  const seen = [];
  const con = { error: (...a) => seen.push(a.join(' ')) };
  attachLog({ file, con, max, now: () => new Date('2026-10-29T00:00:00Z') });
  return { file, con, seen };
}

test('stderr 로 가던 줄을 그대로 보내고 파일에도 시각과 같이 남긴다(600)', () => {
  const r = rig();
  r.con.error('[chammo-browser-mcp] 다시 띄우기 실패:', 'x');
  assert.deepStrictEqual(r.seen, ['[chammo-browser-mcp] 다시 띄우기 실패: x'], 'stderr 는 그대로');
  assert.strictEqual(fs.readFileSync(r.file, 'utf8'), '2026-10-29T00:00:00.000Z [chammo-browser-mcp] 다시 띄우기 실패: x\n');
  assert.strictEqual(fs.statSync(r.file).mode & 0o777, 0o600);
});

test('너무 커지면 뒤 절반만 남긴다 — 오래 도는 래퍼가 디스크를 안 먹게', () => {
  const r = rig(200);
  for (let i = 0; i < 20; i++) r.con.error(`줄 ${i}`);
  const t = fs.readFileSync(r.file, 'utf8');
  assert.ok(Buffer.byteLength(t) <= 200 + 64, `크기 ${Buffer.byteLength(t)}`);
  assert.ok(t.includes('줄 19'), '마지막 줄은 남는다');
  assert.ok(!t.includes('줄 0\n'), '앞쪽은 버린다');
  assert.ok(t.split('\n')[0].startsWith('2026-'), '잘린 줄로 시작하지 않는다');
});

test('못 쓰는 자리여도 래퍼를 안 죽인다', () => {
  const seen = [];
  const con = { error: (...a) => seen.push(a.join(' ')) };
  attachLog({ file: '/dev/null/x/shop.log', con });
  assert.doesNotThrow(() => con.error('그래도 간다'));
  assert.deepStrictEqual(seen, ['그래도 간다']);
});
