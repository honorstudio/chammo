// 윈도우 빌드 전 — 새 ConPTY(conpty.dll + OpenConsole.exe)를 NuGet 공식 패키지에서 고정 판으로 받아 windows/conpty/ 에 둔다(ADR 0031).
// 패키지·두 파일 sha256 이 conpty.json 과 다르면 멈춘다(종료 코드 1). 바이너리는 깃에 안 넣는다(.gitignore). 맥·윈도우 둘 다 node + tar 로
// 사용: node src-tauri/windows/fetch-conpty.mjs [--check 파일 경로…]  (tauri.windows.conf.json beforeBuildCommand 가 부른다)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const manifest = JSON.parse(fs.readFileSync(path.join(here, 'conpty.json'), 'utf8'));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** 받은 바이트가 적힌 sha256 과 같은가 — 다르면 이유 글(무엇이·기대·실제) */
export function mismatch(name, buf, want) {
  const got = sha(buf);
  return got === want ? null : `${name} sha256 다름 — 기대 ${want}, 실제 ${got}`;
}

async function download(url) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`받기 실패 ${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

async function main() {
  const out = path.join(here, 'conpty');
  const ok = () => Object.entries(manifest.files).every(([n, f]) => fs.existsSync(path.join(out, n)) && !mismatch(n, fs.readFileSync(path.join(out, n)), f.sha256));
  if (ok()) return console.log(`conpty ${manifest.version} 이미 있음`);
  const cache = path.join(os.homedir(), '.cache', 'chammo-conpty');
  fs.mkdirSync(cache, { recursive: true });
  const pkg = path.join(cache, `${manifest.package}.${manifest.version}.nupkg`);
  let buf = fs.existsSync(pkg) ? fs.readFileSync(pkg) : null;
  if (!buf || mismatch('nupkg', buf, manifest.sha256)) {
    buf = await download(manifest.url);
    const bad = mismatch('nupkg', buf, manifest.sha256);
    if (bad) throw new Error(bad);
    fs.writeFileSync(pkg, buf);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-conpty-'));
  try {
    execFileSync('tar', ['-xf', pkg, '-C', tmp, ...Object.values(manifest.files).map((f) => f.from)], { stdio: 'inherit' });
    fs.mkdirSync(out, { recursive: true });
    for (const [n, f] of Object.entries(manifest.files)) {
      const b = fs.readFileSync(path.join(tmp, f.from));
      const bad = mismatch(n, b, f.sha256);
      if (bad) throw new Error(bad);
      fs.writeFileSync(path.join(out, n), b);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`conpty ${manifest.version} 받음 → ${out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`[fetch-conpty] ${e.message}`); process.exit(1); });
}
