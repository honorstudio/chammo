// 그릴 때마다 새로 생기는 값이 훅 의존성에 들어가면 그 훅은 매번 다시 돈다 — DOM 없이 소스로 지키는 규칙.
// 10-31 실측: TeamConvo 기본값 agentsApi = { … } 가 useEffect 의존성이라 팀챗을 열면 team_agents 를 초당 10번씩 끝없이 다시 불렀다(30초 298번)
import { describe, expect, it } from 'vitest';

const files = import.meta.glob(['./**/*.tsx', '!./**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** 주석·글자를 빈칸으로(괄호 세기가 글자 안 괄호에 안 속게) */
function strip(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, (m) => `'${' '.repeat(Math.max(0, m.length - 2))}'`);
}

function close(s: string, open: number): number {
  const o = s[open], c = o === '(' ? ')' : o === '[' ? ']' : '}';
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === o) d++;
    else if (s[i] === c && --d === 0) return i;
  }
  return s.length;
}

/** 함수 컴포넌트 매개변수 구조 분해 기본값 중 그릴 때마다 새로 생기는 것(객체·배열·화살표 함수) — 이름들 */
function freshDefaults(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/function\s+[A-Z]\w*\s*\(\s*\{/g)) {
    const at = m.index! + m[0].length - 1;
    const head = src.slice(at + 1, close(src, at));
    let depth = 0;
    for (let i = 0; i < head.length; i++) {
      const ch = head[i]!;
      if ('{[('.includes(ch)) depth++;
      else if ('}])'.includes(ch)) depth--;
      else if (depth === 0 && ch === '=' && head[i + 1] !== '>' && head[i - 1] !== '=' && head[i - 1] !== '!') {
        const name = /(\w+)\s*$/.exec(head.slice(0, i))?.[1];
        const val = head.slice(i + 1).trimStart();
        if (name && (val.startsWith('{') || val.startsWith('[') || /^(async\s*)?(\([^)]*\)|\w+)\s*=>/.test(val))) out.add(name);
      }
    }
  }
  return out;
}

/** 훅 의존성 배열(마지막 [ ]) 안 이름들 */
function deps(src: string): { hook: string; names: string[]; line: number }[] {
  const out: { hook: string; names: string[]; line: number }[] = [];
  for (const m of src.matchAll(/\b(useEffect|useLayoutEffect|useMemo|useCallback)\s*\(/g)) {
    const open = m.index! + m[0].length - 1;
    const end = close(src, open);
    const body = src.slice(open + 1, end).trimEnd();
    if (!body.endsWith(']')) continue;
    let d = 0, i = body.length - 1;
    for (; i >= 0; i--) {
      if (body[i] === ']') d++;
      else if (body[i] === '[' && --d === 0) break;
    }
    const names = body.slice(i + 1, -1).split(',').map((x) => x.trim()).filter(Boolean);
    out.push({ hook: m[1]!, names, line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

describe('훅 의존성에 그릴 때마다 새 값 금지', () => {
  it('찾는 법이 맞다 — 기본값 객체가 의존성에 들어간 모양을 잡는다', () => {
    const src = strip(`export function A({ api = { get: f }, n = 3, cb = () => 1 }: P) { useEffect(() => { api.get(); }, [api, n]); const x = useMemo(() => cb(), [cb]); }`);
    expect([...freshDefaults(src)].sort()).toEqual(['api', 'cb']);
    expect(deps(src).map((d) => d.names)).toEqual([['api', 'n'], ['cb']]);
  });

  it('컴포넌트 기본값(객체·배열·함수)은 훅 의존성에 쓰지 않는다 — 모듈 상수로 뺀다', () => {
    const bad: string[] = [];
    for (const [path, raw] of Object.entries(files)) {
      const src = strip(raw);
      const fresh = freshDefaults(src);
      if (!fresh.size) continue;
      for (const d of deps(src)) for (const n of d.names) if (fresh.has(n.split('.')[0]!)) bad.push(`${path}:${d.line} ${d.hook} [${n}]`);
    }
    expect(bad).toEqual([]);
  });
});
