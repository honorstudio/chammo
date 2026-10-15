import { describe, expect, it } from 'vitest';
import app from '../App.tsx?raw';
import useLoad from './useLoad.ts?raw';
import dash from './mobile/OrchDash.tsx?raw';
import calm from './calm.ts?raw';

// 2026-10-12 사용자 '부하 심하면 자동으로 애니메이션 최소화 + 설정에서 없애기' — 새 폴링 없이 이미 읽는 부하 주기에 얹는다
describe('애니메이션 줄이기 연결', () => {
  it('설정 > 기능 > 애니메이션이 바뀌면 화면에 건다', () => {
    expect(app).toMatch(/useEffect\(\(\) => \{ setAnimation\(features\.animation\); \}, \[features\.animation\]\);/);
  });
  it('데스크톱은 부하 모니터(useLoad)가 잴 때마다, 폰은 이미 받는 /api/load 로 — 새 주기를 만들지 않는다', () => {
    expect(useLoad).toMatch(/feedLoad\(s\);/);
    expect(dash).toMatch(/feedLoad\(phoneLoad && phoneLoad\.level !== 'unknown' && !phoneLoad\.stale \? \{ load1: phoneLoad\.load1, cores: phoneLoad\.cores \} : null\)/);
    expect(calm).not.toMatch(/setInterval|every\(|setTimeout/);
  });
  it('줄이기는 oa-calm, 끄기는 oa-still', () => {
    expect(calm).toMatch(/root\.classList\.toggle\('oa-calm', next === 'reduce'\);/);
    expect(calm).toMatch(/root\.classList\.toggle\('oa-still', next === 'off'\);/);
  });
});
