import { afterEach, describe, expect, it } from 'vitest';
import { machine, setHostWin, setLang } from '../i18n';
import { envFromCache, envIsWin } from './boot';
import { wakeFailText, waitingList } from './mobile';
import { applyStatus } from './mobileOutbox';
import { phoneAccountError } from './phoneAccounts';
import type { Session } from './session';
import mobileApp from '../ui/mobile/MobileApp.tsx?raw';
import macRs from '../../src-tauri/src/mobile.rs?raw';

// 폰은 붙은 컴퓨터가 윈도우여도 '맥에서 열어 주세요'·'맥에 못 닿았어요'라고 했다(2026-10-05 윈도우 0.2.4 QA) —
// 폰 서버 /api/env 의 os 로 machine() 을 맞춘다
afterEach(() => { setHostWin(false); setLang('ko'); });

describe('폰이 부르는 이 컴퓨터 — /api/env os', () => {
  it('서버가 windows 라고 하면 PC, 아니면(옛 서버 포함) 맥', () => {
    expect(envIsWin({ os: 'windows' })).toBe(true);
    expect(envIsWin({ os: 'macos' })).toBe(false);
    expect(envIsWin({})).toBe(false);
  });
  it('setHostWin 뒤 machine() 이 PC', () => {
    setHostWin(true);
    expect(machine()).toBe('PC');
    setHostWin(false);
    expect(machine()).toBe('맥');
  });
  it('기억해 둔 맥 정보에 os 가 남는다(다음 켜기 첫 화면부터 PC)', () => {
    const raw = JSON.stringify({ assistantName: '참모', language: 'ko', devRoot: 'C:/dev', extraProjects: [], hqDir: 'C:/Users/me/.chammo/hq', os: 'windows' });
    expect(envFromCache(raw)?.os).toBe('windows');
    const old = JSON.stringify({ assistantName: '참모', language: 'ko', devRoot: '/dev', extraProjects: [], hqDir: '/hq' });
    expect(envFromCache(old)?.os).toBeUndefined();
  });
  it('서버 env 에 os 를 싣는다', () => expect(macRs).toMatch(/"os": *std::env::consts::OS/));
  it('폰은 env 를 받을 때 setHostWin 한다', () => expect(mobileApp).toMatch(/setHostWin\(envIsWin\(/));
});

describe('윈도우 PC 에 붙은 폰 문구', () => {
  const orch = { id: 'o1', name: '참모', state: 'blocked' } as Session;
  it('맥 대신 PC — 켜기 실패·못 닿음·멈춘 참모·말 못 받음·계정', () => {
    setHostWin(true);
    expect(wakeFailText('Load failed', 'wake').text).toBe('PC에 닿지 않아요 — 연결을 확인해 주세요');
    expect(wakeFailText('mac side took too long', 'wake').text).toBe('PC가 바빠서 답이 늦어요 — 잠시 뒤 목록을 봐 주세요');
    expect(wakeFailText('?', 'wake').text).toBe('못 켰어요 — PC에서 확인해 주세요');
    expect(waitingList([orch], {}, [])[0]?.q).toBe('확인창·선택지에서 멈춰 있어요 — PC에서 열어 골라 주세요');
    const out = applyStatus([{ id: 'm1', status: 'sent' } as never], 'm1', 'unknown', undefined, 0);
    expect((out[0] as { error?: string }).error).toBe('PC가 이 말을 못 받았어요');
    expect(phoneAccountError('unsupported')).toBe('이 PC 앱은 폰 계정 바꾸기를 아직 몰라요 — PC 앱을 새로 깔아 주세요');
    expect(phoneAccountError('locked')).not.toMatch(/맥/);
    setLang('en');
    expect(wakeFailText('Load failed', 'wake').text).toBe("Can't reach the PC — check the connection");
  });
  it('맥은 그대로', () => {
    expect(wakeFailText('Load failed', 'wake').text).toBe('맥에 닿지 않아요 — 연결을 확인해 주세요');
    expect(phoneAccountError('locked')).toBe('맥 키체인이 잠겼거나 허용이 필요해요 — 맥 앞에서 한 번 바꿔 주세요');
  });
  it('폰 화면 파일엔 맥을 박아 둔 문구가 없다', () => {
    const files = import.meta.glob(['../ui/mobile/*.{ts,tsx}', '!../ui/mobile/*.test.*'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(files).length).toBeGreaterThan(20);
    const strip = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [name, src] of Object.entries(files)) {
      expect(strip(src), name).not.toMatch(/['"`>][^'"`<\n]*맥/);
    }
  });
});
