// 렌더 중에 바로 도는 콜백(.map·useMemo 등) 안에서 아래에 선언된 const 를 읽으면 TDZ 로 창이 죽는다.
// tsc 는 콜백 안이라 'used before declaration' 을 안 낸다 — 그래서 여기서 소스를 파싱해 잡는다.
// 2026-11-05: App.tsx inboxPages 가 .map 안에서 replyItem·dismissItem(30줄 아래 선언)을 읽어, 결정 대기함에 물음이 하나라도 있으면
// 메인 창이 'Cannot access ko before initialization' 으로 멈췄다(다시 켜도 물음이 남아 계속).
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** 부르는 자리에서 바로(동기로) 도는 콜백 — 이 안의 참조는 선언 전이면 TDZ */
const EAGER_METHODS = new Set(['map', 'flatMap', 'filter', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex', 'forEach', 'reduce', 'reduceRight', 'sort', 'toSorted', 'from']);
/** 렌더 중에 바로 도는 훅 콜백 — useState·useReducer 초기값, useMemo */
const EAGER_HOOKS = new Set(['useMemo', 'useState', 'useReducer']);

function skipParens(e: ts.Expression): ts.Node {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return e;
}

function calleeName(call: ts.CallExpression): string | null {
  const c = call.expression;
  if (ts.isIdentifier(c)) return c.text;
  if (ts.isPropertyAccessExpression(c)) return c.name.text;
  return null;
}

/** fn 이 부르는 자리에서 바로 도는 콜백인가 */
function isEagerCallback(fn: ts.Node): boolean {
  let up = fn.parent;
  while (up && ts.isParenthesizedExpression(up)) up = up.parent;
  if (up && ts.isCallExpression(up) && skipParens(up.expression) === fn) return true; // 바로 부르는 함수 (() => …)()
  const call = fn.parent;
  if (!call || !ts.isCallExpression(call) || !call.arguments.includes(fn as ts.Expression)) return false;
  const name = calleeName(call);
  if (!name) return false;
  if (ts.isPropertyAccessExpression(call.expression)) return EAGER_METHODS.has(name) || EAGER_HOOKS.has(name);
  return EAGER_HOOKS.has(name);
}

/** 이 식별자가 변수를 읽는 자리인가(속성 이름·JSX 속성 이름·선언 이름은 아님) */
function isValueRead(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isPropertySignature(p)) && p.name === id) return false;
  if (ts.isJsxAttribute(p) && p.name === id) return false;
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isBindingElement(p)) && p.name === id) return false;
  if (ts.isQualifiedName(p) || ts.isTypeReferenceNode(p) || ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) return false;
  return true;
}

/** fn 안에서 name 을 새로 묶나(매개변수·지역 선언) — 그러면 바깥 const 가 아니다 */
function rebinds(fn: ts.SignatureDeclaration, name: string): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if ((ts.isParameter(n) || ts.isVariableDeclaration(n) || ts.isBindingElement(n)) && ts.isIdentifier(n.name) && n.name.text === name) found = true;
    if (n !== fn && ts.isFunctionLike(n)) return; // 더 안쪽 함수는 따로 본다
    ts.forEachChild(n, visit);
  };
  fn.parameters.forEach(visit);
  if ('body' in fn && fn.body) visit(fn.body);
  return found;
}

export type TdzHit = { name: string; line: number; declLine: number };

/** 블록 맨 위 const 를, 그 블록에서 선언보다 앞서 바로 도는 콜백 안에서 읽는 곳 */
export function findEagerTdz(code: string, file = 'x.tsx'): TdzHit[] {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: TdzHit[] = [];
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const checkBlock = (block: ts.Block) => {
    const decls = new Map<string, number>();
    for (const st of block.statements) {
      if (!ts.isVariableStatement(st) || !(st.declarationList.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let))) continue;
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) decls.set(d.name.text, st.getStart(sf));
    }
    if (!decls.size) return;
    const visit = (n: ts.Node) => {
      if (ts.isIdentifier(n) && decls.has(n.text) && isValueRead(n)) {
        const declPos = decls.get(n.text)!;
        if (n.getStart(sf) < declPos && reachedEagerly(n, block, n.text)) hits.push({ name: n.text, line: lineOf(n.getStart(sf)), declLine: lineOf(declPos) });
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(block, visit);
  };
  // 식별자에서 블록까지 올라가며 함수를 지날 때마다 그 함수가 바로 도는 콜백인지 본다. 하나라도 미뤄지는 함수(효과·이벤트 처리기)면 안전
  const reachedEagerly = (id: ts.Node, block: ts.Block, name: string): boolean => {
    let crossed = false;
    for (let n: ts.Node = id.parent; n && n !== block; n = n.parent) {
      if (ts.isFunctionLike(n)) {
        if (rebinds(n, name) || !isEagerCallback(n)) return false;
        crossed = true;
      }
    }
    return crossed; // 콜백을 안 지난 직접 참조는 tsc(TS2448)가 잡는다
  };
  const walk = (n: ts.Node) => {
    if (ts.isBlock(n) && n.parent && ts.isFunctionLike(n.parent)) checkBlock(n);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return hits;
}

describe('findEagerTdz — 렌더 중 바로 도는 콜백의 선언 전 참조', () => {
  it('.map 콜백 JSX 속성에서 아래 const 를 읽으면 잡는다(11-05 메인 창 멈춤 모양)', () => {
    const code = `function App(){ const pages = items.map((i) => <Card onReply={reply} />); const reply = () => 1; return pages; }`;
    expect(findEagerTdz(code)).toEqual([{ name: 'reply', line: 1, declLine: 1 }]);
  });
  it('useMemo·useState 초기값 콜백도 잡는다', () => {
    expect(findEagerTdz(`function A(){ const v = useMemo(() => f(), []); const f = () => 1; return v; }`).map((h) => h.name)).toEqual(['f']);
    expect(findEagerTdz(`function A(){ const [v] = useState(() => f()); const f = () => 1; return v; }`).map((h) => h.name)).toEqual(['f']);
  });
  it('바로 부르는 함수·Array.from 콜백도 잡는다', () => {
    expect(findEagerTdz(`function A(){ const v = (() => f())(); const f = () => 1; return v; }`).map((h) => h.name)).toEqual(['f']);
    expect(findEagerTdz(`function A(){ const v = Array.from(xs, () => f()); const f = () => 1; return v; }`).map((h) => h.name)).toEqual(['f']);
  });
  it('효과·useCallback·이벤트 처리기 안은 나중에 돌아 안전', () => {
    expect(findEagerTdz(`function A(){ useEffect(() => { f(); }, []); const g = useCallback(() => f(), []); const h = () => f(); const f = () => 1; return <b onClick={() => f()} />; }`)).toEqual([]);
  });
  it('.map 안이어도 그 안의 이벤트 처리기 화살표는 안전', () => {
    expect(findEagerTdz(`function A(){ const xs = items.map((i) => <b onClick={() => f(i)} />); const f = (i) => i; return xs; }`)).toEqual([]);
  });
  it('콜백이 같은 이름을 다시 묶으면 바깥 const 가 아니다', () => {
    expect(findEagerTdz(`function A(){ const xs = items.map((f) => f + 1); const f = 1; return xs; }`)).toEqual([]);
  });
  it('선언 뒤에서 읽는 건 괜찮다', () => {
    expect(findEagerTdz(`function A(){ const f = () => 1; const xs = items.map(() => f()); return xs; }`)).toEqual([]);
  });
  it('속성 이름·JSX 속성 이름은 참조가 아니다', () => {
    expect(findEagerTdz(`function A(){ const xs = items.map((i) => ({ reply: i, x: o.reply, el: <C reply={1} /> })); const reply = 1; return xs; }`)).toEqual([]);
  });
});

describe('src 전체 — 렌더 중 바로 도는 콜백에서 선언 전 const 를 읽는 곳이 없다', () => {
  const root = path.resolve(__dirname);
  const files: string[] = [];
  const collect = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) collect(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) files.push(p);
    }
  };
  collect(root);
  it('파일을 찾았다', () => expect(files.length).toBeGreaterThan(100));
  it('걸린 곳 0', () => {
    const hits = files.flatMap((f) => findEagerTdz(fs.readFileSync(f, 'utf8'), f).map((h) => `${path.relative(root, f)}:${h.line} ${h.name} (선언 ${h.declLine}행)`));
    expect(hits).toEqual([]);
  });
});
