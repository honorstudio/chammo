// 프로필마다 크롬 채널(정품·베타)을 기억한다 — 정품 154 로 만든 프로필을 베타 156 으로 열면 프로필 판이 올라가
// 정품으로 다시 못 열고(크롬은 더 새 판이 쓴 프로필을 거절한다) 로그인도 풀렸다(2026-10-05 아이맥 project-x).
// 기억은 프로필 폴더 안 ChammoChannel 한 줄 — 프로필을 옮기거나 링크로 나눠 써도 같이 간다. 크롬은 모르는 파일을 건드리지 않는다.
//
// 고르는 순서: ① 직접 고른 것(--channel · CHAMMO_BROWSER_CHANNEL) ② 기억 ③ 기억이 없는 옛 프로필은 크롬이 남긴 Last Version 의
// 큰 번호가 같은 채널 ④ 기본(베타가 있으면 베타 — window.chromeLaunch 와 같은 규칙). ②③④는 프로필보다 낮은 판이면 열 수 있는 채널로 비킨다
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MARKER = 'ChammoChannel';
const CHANNELS = ['chrome', 'chrome-beta'];

/** 'chrome' | 'chrome-beta' | null — beta·stable 같은 말도 받는다 */
function normalize(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'chrome' || s === 'stable') return 'chrome';
  if (s === 'chrome-beta' || s === 'beta') return 'chrome-beta';
  return null;
}

/** 'a.b.c.d' 비교 → -1·0·1, 모양이 아니면 null */
function cmpVersion(a, b) {
  const pa = String(a || '').trim().split('.').map(Number);
  const pb = String(b || '').trim().split('.').map(Number);
  if (!a || !b || pa.some(Number.isNaN) || pb.some(Number.isNaN)) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}
const major = (v) => String(v || '').split('.')[0];

function readMarker(profileDir) {
  try { return normalize(fs.readFileSync(path.join(profileDir, MARKER), 'utf8')); } catch { return null; }
}

function remember(profileDir, channel) {
  if (!normalize(channel)) return;
  try {
    fs.mkdirSync(profileDir, { recursive: true });
    if (readMarker(profileDir) !== channel) fs.writeFileSync(path.join(profileDir, MARKER), `${channel}\n`);
  } catch { /* 기억은 보조 — 못 써도 브라우저는 뜬다 */ }
}

function lastVersion(profileDir) {
  try { return fs.readFileSync(path.join(profileDir, 'Last Version'), 'utf8').trim() || null; } catch { return null; }
}

/**
 * 깔린 채널의 판 { chrome?: '154.…', 'chrome-beta'?: '156.…' } — 맥은 /Applications·~/Applications 의 Info.plist.
 * 맥이 아니면 {} (판을 몰라 기억·기본만으로 고른다)
 */
function installedVersions({ platform = process.platform, home = require('os').homedir() } = {}) {
  if (platform !== 'darwin') return {};
  const out = {};
  for (const [ch, name] of [['chrome', 'Google Chrome'], ['chrome-beta', 'Google Chrome Beta']]) {
    for (const dir of ['/Applications', `${home}/Applications`]) {
      const plist = `${dir}/${name}.app/Contents/Info.plist`;
      if (!fs.existsSync(plist)) continue;
      const r = spawnSync('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', plist], { encoding: 'utf8', timeout: 3000 });
      const v = (r.stdout || '').trim();
      if (r.status === 0 && v) { out[ch] = v; break; }
    }
  }
  return out;
}

/**
 * @param {object} o
 * @param {string} o.profileDir
 * @param {string} [o.want] 직접 고른 채널(--channel)
 * @param {object} [o.env] CHAMMO_BROWSER_CHANNEL
 * @param {object} [o.versions] 깔린 채널의 판(installedVersions). 비면 판 검사 없이 고른다(맥 아님)
 * @returns {{channel: string|null, why: 'asked'|'remembered'|'last-version'|'default', warn?: string}}
 */
function pickChannel({ profileDir, want = null, env = process.env, versions = installedVersions() }) {
  const have = CHANNELS.filter((c) => versions[c]);
  const known = have.length > 0;
  const last = lastVersion(profileDir);
  const tooOld = (c) => known && last && versions[c] && cmpVersion(versions[c], last) === -1;
  const lowWarn = (c) => `${c} ${versions[c]} 은 이 프로필(${last})보다 낮은 판이라 못 열 수 있어요`;

  const asked = normalize(want) || normalize(env.CHAMMO_BROWSER_CHANNEL);
  if (asked) return { channel: asked, why: 'asked', ...(tooOld(asked) ? { warn: lowWarn(asked) } : {}) };

  // 프로필보다 낮은 판이면 열 수 있는 채널로 비킨다(누가 다른 채널로 열어 판을 올려 버렸을 때)
  const safe = (c, why) => {
    if (!tooOld(c)) return { channel: c, why };
    const up = have.find((x) => !tooOld(x));
    return up ? { channel: up, why, warn: `${lowWarn(c)} — ${up} ${versions[up]} 로 엽니다` } : { channel: c, why, warn: lowWarn(c) };
  };

  const marked = readMarker(profileDir);
  if (marked && (!known || versions[marked])) return safe(marked, 'remembered');

  if (known && last) {
    const same = have.find((c) => major(versions[c]) === major(last));
    if (same) return safe(same, 'last-version');
  }
  // 판을 모르면(맥 아님) null — window.chromeLaunch 가 깔린 것을 보고 고른다
  if (!known) return { channel: null, why: 'default' };
  return safe(versions['chrome-beta'] ? 'chrome-beta' : have[0], 'default');
}

module.exports = { MARKER, normalize, cmpVersion, readMarker, remember, lastVersion, installedVersions, pickChannel };
