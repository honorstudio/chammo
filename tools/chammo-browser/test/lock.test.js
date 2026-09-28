const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lock = require('../src/lock');

function tmpLockDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-lock-'));
}
const DEAD_PID = 999999; // 존재하지 않는 pid

test('acquire: 빈 상태에서 락 획득 성공 + 락 파일 생성', () => {
  const lockDir = tmpLockDir();
  const r = lock.acquire('acme-shop', { lockDir, pid: process.pid });
  assert.strictEqual(r.ok, true);
  assert.ok(fs.existsSync(path.join(lockDir, 'acme-shop.lock')));
});

test('acquire: 살아있는 다른 프로세스가 잡은 프로필은 거부', () => {
  const lockDir = tmpLockDir();
  lock.acquire('acme-shop', { lockDir, pid: process.pid }); // holder = 현재(살아있음)
  const r = lock.acquire('acme-shop', { lockDir, pid: process.pid + 1 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'locked');
  assert.strictEqual(r.holder.pid, process.pid);
});

test('acquire: 죽은 pid의 stale 락은 자동 청소 후 획득', () => {
  const lockDir = tmpLockDir();
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(path.join(lockDir, 'acme-shop.lock'), JSON.stringify({ profile: 'acme-shop', pid: DEAD_PID }));
  const r = lock.acquire('acme-shop', { lockDir, pid: process.pid });
  assert.strictEqual(r.ok, true);
});

test('acquire: 같은 프로필 재획득(같은 pid)은 성공', () => {
  const lockDir = tmpLockDir();
  lock.acquire('acme-shop', { lockDir, pid: process.pid });
  const r = lock.acquire('acme-shop', { lockDir, pid: process.pid });
  assert.strictEqual(r.ok, true);
});

test('release: 내 락 해제 성공 + 파일 제거', () => {
  const lockDir = tmpLockDir();
  lock.acquire('acme-shop', { lockDir, pid: process.pid });
  const r = lock.release('acme-shop', { lockDir, pid: process.pid });
  assert.strictEqual(r.ok, true);
  assert.ok(!fs.existsSync(path.join(lockDir, 'acme-shop.lock')));
});

test('release: 남의 락은 해제 거부', () => {
  const lockDir = tmpLockDir();
  lock.acquire('acme-shop', { lockDir, pid: process.pid });
  const r = lock.release('acme-shop', { lockDir, pid: process.pid + 1 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'not-owner');
});

test('list: 락 현황과 alive 여부 반환', () => {
  const lockDir = tmpLockDir();
  lock.acquire('acme-shop', { lockDir, pid: process.pid });
  fs.writeFileSync(path.join(lockDir, 'dead.lock'), JSON.stringify({ profile: 'dead', pid: DEAD_PID }));
  const items = lock.list({ lockDir });
  assert.strictEqual(items.find(i => i.profile === 'acme-shop').alive, true);
  assert.strictEqual(items.find(i => i.profile === 'dead').alive, false);
});

test('cleanStale: 죽은 락만 제거하고 살아있는 락은 보존', () => {
  const lockDir = tmpLockDir();
  lock.acquire('acme-shop', { lockDir, pid: process.pid });
  fs.writeFileSync(path.join(lockDir, 'dead.lock'), JSON.stringify({ profile: 'dead', pid: DEAD_PID }));
  const removed = lock.cleanStale({ lockDir });
  assert.strictEqual(removed, 1);
  assert.ok(fs.existsSync(path.join(lockDir, 'acme-shop.lock')));
  assert.ok(!fs.existsSync(path.join(lockDir, 'dead.lock')));
});
