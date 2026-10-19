import { describe, expect, it } from 'vitest';
import file from './FileTab.tsx?raw';
import view from './SpaceView.tsx?raw';
import { titleOf } from '../../domain/reader';

// 2026-10-16 craft-draft2: 채팅 뷰에서 scripts/show http://…(scripts/craft open 도)가 보관함 새 탭으로 열리는데
// FileTab 에 주소 갈래가 없어 '미리보기가 안 되는 파일이에요', 탭 이름은 끝 / 때문에 빈칸이었다
describe('스페이스 탭 — http(s) 주소', () => {
  it('FileTab 은 주소면 주소 미리보기(WebPage)를 그린다', () => {
    expect(file).toMatch(/kind === 'web' \? <WebPage url=\{path\} \/>/);
    expect(file).toMatch(/import \{ WebPage \} from '\.\.\/WebPage'/);
  });
  it('주소 탭엔 파일 머리(경로·크게 보기)를 안 단다 — WebPage 가 주소 막대를 갖고, 크게 보기는 웹뷰를 하나 더 열려 한다', () => {
    expect(file).toMatch(/\{kind !== 'web' && <div className="cv-doc-bar">/);
  });
  it('탭 이름은 titleOf — 끝이 / 인 주소도 이름이 나온다', () => {
    expect(titleOf('http://127.0.0.1:51381/photocraft/0.9.0/')).toBe('127.0.0.1:51381/photocraft/0.9.0');
    expect(view).not.toMatch(/<span>\{p\.split\('\/'\)\.pop\(\)\}<\/span>\{pj &&/);
    expect(view).toMatch(/<span>\{titleOf\(p\)\}<\/span>\{pj &&/);
  });
});
