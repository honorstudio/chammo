import { describe, expect, it } from 'vitest';

// 2026-11-13 perf-night: 첫 화면(App)이 정적으로 끌고 오는 코드에 문서 편집기(BlockNote·ProseMirror·yjs, 줄인 판 715KB)가 들어 있었다 —
// ChatView·SpaceView 가 PageBlock.tsx 의 사건 이름 두 개(OPEN_PAGE·PAGE_TITLE)를 가져오느라. 편집기는 문서를 열 때 lazy 로 온다(DocPage·Reader)
const SRC = import.meta.glob(['./**/*.ts', './**/*.tsx', '!./**/*.test.ts', '!./**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const PRO = import.meta.glob(['../../pro/web/**/*.ts', '../../pro/web/**/*.tsx', '!../../pro/web/**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const ALL: Record<string, string> = { ...SRC, ...PRO };

const norm = (p: string) => {
  const out: string[] = [];
  for (const s of p.split('/')) {
    if (s === '..') out.pop();
    else if (s !== '.' && s !== '') out.push(s);
  }
  return out.join('/');
};
// 키를 './' 기준 경로로(pro 는 '../../pro/web/…')
const keyOf = new Map<string, string>();
for (const k of Object.keys(ALL)) keyOf.set(norm(k.startsWith('./') ? k.slice(2) : '__up__/' + k), k);
const resolve = (from: string, spec: string): string | undefined => {
  let base: string;
  if (spec.startsWith('@pro/')) base = norm('__up__/../../pro/web/' + spec.slice(5));
  else if (spec.startsWith('.')) base = norm(from.split('/').slice(0, -1).join('/') + '/' + spec);
  else return undefined;
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) if (keyOf.has(base + ext)) return base + ext;
  return undefined;
};
const norm0 = (k: string) => norm(k.startsWith('./') ? k.slice(2) : '__up__/' + k);

/** 값을 가져오는 정적 import·export from 만(import type·동적 import() 빼고) */
const staticImports = (code: string) => {
  const out: string[] = [];
  const re = /^\s*(import|export)\s+(?!type\b)([^'";]*?)\s*from\s*['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;
  for (const m of code.matchAll(re)) {
    const what = m[2] ?? '';
    if (/^\{\s*(type\s+[\w$]+\s*,?\s*)+\}$/.test(what.trim())) continue; // import { type A, type B } — 값 없음
    out.push(m[3] ?? m[4]!);
  }
  return out;
};

function reach(entry: string) {
  const seen = new Set<string>();
  const pkgs = new Map<string, string>();
  const walk = (f: string) => {
    if (seen.has(f)) return;
    seen.add(f);
    const code = ALL[keyOf.get(f)!] ?? '';
    for (const spec of staticImports(code)) {
      const r = resolve(f, spec);
      if (r) walk(r);
      else if (!spec.startsWith('.')) pkgs.set(spec, pkgs.get(spec) ?? f);
    }
  };
  walk(norm0(entry));
  return { seen, pkgs };
}

describe('첫 화면 묶음 — 문서 편집기는 열 때 온다', () => {
  it('App 이 정적으로 닿는 코드에 BlockNote 값 import 가 없다', () => {
    const { seen, pkgs } = reach('./App.tsx');
    expect(seen.size).toBeGreaterThan(50); // 그래프를 제대로 걸었나
    const bn = [...pkgs].filter(([p]) => p.startsWith('@blocknote/')).map(([p, f]) => `${p} ← ${f}`);
    expect(bn).toEqual([]);
  });
});
