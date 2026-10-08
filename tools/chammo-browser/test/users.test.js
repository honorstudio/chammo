const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const users = require('../src/users');
const lock = require('../src/lock');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-users-'));
const DEAD = 2 ** 22 + 12345; // 없는 pid

test('같이 쓰기 — 잠금 주인이 살아 있고 닫는 중이 아니면 이름을 올린다', () => {
  const d = tmp();
  assert.equal(lock.acquire('p', { lockDir: d, pid: process.pid }).ok, true);
  assert.equal(users.join(d, 'p', 4242, process.pid), true);
  assert.deepEqual(users.alive(d, 'p', (pid) => pid === 4242), [4242]);
});

test('잠금 주인이 바뀌었거나 죽었으면 같이 쓰기 실패', () => {
  const d = tmp();
  assert.equal(users.join(d, 'p', 4242, process.pid), false); // 잠금 없음
  lock.acquire('p', { lockDir: d, pid: process.pid });
  assert.equal(users.join(d, 'p', 4242, process.ppid), false); // 다른 주인
});

test('닫기로 정했으면(closing) 같이 쓰기 실패 — 닫히는 크롬 주소를 받지 않게', () => {
  const d = tmp();
  lock.acquire('p', { lockDir: d, pid: process.pid });
  assert.equal(users.claimClose(d, 'p', process.pid), true);
  assert.equal(users.join(d, 'p', 4242, process.pid), false);
  users.clearClose(d, 'p');
  assert.equal(users.join(d, 'p', 4242, process.pid), true);
});

test('살아 있는 사용자가 있으면 닫기를 못 정한다, 다 끝나면 정한다', () => {
  const d = tmp();
  lock.acquire('p', { lockDir: d, pid: process.pid });
  users.add(d, 'p', process.pid);
  assert.equal(users.claimClose(d, 'p', process.pid), false);
  users.remove(d, 'p', process.pid);
  assert.equal(users.claimClose(d, 'p', process.pid), true);
});

test('죽은 사용자는 세지 않고 치운다', () => {
  const d = tmp();
  users.add(d, 'p', DEAD);
  assert.deepEqual(users.alive(d, 'p'), []);
  assert.equal(fs.existsSync(path.join(d, 'p.users', String(DEAD))), false);
});

test('닫는 중 표시는 그 주인이 죽었거나 오래됐으면(30초) 무시', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'p.closing'), JSON.stringify({ pid: DEAD, at: Date.now() }));
  assert.equal(users.closing(d, 'p'), false);
  fs.writeFileSync(path.join(d, 'p.closing'), JSON.stringify({ pid: process.pid, at: Date.now() - 31_000 }));
  assert.equal(users.closing(d, 'p'), false);
  fs.writeFileSync(path.join(d, 'p.closing'), JSON.stringify({ pid: process.pid, at: Date.now() }));
  assert.equal(users.closing(d, 'p'), true);
});

test('작은 자물쇠 — 죽은 주인 것은 풀고 들어간다', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'p.users-m.lock'), JSON.stringify({ profile: 'p.users-m', pid: DEAD }));
  assert.equal(users.withMutex(d, 'p', () => 7), 7);
  assert.equal(fs.existsSync(path.join(d, 'p.users-m.lock')), false);
});

test('pid 모양이 아닌 파일은 사용자로 안 센다', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'p.users'));
  fs.writeFileSync(path.join(d, 'p.users', '.DS_Store'), '');
  assert.deepEqual(users.alive(d, 'p', () => true), []);
});
