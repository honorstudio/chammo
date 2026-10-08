#!/usr/bin/env node
// 프로필 락 매니저 CLI
const lock = require('../src/lock');
const paths = require('../src/paths');
const { setupMcp } = require('../src/setup');
const fs = require('fs');
const path = require('path');

const cmd = process.argv[2] || 'status';

function fmt(items) {
  if (items.length === 0) return '  (사용 중인 프로필 없음)';
  return items.map((i) => {
    const state = i.alive ? '사용중' : 'stale(죽음)';
    return `  ${String(i.profile).padEnd(16)} pid=${i.pid ?? '?'}  ${state}  ${i.startedAt ?? ''}`;
  }).join('\n');
}

// 프로필 인자를 받아 검사까지. 없거나 경로를 벗어나는 이름이면 종료
function profileArg(usage) {
  const p = process.argv[3];
  if (!p) { console.error(`사용법: ${usage}`); process.exit(1); }
  const bad = paths.checkProfile(p);
  if (bad) { console.error(bad); process.exit(1); }
  return p;
}

switch (cmd) {
  case 'list':
  case 'status': {
    console.log(`프로필 락 현황 (${paths.ROOT}):`);
    console.log(fmt(lock.list({ lockDir: paths.locksDir })));
    break;
  }
  case 'unlock': {
    const p = profileArg('chammo-browser unlock <프로필>');
    const file = path.join(paths.locksDir, `${p}.lock`);
    if (fs.existsSync(file)) { fs.unlinkSync(file); console.log(`'${p}' 락 강제 해제됨`); }
    else { console.log(`'${p}' 락 없음`); }
    break;
  }
  case 'clean': {
    const n = lock.cleanStale({ lockDir: paths.locksDir });
    console.log(`죽은 락 ${n}개 청소`);
    break;
  }
  case 'profiles': {
    const dir = paths.profilesDir;
    const list = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isDirectory())
      : [];
    console.log(`등록된 프로필 (${dir}):`);
    console.log(list.length ? list.map((p) => '  ' + p).join('\n') : '  (없음)');
    break;
  }
  case 'setup': {
    const p = profileArg('chammo-browser setup <프로필> [폴더경로]');
    const target = path.resolve(process.argv[4] || process.cwd());
    let r;
    try {
      r = setupMcp({ profile: p, dir: target });
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
    if (r.unchanged) console.log(`${r.mcpPath} 에 이미 playwright(프로필: ${p}) 가 같은 설정으로 있습니다`);
    else console.log(`${r.mcpPath} ${r.created ? '생성' : '갱신'} — playwright(프로필: ${p}) 등록 완료`);
    if (r.replaced) console.log(`원래 있던 playwright 항목을 바꿨습니다:\n  ${JSON.stringify(r.replaced)}`);
    console.log(`실행: ${r.entry.command} ${r.entry.args.join(' ')}`);
    console.log(`프로필 디렉토리: ${r.entry.env ? path.join(r.entry.env.CHAMMO_BROWSER_HOME, 'profiles', p) : paths.profileDir(p)}`);
    console.log('다음 세션에서 이 폴더로 Claude 를 열면 신뢰 승인 후 자동 적용됩니다.');
    break;
  }
  case 'check': {
    // 시험 열기 — 앱이 설치 끝에 부른다. 한 줄 JSON, 실패면 종료 코드 1
    require('../src/check').check().then((r) => {
      console.log(JSON.stringify(r));
      process.exit(r.ok ? 0 : 1);
    });
    break;
  }
  case 'launch': {
    // 스크립트용 크롬 — 한 줄 JSON {ok, wsEndpoint, shared, holder, …}. 종료 코드 0 성공 · 1 오류 · 2 바빠서 못 받음(src/script.js)
    const script = require('../src/script');
    const fail = (error, code = 1) => { console.log(JSON.stringify({ ok: false, code, error })); process.exit(code); };
    let o;
    try { o = script.parseArgs(process.argv.slice(3)); } catch (e) { fail(e.message); }
    const bad = paths.checkProfile(o.profile);
    if (bad) fail(bad);
    if (o.owner == null) o.owner = process.ppid;
    if (!lock.isAlive(o.owner)) fail(`--owner ${o.owner} 프로세스가 없어요`);
    o.session = script.sessionPid({ start: o.owner });
    script.launchClient(o, script.realDeps(o)).then((r) => {
      console.log(JSON.stringify(r));
      process.exit(r.ok ? 0 : r.code || 1);
    }, (e) => fail(e.message));
    break;
  }
  case 'release': {
    // 그 스크립트가 다 썼다 — 명부에서 빼면 마지막 사용자일 때 지킴이가 1초 안에 크롬을 닫고 락을 돌려준다
    const p = profileArg('chammo-browser release <프로필> [--owner <pid>]');
    const i = process.argv.indexOf('--owner');
    const owner = i > 0 ? Number(process.argv[i + 1]) : process.ppid;
    if (!Number.isInteger(owner) || owner <= 0) { console.error('--owner 는 pid 숫자'); process.exit(1); }
    const removed = require('../src/users').remove(paths.locksDir, p, owner);
    console.log(JSON.stringify({ ok: true, profile: p, owner, removed }));
    break;
  }
  case '_hold': {
    // launch 가 따로 띄우는 지킴이 — 직접 부르지 않는다
    const script = require('../src/script');
    const o = script.parseArgs(process.argv.slice(3));
    const bad = paths.checkProfile(o.profile);
    if (bad || !o.owner) { console.log(JSON.stringify({ ok: false, error: bad || '--owner 가 필요해요' })); process.exit(1); }
    script.hold(o);
    break;
  }
  default:
    console.log(`chammo-browser — 프로젝트별 격리 브라우저 프로필 + 락 매니저
사용법:
  chammo-browser status                락 현황 (기본)
  chammo-browser unlock <프로필>        락 강제 해제
  chammo-browser clean                 죽은 락 일괄 청소
  chammo-browser profiles              등록된 프로필 목록
  chammo-browser setup <프로필> [폴더]   폴더의 .mcp.json 에 playwright 등록(다른 서버는 유지)
  chammo-browser check                 세션이 쓸 크롬을 헤드리스로 한 번 띄워 본다(한 줄 JSON)
  chammo-browser launch <프로필> [--owner <pid>] [--channel chrome|chrome-beta] [--headless] [--no-view] [--wait <초>]
                                       스크립트용 크롬 — 락·앱 화면 연결까지 하고 CDP 주소를 한 줄 JSON 으로.
                                       주인(--owner, 기본 부른 프로세스)이 끝나면 저절로 닫고 락을 돌려준다
  chammo-browser release <프로필> [--owner <pid>]   다 썼다(마지막이면 크롬을 닫는다)

저장 위치: ${paths.ROOT}
  (CHAMMO_BROWSER_HOME > $CHAMMO_HOME/browser > ~/.chammo/browser)`);
}
