import { describe, expect, it } from 'vitest';
import hook from './useGoalStall.ts?raw';
import app from '../App.tsx?raw';

// 2026-10-26 오래 멈춘 목표 알림 — 세션 자동 정리와 같은 스위치·같은 길(sendToSession), 하루 한 번 기억은 localStorage
describe('useGoalStall — 앱이 1분마다 보고 참모 입력칸에 한 줄', () => {
  it('설정 "세션 자동 정리" 스위치를 같이 따른다', () => {
    expect(app).toMatch(/useGoalStall\(\{ on: features\.autoTidy, orchs: groups\.orchestrators, events: taskEvents, sessions \}\);/);
  });
  it('domain/goalStall 로 고르고 sendToSession 으로 넣는다 — 넣기 전에 기억(못 넣으면 지운다)', () => {
    expect(hook).toMatch(/pickGoalStall\(/);
    expect(hook).toMatch(/sendToSession\(p\.orch\.id, stallText\(p\.stall, now\)\)/);
    const at = hook.indexOf('last.current.set(p.key, now)');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(hook.indexOf('sendToSession('));
    expect(hook).toMatch(/localStorage/);
  });
});
