import { describe, expect, it } from 'vitest';
import { SHARE_MAX, fileType, sharePlan } from './phoneShare';
import shareSrc from '../ui/mobile/ShareButton.tsx?raw';

describe('폰 파일 받기 — 공유 시트로 할까 내려받기로 할까(2026-10-11 사용자)', () => {
  it('작고 공유 시트가 파일을 받으면 공유', () => {
    expect(sharePlan(3_000_000, true)).toBe('share');
  });
  it('50MB 넘으면 내려받기 — 공유는 통째로 메모리에 올린다', () => {
    expect(SHARE_MAX).toBe(50 * 1024 * 1024);
    expect(sharePlan(SHARE_MAX + 1, true)).toBe('download');
    expect(sharePlan(SHARE_MAX, true)).toBe('share');
  });
  it('공유 시트가 없거나 파일을 못 받는 브라우저는 내려받기', () => {
    expect(sharePlan(1000, false)).toBe('download');
  });
  it('File 형식은 MIME 앞부분만(charset 떼기), 비면 octet-stream', () => {
    expect(fileType('text/csv; charset=utf-8')).toBe('text/csv');
    expect(fileType('application/pdf')).toBe('application/pdf');
    expect(fileType('')).toBe('application/octet-stream');
  });
  it('단추는 받기 표로 받아 navigator.share 에 파일을 넘기고, 못 하면 내려받기 링크로', () => {
    expect(shareSrc).toMatch(/dlTicket\(/);
    expect(shareSrc).toMatch(/navigator\.share\(/);
    expect(shareSrc).toMatch(/canShare/);
    expect(shareSrc).toMatch(/\.download = /);
  });
});
