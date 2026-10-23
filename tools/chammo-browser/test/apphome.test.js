const { test } = require('node:test');
const assert = require('node:assert');
const { envFromPs, etimeSecs, sameAll, settingsPinned, decide } = require('../src/apphome');
const { dataDir } = require('../src/paths');

const probe = ({ inherited = true, alive = false, isApp = true } = {}) => ({ inherited: () => inherited, alive: () => alive, isApp: () => isApp });
const SOAK = '/Users/me/.chammo-soak';
const REAL = '/Users/me/.chammo';

test('envFromPs: 다음 NAME= 앞까지, 빈칸 든 경로도', () => {
  const out = '/x/claude daemon run --origin transient HOME=/Users/me CHAMMO_HOME=/Users/me/My Data/.chammo PATH=/usr/bin';
  assert.strictEqual(envFromPs(out, 'CHAMMO_HOME'), '/Users/me/My Data/.chammo');
  assert.strictEqual(envFromPs(out, 'PATH'), '/usr/bin');
  assert.strictEqual(envFromPs(out, 'NOPE'), null);
  assert.strictEqual(envFromPs('/x/claude X_CHAMMO_HOME=/a', 'CHAMMO_HOME'), null, '이름 일부만 같은 건 아니다');
});

test('sameAll: 나부터 데몬까지 모두 같은 값이어야 물려받은 것', () => {
  const daemon = '11 /x/claude daemon run HOME=/Users/me CHAMMO_HOME=/Users/me/.chammo-soak';
  const spare = '22 claude bg-spare HOME=/Users/me CHAMMO_HOME=/Users/me/.chammo-soak';
  assert.strictEqual(sameAll(`${spare}\n${daemon}\n`, '/Users/me/.chammo-soak'), true);
  // 세션 설정이 고정한 값으로 뜬 셸 → 그 밑에서 시험이 일부러 같은 값을 줬다
  const shell = '33 /bin/zsh -c x CHAMMO_HOME=/Users/me/.chammo PATH=/usr/bin';
  assert.strictEqual(sameAll(`${shell}\n${spare}\n${daemon}`, '/Users/me/.chammo-soak'), false);
  assert.strictEqual(sameAll('44 /bin/node x HOME=/Users/me PATH=/usr/bin', '/Users/me/.chammo-soak'), false, 'env 가 보이는데 값이 없는 조상');
  // 맥 /bin/sh·zsh 는 env 가 안 보인다(HOME= 도 없음) — 건너뛴다
  assert.strictEqual(sameAll(`55 /bin/sh /x/probe.sh\n${spare}\n${daemon}`, '/Users/me/.chammo-soak'), true);
  assert.strictEqual(sameAll('55 /bin/sh /x/probe.sh', '/a'), false, '하나도 안 보이면 모른다');
  assert.strictEqual(sameAll('', '/a'), false);
});

test('settingsPinned: 사용자 설정이나 cwd 위 프로젝트 설정에 env.CHAMMO_HOME 이 있으면 고정', () => {
  const files = (m) => (f) => { if (f in m) return m[f]; throw new Error('없음'); };
  const base = { cfg: '/Users/me/.claude', cwd: '/Users/me/dev/shop/src', home: '/Users/me' };
  assert.strictEqual(settingsPinned({ ...base, read: files({}) }), false);
  assert.strictEqual(settingsPinned({ ...base, read: files({ '/Users/me/.claude/settings.json': '{"env":{"CHAMMO_HOME":"/Users/me/.chammo"}}' }) }), true);
  assert.strictEqual(settingsPinned({ ...base, read: files({ '/Users/me/dev/shop/.claude/settings.local.json': '{"env":{"CHAMMO_HOME":"/x"}}' }) }), true);
  assert.strictEqual(settingsPinned({ ...base, read: files({ '/Users/me/dev/shop/.claude/settings.json': '{"env":{"A":"1"}}' }) }), false, '다른 env 만');
  assert.strictEqual(settingsPinned({ ...base, read: files({ '/Users/me/dev/shop/.claude/settings.json': '{ broken' }) }), false, '깨진 파일');
  // CLAUDE_CONFIG_DIR 를 따로 쓰면 ~/.claude/settings.json 은 사용자 설정이 아니다 — 홈 폴더 .claude 는 프로젝트 칸으로 안 본다
  assert.strictEqual(settingsPinned({ ...base, cfg: '/tmp/cfg', read: files({ '/Users/me/.claude/settings.json': '{"env":{"CHAMMO_HOME":"/r"}}' }) }), false);
});

test('etimeSecs: ps etime 모양', () => {
  assert.strictEqual(etimeSecs('  05:07'), 307);
  assert.strictEqual(etimeSecs('01:00:00'), 3600);
  assert.strictEqual(etimeSecs('2-03:04:05'), 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  assert.strictEqual(etimeSecs(''), null);
});

test('decide: 데몬에서 물려받았고 그 앱이 꺼졌고 기본 폴더에 앱이 있으면 기본 폴더 + 경고', () => {
  const r = decide({ value: SOAK, dir: SOAK, fallback: REAL, probe: probe() });
  assert.strictEqual(r.dir, REAL);
  assert.match(r.warn, /claude daemon stop --any --keep-workers/);
});

test('decide: 그 밖은 다 그대로 — 일부러 준 값·산 시험 앱·기본 폴더에 앱 없음·probe 없음·같은 폴더', () => {
  for (const p of [probe({ inherited: false }), probe({ alive: true }), probe({ isApp: false }), null]) {
    assert.deepStrictEqual(decide({ value: SOAK, dir: SOAK, fallback: REAL, probe: p }), { dir: SOAK, warn: null });
  }
  assert.deepStrictEqual(decide({ value: REAL, dir: REAL, fallback: REAL, probe: probe() }), { dir: REAL, warn: null });
});

test('dataDir: probe 를 주면 쓰고, env 를 따로 준 부름은 프로세스 표를 안 본다(시험 임시 폴더가 진짜로 새지 않게)', () => {
  const home = '/Users/me';
  const exists = () => false;
  assert.strictEqual(dataDir({ home, env: { CHAMMO_HOME: SOAK }, exists, probe: probe() }), REAL);
  assert.strictEqual(dataDir({ home, env: { CHAMMO_HOME: SOAK }, exists, probe: probe({ alive: true }) }), SOAK);
  assert.strictEqual(dataDir({ home, env: { CHAMMO_HOME: '/tmp/t' }, exists }), '/tmp/t');
});
