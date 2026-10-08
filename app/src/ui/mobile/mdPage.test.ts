// 폰 md 문서 보기 — 데스크톱 스페이스 문서 페이지(노션식) 톤을 폰 폭에 맞게(2026-10-05 사용자 "폰 md 보기 아쉽다").
// 채팅 말풍선(.m-md)은 그대로 두고 문서 보기(.m-page)만 — 제목 위계·읽기 글자·긴 경로·표 가로 스크롤·색 띠 없음
import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';
import fileView from './FileView.tsx?raw';
import fileText from './FileText.tsx?raw';

/** `.m-page` 쪽 규칙에서 sel 이 들어간 덩어리 몸통을 모두 모은다 */
const page = (sel: string) => {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sels = m[1]!.split(',').map((s) => s.trim());
    if (sels.some((s) => s.startsWith('.m-page') && s.replace(/\s+/g, ' ').endsWith(sel))) out.push(m[2]!);
  }
  if (!out.length) throw new Error(`.m-page … ${sel} 규칙 없음`);
  return out.join(';');
};
const px = (body: string, prop: string) => {
  const m = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([\\d.]+)px`).exec(body);
  if (!m) throw new Error(`${prop} px 없음: ${body}`);
  return Number(m[1]);
};

describe('폰 md 문서 보기', () => {
  it('문서 보기만 .m-page — 채팅 말풍선 md 는 안 바뀐다', () => {
    expect(fileText).toMatch(/className="m-doc m-md m-page"/);
  });
  it('읽기 글자는 17px 안팎·줄 간격 1.6 이상', () => {
    const b = page('.m-page.m-md');
    expect(px(b, 'font-size')).toBeGreaterThanOrEqual(16);
    expect(Number(/line-height\s*:\s*([\d.]+)/.exec(b)![1])).toBeGreaterThanOrEqual(1.6);
  });
  it('제목 위계 — H1 > H2 > H3 > 본문, 큰 갈래 위엔 넉넉한 여백', () => {
    const body = px(page('.m-page.m-md'), 'font-size');
    const [h1, h2, h3] = ['h1', 'h2', 'h3'].map((h) => px(page(` ${h}`), 'font-size'));
    expect(h1).toBeGreaterThan(h2!);
    expect(h2).toBeGreaterThan(h3!);
    expect(h3).toBeGreaterThan(body);
    expect(page(' h2')).toMatch(/margin\s*:\s*(2[4-9]|[3-9]\d)px/);
  });
  it('긴 경로(인라인 코드)는 어디서든 줄바꿈하고 줄마다 판이 이어진다', () => {
    const c = page(' code');
    expect(c).toMatch(/overflow-wrap\s*:\s*anywhere/);
    expect(c).toMatch(/box-decoration-break\s*:\s*clone/);
  });
  it('표는 가로 스크롤', () => {
    expect(page(' table')).toMatch(/overflow-x\s*:\s*auto/);
  });
  it('왼쪽 색 띠 없음 — 인용은 옅은 면', () => {
    const q = page(' blockquote');
    expect(q).toMatch(/background/);
    const all = css.split('\n').filter((l) => l.includes('.m-page')).join('\n');
    expect(all).not.toMatch(/border-left|inset\s+\d+px\s+0/);
  });
  it('닫기는 직접 그린 아이콘 + 이름(aria-label)', () => {
    expect(fileView).toMatch(/aria-label="닫기"[^>]*>\s*<IconClose \/>/);
    expect(fileView).not.toMatch(/>닫기<\/button>/);
  });
});
