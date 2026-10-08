// 같은 프로필 크롬을 쓰는 스크립트 명부 — <locks>/<프로필>.users/<pid>.
// 크롬 주인(스크립트 지킴이 또는 MCP 래퍼)은 명부에 산 pid 가 있는 동안 크롬을 닫지 않는다. 스크립트가 끝나거나 죽으면 pid 가 죽어 빠진다.
// 닫기로 정하는 것(claimClose)과 같이 쓰기로 올리는 것(join)은 작은 자물쇠 안에서 — 닫히는 크롬 주소를 새 스크립트에 주지 않게.
// 닫기로 정하면 <프로필>.closing 을 남긴다(주인 pid·시각). 주인이 죽었거나 30초 넘은 표시는 무시한다(닫기가 실패해 남은 것)
const fs = require('fs');
const path = require('path');
const lock = require('./lock');

const CLOSING_MS = 30_000;
const usersDir = (lockDir, profile) => path.join(lockDir, `${profile}.users`);
const closingFile = (lockDir, profile) => path.join(lockDir, `${profile}.closing`);

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 작은 자물쇠 — lock.acquire 를 '<프로필>.users-m' 이름으로(죽은 주인 것은 lock 이 치운다). 잠깐만 잡으니 2초 기다린다 */
function withMutex(lockDir, profile, fn, { pid = process.pid, waitMs = 2000 } = {}) {
  const name = `${profile}.users-m`;
  const until = Date.now() + waitMs;
  while (!lock.acquire(name, { lockDir, pid }).ok) {
    if (Date.now() > until) throw new Error(`'${profile}' 명부 자물쇠를 못 잡았어요`);
    sleepSync(20);
  }
  try {
    return fn();
  } finally {
    lock.release(name, { lockDir, pid });
  }
}

function add(lockDir, profile, pid) {
  const d = usersDir(lockDir, profile);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, String(pid)), JSON.stringify({ pid, at: new Date().toISOString() }));
}

function remove(lockDir, profile, pid) {
  try { fs.unlinkSync(path.join(usersDir(lockDir, profile), String(pid))); return true; } catch { return false; }
}

/** 산 사용자 pid — 죽은 것은 파일을 치운다 */
function alive(lockDir, profile, isAlive = lock.isAlive) {
  let names = [];
  try { names = fs.readdirSync(usersDir(lockDir, profile)); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!/^\d{1,10}$/.test(n)) continue;
    const pid = Number(n);
    if (isAlive(pid)) out.push(pid);
    else remove(lockDir, profile, pid);
  }
  return out;
}

/** 닫는 중인가 — 표시를 남긴 주인이 살아 있고 30초 안 */
function closing(lockDir, profile, isAlive = lock.isAlive) {
  try {
    const c = JSON.parse(fs.readFileSync(closingFile(lockDir, profile), 'utf8'));
    return Number.isInteger(c.pid) && isAlive(c.pid) && Date.now() - c.at < CLOSING_MS;
  } catch {
    return false;
  }
}

/** 크롬을 같이 쓰겠다 — 잠금 주인이 holder 그대로 살아 있고 닫는 중이 아닐 때만 owner 를 올린다 */
function join(lockDir, profile, owner, holder) {
  return withMutex(lockDir, profile, () => {
    const l = lock.list({ lockDir }).find((x) => x.profile === profile);
    if (!l || l.pid !== holder || !l.alive || closing(lockDir, profile)) return false;
    add(lockDir, profile, owner);
    return true;
  });
}

/** 크롬 주인이 닫아도 되나 — 산 사용자가 없으면 닫는 중 표시를 남기고 true */
function claimClose(lockDir, profile, pid = process.pid) {
  return withMutex(lockDir, profile, () => {
    if (alive(lockDir, profile).length > 0) return false;
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(closingFile(lockDir, profile), JSON.stringify({ pid, at: Date.now() }));
    return true;
  });
}

function clearClose(lockDir, profile) {
  try { fs.unlinkSync(closingFile(lockDir, profile)); } catch { /* 없음 */ }
}

/** 크롬이 닫혔다 — 명부·닫는 중 표시를 치운다 */
function clear(lockDir, profile) {
  try { fs.rmSync(usersDir(lockDir, profile), { recursive: true, force: true }); } catch { /* 없음 */ }
  clearClose(lockDir, profile);
}

module.exports = { withMutex, add, remove, alive, closing, join, claimClose, clearClose, clear, usersDir };
