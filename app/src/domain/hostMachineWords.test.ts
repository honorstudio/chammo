// 11-01 사용자 — 폰 로그인·부하 화면이 윈도우 PC 에 붙어도 한글로 '맥'이라 떴다(영어는 machine() 을 썼는데 한글만 '맥' 고정).
// 기기 종류는 실제 붙은 기기(setHostWin — 폰은 /api/env os)를 보고 부른다
import { afterEach, describe, expect, it } from 'vitest';
import { setHostWin } from '../i18n';
import { flowText } from './phoneLogin';
import { loadChip, readPhoneLoad } from './phoneLoad';
import { linkNotice } from './busyGate';

afterEach(() => setHostWin(false));

describe('붙은 기기가 윈도우 PC 면 한글에도 PC', () => {
  it('폰 로그인 줄', () => {
    setHostWin(true);
    for (const s of ['starting', 'done', 'failed'] as const) {
      const t = flowText({ state: s, url: null, error: null });
      expect(t).not.toContain('맥');
      expect(t).toContain('PC');
    }
    setHostWin(false);
    expect(flowText({ state: 'starting', url: null, error: null })).toContain('맥에서');
  });
  it('폰 부하 — 아직 안 잼·칩 이름', () => {
    setHostWin(true);
    expect(readPhoneLoad('{"now":1}')?.why).toBe('PC 앱이 아직 부하를 안 쟀어요');
    const chip = loadChip({ level: 'ok', label: '여유', load1: 2, cores: 8, swapGb: 0, ageSec: 1, stale: false, sessions: [], slots: [], why: '' });
    expect(chip?.aria.startsWith('PC 부하')).toBe(true);
  });
  it('바쁨 안내는 조사까지(PC가 · 맥이)', () => {
    setHostWin(true);
    expect(linkNotice({ link: 'reattaching', listUnknown: true, busy: 'busy' })).toContain('PC가 바빠서');
    setHostWin(false);
    expect(linkNotice({ link: 'reattaching', listUnknown: true, busy: 'busy' })).toContain('맥이 바빠서');
  });
  it('쫓겨난 연결 안내엔 플랫폼 이름이 없다', () => {
    const t = linkNotice({ link: 'gone', kicked: true, busy: 'ok' }) ?? '';
    expect(t).not.toMatch(/윈도우|Windows/);
  });
});
