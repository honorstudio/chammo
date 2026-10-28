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

test('명부 표시 — 세션 브라우저 도구가 같이 쓰면 by=session 으로 올라 앱이 스크립트 수에서 뺀다(src/share.js)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-users-by-'));
  lock.acquire('p', { lockDir: d, pid: process.pid });
  assert.equal(users.join(d, 'p', 4242, process.pid, { by: 'session' }), true);
  users.add(d, 'p', 4343);
  const read = (pid) => JSON.parse(fs.readFileSync(path.join(users.usersDir(d, 'p'), String(pid)), 'utf8'));
  assert.equal(read(4242).by, 'session');
  assert.equal(read(4242).pid, 4242);
  assert.equal(read(4343).by, undefined);
});

// 0.4.4 리뷰 5 — 지킴이가 패스키로 크롬을 바꾸기 전 '손님 없음'을 명부 자물쇠 밖에서 봤다. 보고 닫기 사이에 스크립트가 붙으면 받은 주소가 바로 죽었다.
// 바꾸기 표시는 같은 자물쇠 안에서 손님 확인과 같이 남기고, 그동안 같이 쓰기는 기다린다(script.js launchClient 가 0.5초마다 다시)
test('바꾸기 표시 — 자물쇠 안에서 손님을 보고 남긴다, 그동안 같이 쓰기 실패, 치우면 다시 된다', () => {
  const d = tmp();
  lock.acquire('p', { lockDir: d, pid: process.pid });
  users.add(d, 'p', process.pid);
  const onlyMe = (alive) => alive.length === 1 && alive[0] === process.pid;
  assert.equal(users.claimSwitch(d, 'p', onlyMe), true);
  assert.equal(users.join(d, 'p', process.ppid, process.pid), false, '바꾸는 동안 붙은 스크립트는 죽을 주소를 받지 않는다');
  users.clearClose(d, 'p');
  assert.equal(users.join(d, 'p', process.ppid, process.pid), true);
  assert.equal(users.claimSwitch(d, 'p', onlyMe), false, '손님이 붙었으면 표시를 안 남긴다');
  assert.equal(users.closing(d, 'p'), false);
});

test('바꾸기 표시는 닫기 표시(30초)보다 오래 산다 — 프로필 풀림을 30초까지 기다린다', () => {
  const d = tmp();
  users.claimSwitch(d, 'p', () => true);
  const f = path.join(d, 'p.closing');
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  fs.writeFileSync(f, JSON.stringify({ ...c, at: Date.now() - 45_000 }));
  assert.equal(users.closing(d, 'p'), true);
  fs.writeFileSync(f, JSON.stringify({ ...c, at: Date.now() - 200_000 }));
  assert.equal(users.closing(d, 'p'), false, '오래된 건 무시(바꾸다 죽은 것)');
});
