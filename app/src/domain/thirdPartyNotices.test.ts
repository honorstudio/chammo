import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import notices from '../../public/licenses/THIRD_PARTY_NOTICES.md?raw';
import { parseNotices } from './craftDrawer';

// 고지 파일은 scripts/third-party-notices 가 만든다(설치 파일에 전체 고지가 든다).
// 위: 실제 생성물의 모양 / 아래: 지어낸 cargo metadata·node_modules 로 생성기 규칙

describe('생성된 고지 파일', () => {
  const secs = parseNotices(notices);
  const sec = (re: RegExp) => secs.filter((s) => re.test(s.name) || re.test(s.license));

  it('머리에 무엇을 넣고 뺐는지 기준이 적혀 있다', () => {
    const head = notices.split(/^## /m)[0]!;
    expect(head).toContain('scripts/third-party-notices');
    expect(head).toMatch(/dev-dependenc/i);
    expect(head).toMatch(/build-dependenc/i);
    expect(head).toMatch(/aarch64-apple-darwin/);
    expect(head).toMatch(/x86_64-pc-windows-msvc/);
    expect(head).toMatch(/transitive/i);
    expect(head).toMatch(/Univer Pro/); // 손으로 쓰던 Univer 절의 뜻을 잃지 않게
  });
  it('라이선스 절마다 패키지 목록 — Rust 와 웹이 다 있다', () => {
    expect(secs.length).toBeGreaterThan(5);
    const mit = sec(/^MIT$/).map((s) => s.body).join('\n');
    expect(mit).toContain('Permission is hereby granted');
    expect(mit).toMatch(/^- `zip` [\d.]+ · Rust · .*Mathijs van de Nes/m);
    expect(mit).toMatch(/^- `quick-xml` [\d.]+ · Rust · .*Johann Tuffe/m);
    expect(mit).toMatch(/^- `react` [\d.]+ · npm · /m);
  });
  it('아파치는 원문 파일을 가리키고 유니버 패키지가 그 밑에', () => {
    const apache = sec(/^Apache-2\.0$/).map((s) => s.body).join('\n');
    expect(apache).toContain('Apache-2.0.txt');
    expect(apache).toMatch(/^- `@univerjs\/presets` [\d.]+ · npm · /m);
    expect(apache).toMatch(/DreamNum/);
  });
  it('약한 카피레프트는 따로 — 수정 안 했다는 말과 소스 주소', () => {
    const mpl = sec(/^MPL-2\.0$/);
    expect(mpl.length).toBeGreaterThan(0);
    const body = mpl.map((s) => s.body).join('\n');
    expect(body).toContain('Mozilla Public License');
    expect(body).toMatch(/unmodified/i);
    expect(body).toMatch(/^- `cssparser` .*source: https?:\/\//m);
    expect(body).toMatch(/^- `@blocknote\/core` .*source: https?:\/\//m);
    // 고르는 길이 있는 건 끌려오지 않는다
    expect(body).not.toContain('`dompurify`');
  });
  it('번들 폰트(OFL)도 — node_modules 밖 자산', () => {
    const f = sec(/OFL-1\.1/)[0];
    expect(f?.body).toContain('D2Coding');
    expect(f?.body).toContain('SIL Open Font License');
  });
  it('만든 기계의 경로가 새지 않는다', () => {
    expect(notices).not.toMatch(/\/Users\/|\/home\/|C:\\\\Users/);
    expect(notices).not.toContain('.cargo/registry');
  });
  it('우리 코드(경로 의존)는 목록에 없다', () => {
    expect(notices).not.toMatch(/^- `(harnitor-core|honor-orchestrator)` /m);
  });
});

const script = resolve(__dirname, '../../../scripts/third-party-notices');
const apacheText = readFileSync(resolve(__dirname, '../../public/licenses/Apache-2.0.txt'), 'utf8');
const MIT = (who: string) => `MIT License\n\nCopyright (c) 2020 ${who}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction.\n\n## not a heading\n\nTHE SOFTWARE IS PROVIDED "AS IS".\n`;
const MPL = 'Mozilla Public License Version 2.0\n==================================\n\n1. Definitions\n';

// 공개본·배포 트리엔 scripts/ 가 없어 이 칸은 저절로 빠진다
describe.skipIf(!existsSync(script))('생성기 규칙(지어낸 입력)', () => {
  const root = mkdtempSync(join(tmpdir(), 'tpn-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const write = (p: string, s: string) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), s); };
  const crate = (name: string, license: string | null, files: Record<string, string> = {}, extra: object = {}) => {
    for (const [f, s] of Object.entries(files)) write(`reg/${name}/${f}`, s);
    write(`reg/${name}/Cargo.toml`, '');
    return { id: `reg#${name}@1.0.0`, name, version: '1.0.0', license, license_file: null, source: 'registry+x', authors: ['An Author <a@b.c>'], repository: `https://github.com/x/${name}`, manifest_path: join(root, `reg/${name}/Cargo.toml`), targets: [{ kind: ['lib'] }], ...extra };
  };
  const npm = (name: string, pkg: object, files: Record<string, string> = {}, at = `web/node_modules/${name}`) => {
    write(`${at}/package.json`, JSON.stringify({ name, version: '2.0.0', ...pkg }));
    for (const [f, s] of Object.entries(files)) write(`${at}/${f}`, s);
  };
  const edge = (pkg: string, kind: string | null = null) => ({ name: pkg, pkg, dep_kinds: [{ kind, target: null }] });
  const metadata = (packages: { id: string }[], edges: Record<string, ReturnType<typeof edge>[]>) => JSON.stringify({
    packages,
    resolve: { root: 'path#app', nodes: packages.map((p) => ({ id: p.id, deps: edges[p.id] ?? [] })) },
  });
  const app = { id: 'path#app', name: 'app', version: '0.1.0', license: 'LicenseRef-Chammo', source: null, authors: [], manifest_path: join(root, 'reg/app/Cargo.toml'), targets: [] };
  const local = { id: 'path#local', name: 'local-crate', version: '0.1.0', license: 'AGPL-3.0-only', source: null, authors: [], manifest_path: join(root, 'reg/local/Cargo.toml'), targets: [] };

  function run(name: string, packages: { id: string }[], deps: string[], opts: { dev?: string[]; build?: string[] } = {}) {
    const meta = join(root, `${name}.json`);
    const edges = { 'path#app': [edge('path#local'), ...deps.map((d) => edge(d)), ...(opts.dev ?? []).map((d) => edge(d, 'dev')), ...(opts.build ?? []).map((d) => edge(d, 'build'))] };
    writeFileSync(meta, metadata([app, local, ...packages], edges));
    const out = join(root, `${name}.md`);
    const r = spawnSync('python3', [script, '--cargo-json', meta, '--web-root', join(root, 'web'), '--out', out], { encoding: 'utf8' });
    return { ...r, out, md: existsSync(out) ? readFileSync(out, 'utf8') : '' };
  }

  write('web/package.json', JSON.stringify({ name: 'app', dependencies: { 'web-a': '2', 'web-native': '2', 'web-blocknote': '2' }, devDependencies: { 'web-dev': '2' } }));
  npm('web-a', { license: 'MIT', author: 'Web A Person', dependencies: { 'web-deep': '2', '@types/foo': '2' } }, { LICENSE: MIT('Web A Person') });
  npm('web-deep', { license: 'Apache-2.0' }, { LICENSE: apacheText, NOTICE: 'Web Deep NOTICE line\n' });
  npm('@types/foo', { license: 'MIT' }, { LICENSE: MIT('Types') });
  npm('web-native', { license: 'MIT', os: ['darwin'], cpu: ['arm64'] }, { LICENSE: MIT('Native') });
  npm('web-blocknote', { license: 'MPL-2.0', repository: { url: 'git+https://github.com/x/blocknote.git' } }, { LICENSE: MPL });
  npm('web-dev', { license: 'GPL-3.0-only' }, { LICENSE: 'GNU GENERAL PUBLIC LICENSE' });

  it('같은 원문은 한 번 — 저작권 줄은 패키지마다, 원문엔 안 섞인다', () => {
    const a = crate('alpha', 'MIT', { LICENSE: MIT('Alpha Person') });
    const b = crate('beta', 'MIT', { 'LICENSE-MIT': MIT('Beta Person') });
    const r = run('dedupe', [a, b], [a.id, b.id]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.md.match(/Permission is hereby granted/g)?.length).toBe(1);
    expect(r.md).toMatch(/^- `alpha` 1\.0\.0 · Rust · MIT · Copyright \(c\) 2020 Alpha Person$/m);
    expect(r.md).toMatch(/^- `beta` 1\.0\.0 · Rust · MIT · Copyright \(c\) 2020 Beta Person$/m);
    expect(r.md).toMatch(/^- `web-a` 2\.0\.0 · npm · MIT · Copyright \(c\) 2020 Web A Person$/m);
    const body = parseNotices(r.md).find((s) => s.license === 'MIT')!.body;
    expect(body).not.toMatch(/^\s+Copyright \(c\) 2020/m);
  });
  // ADR 0031: 윈도우 설치 파일에 새 ConPTY(conpty.dll·OpenConsole.exe, MIT)를 묶는다 — 고지에 출처·판·MIT 전문
  it('윈도우 ConPTY 묶음 — 목록 파일이 있으면 출처·판·MIT 전문 절', () => {
    write('web/src-tauri/windows/conpty.json', JSON.stringify({ package: 'Microsoft.Windows.Console.ConPTY', version: '9.9.9', license: 'MIT', source: 'https://github.com/microsoft/terminal' }));
    write('web/src-tauri/windows/conpty-LICENSE.txt', MIT('Microsoft Corporation'));
    try {
      const a = crate('alpha', 'MIT', { LICENSE: MIT('Alpha Person') });
      const r = run('conpty', [a], [a.id]);
      expect(r.status, r.stderr).toBe(0);
      const sec = parseNotices(r.md).find((s) => s.name.startsWith('Windows ConPTY'))!;
      expect(sec.license).toBe('MIT');
      expect(sec.body).toContain('Microsoft.Windows.Console.ConPTY 9.9.9');
      expect(sec.body).toContain('https://github.com/microsoft/terminal');
      expect(sec.body).toMatch(/Copyright \(c\) 2020 Microsoft Corporation/);
      expect(sec.body).toContain('Permission is hereby granted');
    } finally {
      rmSync(join(root, 'web/src-tauri'), { recursive: true, force: true });
    }
  });
  it('원문 속 ## 줄이 절을 쪼개지 않는다', () => {
    const a = crate('alpha', 'MIT', { LICENSE: MIT('Alpha Person') });
    const r = run('heading', [a], [a.id]);
    expect(parseNotices(r.md).some((s) => s.name.startsWith('not a heading'))).toBe(false);
    expect(parseNotices(r.md).find((s) => s.license === 'MIT')!.body).toContain('## not a heading');
  });
  it('개발·빌드 의존, 우리 경로 크레이트, @types, 플랫폼 네이티브 패키지는 뺀다', () => {
    const a = crate('alpha', 'MIT', { LICENSE: MIT('Alpha') });
    const d = crate('dev-only', 'GPL-3.0-only', { LICENSE: 'GNU GENERAL PUBLIC LICENSE' });
    const b = crate('build-only', 'MIT', { LICENSE: MIT('Build') });
    const r = run('kinds', [a, d, b], [a.id], { dev: [d.id], build: [b.id] });
    expect(r.status, r.stderr).toBe(0);
    for (const gone of ['dev-only', 'build-only', 'local-crate', '@types/foo', 'web-native', 'web-dev']) expect(r.md).not.toContain(`\`${gone}\``);
  });
  it('고를 수 있으면 허용 쪽 — 원문이 있는 쪽을 먼저', () => {
    const a = crate('either', 'MIT OR Apache-2.0', { 'LICENSE-MIT': MIT('Either'), 'LICENSE-APACHE': apacheText });
    const b = crate('copyleft-opt', 'MIT OR Apache-2.0 OR LGPL-2.1-or-later', { 'LICENSE-MIT': MIT('Opt') });
    const c = crate('only-apache-file', 'MIT/Apache-2.0', { 'LICENSE-APACHE': `${apacheText}\nCopyright 2021 Only Apache\n` });
    const r = run('choice', [a, b, c], [a.id, b.id, c.id]);
    expect(r.status, r.stderr).toBe(0);
    const secs = parseNotices(r.md);
    expect(secs.find((s) => s.license === 'MIT')!.body).toMatch(/`either`[^\n]*MIT OR Apache-2\.0/);
    expect(secs.find((s) => s.license === 'MIT')!.body).toContain('`copyleft-opt`');
    expect(secs.find((s) => s.license === 'Apache-2.0')!.body).toContain('`only-apache-file`');
    expect(r.md).not.toMatch(/LGPL[^\n]*— /);
  });
  it('둘 다 요구(AND)면 양쪽 절에', () => {
    const a = crate('both', 'Apache-2.0 AND MIT', { LICENSE: MIT('Both'), 'LICENSE-APACHE': apacheText });
    const r = run('and', [a], [a.id]);
    const secs = parseNotices(r.md);
    expect(secs.find((s) => s.license === 'MIT')!.body).toContain('`both`');
    expect(secs.find((s) => s.license === 'Apache-2.0')!.body).toContain('`both`');
  });
  it('아파치 표준 원문은 다시 안 싣고 파일을 가리키며 NOTICE 는 싣는다', () => {
    const r = run('apache', [], []);
    expect(r.md).not.toContain('TERMS AND CONDITIONS FOR USE');
    const s = parseNotices(r.md).find((x) => x.license === 'Apache-2.0')!;
    expect(s.body).toContain('[`Apache-2.0.txt`](Apache-2.0.txt)');
    expect(s.body).toContain('`web-deep`');
    expect(s.body).toContain('Web Deep NOTICE line');
  });
  it('아파치 원문 뒤에 다른 라이선스가 붙은 파일은 표준으로 치지 않는다 — 뒤 글을 잃지 않게(ring)', () => {
    const a = crate('ringlike', 'Apache-2.0', { LICENSE: `${apacheText}\n\n${'Licenses for embedded code follow. '.repeat(60)}\nExtra embedded license clause.\n` });
    const r = run('apache-extra', [a], [a.id]);
    const v = parseNotices(r.md).filter((x) => x.license === 'Apache-2.0').find((x) => x.body.includes('`ringlike`'))!;
    expect(v.body).toContain('Extra embedded license clause.');
    expect(v.body).not.toContain('Full text:');
  });
  it('유니코드·부스트 문안은 "Permission is hereby granted" 가 있어도 MIT 로 안 친다', () => {
    const text = 'UNICODE LICENSE V3\n\nCOPYRIGHT AND PERMISSION NOTICE\n\nCopyright © 2020 Unicode, Inc.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of data files and any associated documentation.\n';
    const u = crate('icu-like', 'Unicode-3.0', { LICENSE: text });
    const b = crate('boost-like', 'BSL-1.0', { 'LICENSE-BOOST': 'Boost Software License - Version 1.0\n\nPermission is hereby granted, free of charge, to any person or organization obtaining a copy.\n' });
    const r = run('unicode', [u, b], [u.id, b.id]);
    const uni = parseNotices(r.md).find((x) => x.license === 'Unicode-3.0')!;
    expect(uni.body).toContain('`icu-like`');
    expect(uni.body).toContain('Permission is hereby granted');
    expect(uni.body).not.toContain('spdx.org');
    expect(parseNotices(r.md).find((x) => x.license === 'BSL-1.0')!.body).toContain('`boost-like`');
    expect(r.stderr).not.toContain('icu-like');
  });
  it('고른 파일에 저작권 줄이 없으면 패키지의 다른 라이선스 파일에서 찾는다, 저자는 겹치지 않게', () => {
    const a = crate('split', 'MIT OR Apache-2.0', { 'LICENSE-MIT': MIT('X').replace(/Copyright.*\n/, ''), 'LICENSE-APACHE': `${apacheText}\nCopyright 2019 Split Person\n` });
    const b = crate('twice', 'MIT', {}, { authors: ['Same One <a@b.c>', 'Same One'] });
    const r = run('fallback', [a, b], [a.id, b.id]);
    expect(r.md).toMatch(/^- `split` 1\.0\.0 · Rust · MIT OR Apache-2\.0 · Copyright 2019 Split Person$/m);
    expect(r.md).toMatch(/^- `twice` 1\.0\.0 · Rust · MIT · Same One \(no license/m);
  });
  it('원문이 없으면 표준 문안을 가리키고 저자를 쓴다', () => {
    const a = crate('nofile', 'MIT', {});
    const b = crate('hasfile', 'MIT', { LICENSE: MIT('Has File') });
    const r = run('nofile', [a, b], [a.id, b.id]);
    expect(r.md).toMatch(/^- `nofile` 1\.0\.0 · Rust · MIT · An Author \(no license file in the package; standard text\)$/m);
  });
  it('약한 카피레프트 — 따로, 수정 안 함과 소스 주소', () => {
    const m = crate('mpl-crate', 'MPL-2.0', { LICENSE: MPL });
    const r = run('mpl', [m], [m.id]);
    const s = parseNotices(r.md).find((x) => x.license === 'MPL-2.0')!;
    expect(s.body).toMatch(/unmodified/i);
    expect(s.body).toMatch(/^- `mpl-crate` .*source: https:\/\/github\.com\/x\/mpl-crate$/m);
    expect(s.body).toMatch(/^- `web-blocknote` .*source: https:\/\/github\.com\/x\/blocknote$/m);
    expect(s.body).toContain('Mozilla Public License Version 2.0');
  });
  it('강한 카피레프트가 들면 파일을 안 쓰고 목록을 돌려준다(종료 코드 2)', () => {
    const g = crate('gpl-crate', 'GPL-3.0-only', { LICENSE: 'GNU GENERAL PUBLIC LICENSE' });
    const r = run('gpl', [g], [g.id]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('gpl-crate 1.0.0');
    expect(existsSync(r.out)).toBe(false);
  });
  it('라이선스를 알 수 없으면 빼지 않고 Other 절 + 경고', () => {
    const u = crate('mystery', null, { LICENSE: 'All yours, kind of.\n' });
    const r = run('other', [u], [u.id]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.md).toContain('`mystery`');
    expect(r.stderr).toContain('mystery');
  });
  it('--check 는 파일이 낡았으면 1 로 끝난다', () => {
    const a = crate('alpha', 'MIT', { LICENSE: MIT('Alpha') });
    const first = run('check', [a], [a.id]);
    const args = [script, '--cargo-json', join(root, 'check.json'), '--web-root', join(root, 'web'), '--out', first.out, '--check'];
    expect(spawnSync('python3', args, { encoding: 'utf8' }).status).toBe(0);
    writeFileSync(first.out, `${first.md}\nstale\n`);
    expect(spawnSync('python3', args, { encoding: 'utf8' }).status).toBe(1);
  });
});
