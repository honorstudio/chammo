const { test } = require('node:test');
const assert = require('node:assert');
const { createSecrets, parseValues, CAPTURE_FN } = require('../src/secrets');

test('결과를 넘기기 전 읽기 — 돌아온 값은 그 뒤 모든 결과에서 가린다', () => {
  const s = createSecrets();
  const c = s.captureCall();
  assert.strictEqual(c.name, 'browser_evaluate');
  assert.match(c.arguments.function, /type=password/);
  c.onResult({ content: [{ type: 'text', text: '### Result\n["PW-secret-123"]\n### Ran Playwright code\n```js\n```' }] });
  assert.strictEqual(s.redact('textbox "Password" [ref=e3]: PW-secret-123'), 'textbox "Password" [ref=e3]: ●●●●');
});

test('결과 글에서 값 목록 — 모양이 이상하면 빈 것', () => {
  assert.deepStrictEqual(parseValues('### Result\n["a1b2","zz zz"]\n'), ['a1b2', 'zz zz']);
  assert.deepStrictEqual(parseValues('### Result\n"not array"'), []);
  assert.deepStrictEqual(parseValues('### Error\nboom'), []);
  assert.deepStrictEqual(parseValues('### Result\n[1, {"x":2}, "okay"]'), ['okay']);
});

test('짧은 값(3자 이하)은 가리지 않는다 — 흔한 글자가 다 지워지지 않게, 긴 것부터 바꾼다', () => {
  const s = createSecrets();
  s.add(['abc', 'secret', 'secret-long']);
  assert.strictEqual(s.redact('abc secret-long secret'), 'abc ●●●● ●●●●');
});

test('결과 객체 — 글 칸만 바꾸고 그림은 그대로, 없으면 같은 것', () => {
  const s = createSecrets();
  const r = { content: [{ type: 'text', text: 'x' }] };
  assert.strictEqual(s.redactResult(r), r);
  s.add(['hunter22']);
  const out = s.redactResult({ content: [{ type: 'text', text: 'pw hunter22' }, { type: 'image', data: 'hunter22' }] });
  assert.strictEqual(out.content[0].text, 'pw ●●●●');
  assert.strictEqual(out.content[1].data, 'hunter22');
});

test('정규식 글자가 든 비밀번호도 그대로 가린다', () => {
  const s = createSecrets();
  s.add(['a.b*c+(d)$']);
  assert.strictEqual(s.redact('v=a.b*c+(d)$ end'), 'v=●●●● end');
});

test('닫히면 잊는다, 수는 20개까지', () => {
  const s = createSecrets();
  s.add(Array.from({ length: 30 }, (_, i) => `password-${i}`));
  assert.strictEqual(s.size(), 20);
  s.reset();
  assert.strictEqual(s.size(), 0);
  assert.strictEqual(s.redact('password-1'), 'password-1');
});

test('읽는 JS 는 값을 밖으로 보내지 않고 돌려주기만 한다(같은 출처 iframe 까지)', () => {
  assert.doesNotMatch(CAPTURE_FN, /fetch|XMLHttpRequest|sendBeacon|postMessage|localStorage/);
  assert.match(CAPTURE_FN, /contentDocument/);
});

test('네트워크 몸통처럼 주소 꼴·JSON 꼴로 나와도 가린다', () => {
  const s = createSecrets();
  s.add(['p@ss w"rd!']);
  assert.strictEqual(s.redact('password=p%40ss%20w%22rd!&x=1'), 'password=●●●●&x=1');
  assert.strictEqual(s.redact('{"password":"p@ss w\\"rd!"}'), '{"password":"●●●●"}');
});

test('플레이라이트가 남긴 스냅숏 파일(.playwright-mcp/…)도 가린다 — 결과 글이 가리키는 파일만', () => {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-sec-'));
  fs.mkdirSync(path.join(cwd, '.playwright-mcp'));
  const f = path.join(cwd, '.playwright-mcp', 'page-1.yml');
  fs.writeFileSync(f, '- textbox "Password": file-secret-9\n');
  const other = path.join(cwd, 'notes.txt');
  fs.writeFileSync(other, 'file-secret-9');
  const s = createSecrets();
  s.add(['file-secret-9']);
  s.redactFiles('- [Snapshot](.playwright-mcp/page-1.yml) [x](notes.txt) [y](.playwright-mcp/../notes.txt)', cwd);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), '- textbox "Password": ●●●●\n');
  assert.strictEqual(fs.readFileSync(other, 'utf8'), 'file-secret-9', '.playwright-mcp 밖·../ 는 안 건드린다');
});
