// 참모 브라우저 메모리 상한(2026-11-16 사고 — 맥이 메모리로 멈춰 강제 재부팅). 멈춤 대신 낮추기:
//   그 프로필 크롬 묶음(본체 + 자식) 메모리를 5초마다 재서, 상한(프로필당·전체)을 넘으면
//   ① 제일 큰 렌더러를 끊고 그 탭을 닫는다(trim) → ② 3분 안에 또 넘으면 그 프로필 크롬 본체(그 pid 묶음만)를 끈다(kill).
//   무엇을 했는지 <브라우저 루트>/run/memcap.jsonl 에 남기고(앱이 읽어 세션·참모에게 한 줄), 세션 도구 결과에도 꼬리 한 줄.
// 감시는 그 프로필 락을 쥔 쪽(MCP 래퍼 또는 스크립트 지킴이)이 하나만 돈다. 상한은 <데이터>/tools/chammo-browser/memcap.json(설정 화면).
// 재는 값은 ps rss 합 — 공유 메모리를 조금 겹쳐 세서 실제보다 약간 크게 본다(일찍 낮추는 쪽이라 그대로 둔다). 윈도우는 아직 안 잰다
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const GB = 1024 ** 3;
const DEFAULT = { profileGb: 6, totalGb: 12 };
const EVERY_MS = 5_000; // 큰 그림 디코딩은 5초에 2GB 까지 큰다(11-16 실측) — 크롬이 떠 있을 때만 ps 한 번
const STRIKE_MS = 180_000; // 자르고 이 안에 또 넘으면 끈다
const MAX_LINES = 200;

/** `ps -axo pid=,ppid=,rss=,args=` 글 → [{ pid, ppid, bytes, args }] */
function parsePs(text) {
  const rows = [];
  for (const line of String(text).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), bytes: Number(m[3]) * 1024, args: m[4] });
  }
  return rows;
}

/** 우리 프로필 폴더(profilesDir/<이름>)로 뜬 크롬 본체마다 묶음 — Map(이름 → { root, pids, bytes, biggest: 제일 큰 렌더러(확장 빼고) }) */
function chromeGroups(rows, profilesDir) {
  const kids = new Map();
  for (const r of rows) kids.set(r.ppid, [...(kids.get(r.ppid) || []), r]);
  const flag = `--user-data-dir=${profilesDir}/`;
  const out = new Map();
  for (const r of rows) {
    const at = r.args.indexOf(flag);
    if (at < 0 || / --type=/.test(r.args)) continue;
    const name = r.args.slice(at + flag.length).split(/[\s/]/)[0];
    if (!name || out.has(name)) continue;
    const g = { root: r.pid, pids: [], bytes: 0, biggest: null };
    const stack = [r];
    while (stack.length) {
      const p = stack.pop();
      g.pids.push(p.pid);
      g.bytes += p.bytes;
      if (/ --type=renderer/.test(p.args) && !/--extension-process/.test(p.args) && (!g.biggest || p.bytes > g.biggest.bytes)) g.biggest = { pid: p.pid, bytes: p.bytes };
      stack.push(...(kids.get(p.pid) || []));
    }
    out.set(name, g);
  }
  return out;
}

const total = (groups) => [...groups.values()].reduce((s, g) => s + g.bytes, 0);

/**
 * 할 일 — none · trim(제일 큰 렌더러 끊기) · kill(그 프로필 크롬 끄기).
 * 전체 상한은 제일 큰 프로필 감시만 움직인다(여러 감시가 같이 자르지 않게)
 */
function decide({ groups, me, caps, now, lastTrimAt = null }) {
  const own = groups.get(me);
  if (!own) return { act: 'none' };
  const all = total(groups);
  const top = [...groups.values()].every((g) => g.bytes <= own.bytes);
  const why = own.bytes > caps.profileBytes ? 'profile' : all > caps.totalBytes && top ? 'total' : null;
  if (!why) return { act: 'none' };
  const again = lastTrimAt != null && now - lastTrimAt < STRIKE_MS;
  if (again || !own.biggest) return { act: 'kill', why, bytes: own.bytes, total: all, pid: own.root };
  return { act: 'trim', why, bytes: own.bytes, total: all, pid: own.biggest.pid };
}

const capsFile = (dataDir) => path.join(dataDir, 'tools', 'chammo-browser', 'memcap.json');

/** 상한(GB) — 0.5~256, 이상하면 기본. 전체는 프로필보다 작지 않게 */
function readCaps(dataDir) {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(capsFile(dataDir), 'utf8')) || {}; } catch { /* 기본 */ }
  const ok = (v) => typeof v === 'number' && v >= 0.5 && v <= 256;
  const profileGb = ok(c.profileGb) ? c.profileGb : DEFAULT.profileGb;
  const totalGb = ok(c.totalGb) ? c.totalGb : DEFAULT.totalGb;
  return { profileGb, totalGb: Math.max(totalGb, profileGb) };
}

/** 기록 한 줄 덧붙이기(최근 200줄) — 던지지 않는다 */
function appendEvent(file, ev) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let lines = [];
    try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { /* 처음 */ }
    lines.push(JSON.stringify(ev));
    fs.writeFileSync(file, `${lines.slice(-MAX_LINES).join('\n')}\n`);
  } catch { /* 기록은 보조 */ }
}

const gb = (b) => `${(b / GB).toFixed(1)}GB`;

/** 세션 도구 결과·앱 알림에 붙일 한 줄 */
function noteText(ev) {
  const cap = `${ev.why === 'total' ? '참모 브라우저 전체' : '프로필'} 상한 ${ev.capGb}GB`;
  const tabs = ev.tabs && ev.tabs.length ? ` — 탭 ${ev.tabs.slice(0, 3).join(', ')}` : '';
  const did = ev.action === 'kill' ? '크롬을 껐어(다음 도구 부름에 다시 뜬다)' : '제일 큰 탭을 닫았어';
  return `[참모 브라우저] '${ev.profile}' 메모리가 ${gb(ev.bytes)}로 ${cap}을 넘어 ${did}${tabs}. 큰 원본 이미지·무한 스크롤 페이지는 작게 나눠 열어 줘`;
}

function psText() {
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-axo', 'pid=,ppid=,rss=,args='], { timeout: 15_000, maxBuffer: 32 * 1024 * 1024 }, (e, out) => resolve(e ? '' : out));
  });
}

/**
 * 감시 하나 — tick() 을 EVERY_MS 마다. d: running(그 프로필 크롬이 떠 있나 — 싸게), ps, caps, trim(렌더러 pid → 닫은 탭 주소),
 * tabs(지금 탭 주소), kill(본체 pid), now, log. 크롬이 없으면 ps 도 안 돈다
 */
function createWatch(d) {
  let lastTrimAt = null;
  let busy = false;
  const notes = [];
  async function tick() {
    if (busy || process.platform === 'win32' || !d.running()) return;
    busy = true;
    try {
      const capGb = d.caps();
      const caps = { profileBytes: capGb.profileGb * GB, totalBytes: capGb.totalGb * GB };
      const groups = chromeGroups(parsePs(await d.ps()), d.profilesDir);
      const now = d.now();
      const r = decide({ groups, me: d.profile, caps, now, lastTrimAt });
      if (r.act === 'none') return;
      const write = (tabs) => {
        const ev = { at: new Date(now).toISOString(), profile: d.profile, action: r.act, why: r.why, bytes: r.bytes, totalBytes: r.total, capGb: r.why === 'total' ? capGb.totalGb : capGb.profileGb, tabs, sessionPid: d.sessionPid || 0, via: d.via || '' };
        appendEvent(d.eventsFile, ev);
        const line = noteText(ev);
        notes.push(line);
        d.log(line);
      };
      if (r.act === 'trim') {
        lastTrimAt = now;
        write(await d.trim(r.pid).catch(() => []));
      } else {
        // 기록 먼저 — 크롬이 꺼지면 지킴이가 바로 끝나 그 뒤 줄은 못 남긴다(11-16 실측)
        write(await d.tabs().catch(() => []));
        lastTrimAt = null;
        await d.kill(r.pid);
      }
    } catch (e) {
      d.log(`[memcap] 재기 실패: ${e.message}`);
    } finally {
      busy = false;
    }
  }
  return {
    tick,
    takeNote: () => notes.splice(0).join('\n'),
    start: () => { const t = setInterval(() => { tick(); }, d.everyMs || EVERY_MS); t.unref(); return () => clearInterval(t); },
  };
}

module.exports = { parsePs, chromeGroups, decide, total, readCaps, capsFile, appendEvent, noteText, createWatch, psText, GB, DEFAULT, STRIKE_MS };
