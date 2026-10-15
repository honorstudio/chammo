import { describe, expect, it } from 'vitest';
import { readmeEn, readmeKo } from './readmes';

// 원본은 public/README*.md, 공개본은 export 가 public/ 을 맨 위로 올려 README*.md — 0.3.0 공개본 vitest 가 이 경로에서 깨졌다(2026-10-15)
describe('README 읽기 — 원본·공개본 둘 다', () => {
  it('한글·영문 README 를 하나씩 찾는다', () => {
    expect(readmeKo).toMatch(/Chammo/);
    expect(readmeKo).toMatch(/[가-힣]/);
    expect(readmeEn).toMatch(/Chammo/);
    expect(readmeEn).not.toBe(readmeKo);
  });
});
