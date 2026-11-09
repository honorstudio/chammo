// 단추 안에 입력칸을 두지 않는다 — 11-05 사용자: 팀 보관함 파일 이름 바꾸는 칸에서 스페이스를 치면 띄어쓰기 대신 파일이 스페이스에 열렸다.
// 웹킷·블링크는 스페이스·Enter 의 keypress/keyup 기본 처리를 조상 <button> 에서도 돌려(단추 누르기 = click),
// 입력칸의 stopPropagation 으로도 못 막는다. 폴더 타일처럼 이름 바꾸는 동안엔 단추 대신 div 로 그린다.
// 앱 시험엔 DOM 이 없어 소스(AST)로 본다 — <button>·role="button" 안의 <input>/<textarea>, 그리고 입력칸을 그리는 함수(nameBox 등) 호출
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const app = resolve(__dirname, '../..');
const roots = [join(app, 'src'), join(app, '../pro/web')].filter(existsSync);
const tsx = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = join(dir, d.name);
  if (d.isDirectory()) return d.name === 'node_modules' ? [] : tsx(p);
  return d.name.endsWith('.tsx') && !d.name.includes('.test.') ? [p] : [];
});

const tagOf = (n: ts.Node) => (ts.isJsxElement(n) ? n.openingElement.tagName.getText() : ts.isJsxSelfClosingElement(n) ? n.tagName.getText() : null);
const attrsOf = (n: ts.Node) => (ts.isJsxElement(n) ? n.openingElement.attributes : ts.isJsxSelfClosingElement(n) ? n.attributes : null);
const isButton = (n: ts.Node) => tagOf(n) === 'button'
  || !!attrsOf(n)?.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText() === 'role' && /['"]button['"]/.test(p.getText()));

/** 파일 하나에서 단추 안 입력칸 자리('파일:줄') */
function inputsInButtons(file: string, src = readFileSync(file, 'utf8')): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // 입력칸을 그리는 같은 파일 안 함수·컴포넌트 이름 — const nameBox = (i) => <input …/>
  const drawsInput = new Set<string>();
  const collect = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && n.initializer && /<(input|textarea)\b/.test(n.initializer.getText())) drawsInput.add(n.name.getText());
    if (ts.isFunctionDeclaration(n) && n.name && /<(input|textarea)\b/.test(n.getText())) drawsInput.add(n.name.text);
    ts.forEachChild(n, collect);
  };
  collect(sf);
  const hits: string[] = [];
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const walk = (n: ts.Node, inButton: boolean) => {
    if (inButton) {
      const t = tagOf(n);
      if (t === 'input' || t === 'textarea' || (t && drawsInput.has(t))) hits.push(`${relative(app, file)}:${line(n)}`);
      if (ts.isCallExpression(n) && drawsInput.has(n.expression.getText())) hits.push(`${relative(app, file)}:${line(n)}`);
    }
    ts.forEachChild(n, (c) => walk(c, inButton || isButton(n)));
  };
  walk(sf, false);
  return hits;
}

describe('단추 안 입력칸', () => {
  it('스캐너가 바로 든 입력칸과 함수로 그린 입력칸을 다 잡는다', () => {
    expect(inputsInButtons('a.tsx', 'const A = () => <button><input /></button>;')).toHaveLength(1);
    expect(inputsInButtons('a.tsx', 'const A = () => <div role="button"><textarea /></div>;')).toHaveLength(1);
    expect(inputsInButtons('a.tsx', 'const box = () => <input />; const A = () => <button>{box()}</button>;')).toHaveLength(1);
    expect(inputsInButtons('a.tsx', 'const A = () => <div><input /><button>x</button></div>;')).toEqual([]);
  });

  it('앱 어디에도 <button>·role="button" 안에 입력칸이 없다 — 스페이스·Enter 가 단추를 누른다(팀 보관함 이름 바꾸기 11-05)', () => {
    expect(roots.flatMap(tsx).flatMap((f) => inputsInButtons(f))).toEqual([]);
  });
});
