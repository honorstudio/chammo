// 프로필 락 매니저
// Playwright가 Chromium의 SingletonLock 을 무시하므로, 같은 user-data-dir 의
// 동시 사용을 막는 유일한 방어선. 원자적 파일 생성(O_EXCL)으로 race 를 차단한다.
const fs = require('fs');
const path = require('path');

// pid 가 살아있는지 확인. ESRCH=없음, EPERM=있지만 권한없음(=살아있음)
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function lockPath(profile, lockDir) {
  return path.join(lockDir, `${profile}.lock`);
}

function readLock(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null; // 없거나 깨진 락
  }
}

// 락 획득. 성공 {ok:true} / 점유중 {ok:false, reason:'locked', holder}
function acquire(profile, { pid = process.pid, lockDir, meta = {} } = {}) {
  if (!lockDir) throw new Error('lockDir required');
  fs.mkdirSync(lockDir, { recursive: true });
  const file = lockPath(profile, lockDir);
  const payload = JSON.stringify({ profile, pid, startedAt: new Date().toISOString(), ...meta });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx'); // 없을 때만 원자적 생성, 있으면 EEXIST
      fs.writeSync(fd, payload);
      fs.closeSync(fd);
      return { ok: true };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const holder = readLock(file);
      // 살아있는 다른 프로세스가 점유 → 거부
      if (holder && holder.pid !== pid && isAlive(holder.pid)) {
        return { ok: false, reason: 'locked', holder };
      }
      // stale(죽은 pid) / 깨진 락 / 내 pid → 청소 후 재시도
      try { fs.unlinkSync(file); } catch { /* 경합 시 무시 */ }
    }
  }
  return { ok: false, reason: 'race' };
}

// 락 해제. 내 소유일 때만 제거
function release(profile, { pid = process.pid, lockDir } = {}) {
  const file = lockPath(profile, lockDir);
  const holder = readLock(file);
  if (!holder) return { ok: true, note: 'no-lock' };
  if (holder.pid !== pid) return { ok: false, reason: 'not-owner', holder };
  fs.unlinkSync(file);
  return { ok: true };
}

// 전체 락 현황 (alive 포함)
function list({ lockDir } = {}) {
  if (!lockDir || !fs.existsSync(lockDir)) return [];
  return fs.readdirSync(lockDir)
    .filter((f) => f.endsWith('.lock'))
    .map((f) => {
      const holder = readLock(path.join(lockDir, f)) || {};
      const profile = holder.profile || f.replace(/\.lock$/, '');
      return { ...holder, profile, alive: holder.pid ? isAlive(holder.pid) : false };
    });
}

// 죽은 락만 청소. 제거 개수 반환
function cleanStale({ lockDir } = {}) {
  let removed = 0;
  for (const l of list({ lockDir })) {
    if (!l.alive) {
      try { fs.unlinkSync(lockPath(l.profile, lockDir)); removed++; } catch { /* noop */ }
    }
  }
  return removed;
}

module.exports = { acquire, release, list, cleanStale, isAlive };
