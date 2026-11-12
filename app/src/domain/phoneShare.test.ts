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

// 11-12 사용자 "모바일에서 공유 버튼은 있는데 다운로드 버튼이 없다" — 받기(사파리 다운로드 → 파일 앱)를 공유와 따로, 팀 파일도
import { TEAM_DL_MAX, dlErrorText, dlPct, waitTeamDl, type TeamDlStep } from './phoneShare';

describe('폰 받기 — 진행·오류 글(11-12)', () => {
  it('진행은 받은 양/전체 %, 99 에서 멈추고(다 받은 건 ready 로 안다) 전체를 모르면 null', () => {
    expect(dlPct(42, 100)).toBe(42);
    expect(dlPct(100, 100)).toBe(99);
    expect(dlPct(5, 0)).toBeNull();
  });
  it('팀 받기 상한 = 200MB(맥이 풀어서 통째로 넘기는 크기)', () => {
    expect(TEAM_DL_MAX).toBe(200 * 1024 * 1024);
  });
  it('맥 답 글 → 사람 말 — 큰 파일·없는 파일·못 내보내는 파일·그 밖은 그대로', () => {
    expect(dlErrorText('too large')).toMatch(/너무 커요/);
    expect(dlErrorText('file too large')).toMatch(/너무 커요/);
    expect(dlErrorText('not found')).toMatch(/없어요/);
    expect(dlErrorText('not allowed')).toMatch(/내보낼 수 없/);
    expect(dlErrorText('secret inside')).toMatch(/내보낼 수 없/);
    expect(dlErrorText('net')).toMatch(/연결/);
    expect(dlErrorText('이상한 일')).toBe('이상한 일');
    expect(dlErrorText('')).toMatch(/못 받았어요/);
  });
});

describe('팀 파일 받기 — 맥이 받아 푸는 동안 기다렸다 받기 표로(11-12)', () => {
  const steps = (list: TeamDlStep[]) => { let i = 0; return () => Promise.resolve(list[Math.min(i++, list.length - 1)]!); };
  const nap = () => Promise.resolve();
  it('받는 중이면 % 를 알리며 다시 묻고, 다 되면 표를 준다', async () => {
    const pct: (number | null)[] = [];
    const t = await waitTeamDl(steps([
      { state: 'going', done: 0, total: 0 },
      { state: 'going', done: 25, total: 100 },
      { state: 'going', done: 50, total: 100 },
      { state: 'ready', url: '/api/dl?t=ab', size: 100, name: '묶음.zip', mime: 'application/zip' },
    ]), (p) => pct.push(p), nap);
    expect(t).toEqual({ url: '/api/dl?t=ab', size: 100, name: '묶음.zip', mime: 'application/zip' });
    expect(pct).toEqual([null, 25, 50]);
  });
  it('맥이 실패를 알리면 까닭 글로 던진다', async () => {
    await expect(waitTeamDl(steps([{ state: 'failed', why: 'net' }]), () => {}, nap)).rejects.toThrow(/연결/);
  });
  it('끊으면(signal) 더 묻지 않는다', async () => {
    const c = new AbortController();
    let asked = 0;
    const p = waitTeamDl(() => { asked++; if (asked === 2) c.abort(); return Promise.resolve({ state: 'going', done: 1, total: 10 } as TeamDlStep); }, () => {}, nap, c.signal);
    await expect(p).rejects.toThrow();
    expect(asked).toBe(2);
  });
});
