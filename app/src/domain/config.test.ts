import { describe, expect, it } from 'vitest';
import { ALL_ON, allowed, featuresOf, mirrorPlan } from './config';

describe('mirrorPlan — 설정의 언어·비서 이름을 localStorage 로', () => {
  it('같으면 쓸 것도 다시 열 것도 없다', () => {
    expect(mirrorPlan({ language: 'ko', assistantName: '참모' }, { lang: 'ko', assistantName: '참모' }, 'ko')).toEqual({ writes: {}, reload: false });
  });

  it('언어가 다르게 떠 있으면 비추고 다시 연다', () => {
    expect(mirrorPlan({ language: 'en', assistantName: '' }, { lang: null, assistantName: null }, 'ko')).toEqual({ writes: { lang: 'en' }, reload: true });
  });

  it('시스템 언어로 이미 맞게 떴으면 비추기만 한다', () => {
    expect(mirrorPlan({ language: 'en', assistantName: '' }, { lang: null, assistantName: null }, 'en')).toEqual({ writes: { lang: 'en' }, reload: false });
  });

  it('비서 이름이 바뀌면 비추고 다시 연다, 빈 이름은 지운다', () => {
    expect(mirrorPlan({ language: 'ko', assistantName: ' 참모 ' }, { lang: 'ko', assistantName: null }, 'ko')).toEqual({ writes: { assistantName: '참모' }, reload: true });
    expect(mirrorPlan({ language: 'ko', assistantName: '' }, { lang: 'ko', assistantName: '참모' }, 'ko')).toEqual({ writes: { assistantName: null }, reload: true });
  });

  it('모르는 언어 값은 건드리지 않는다', () => {
    expect(mirrorPlan({ language: '', assistantName: '' }, { lang: 'en', assistantName: null }, 'en')).toEqual({ writes: {}, reload: false });
  });
});

describe('기능 켜기', () => {
  it('설정이 없거나 빠진 칸은 켠 것', () => {
    expect(featuresOf(null)).toEqual(ALL_ON);
    // 자동 다시 켜기는 무인 기계(아이맥)에서만 켠다 — 저장된 값이 없으면 꺼짐
    expect(featuresOf(null).autoRevive).toBe(false);
    expect(featuresOf(null).autoTidy).toBe(true); // 세션 자동 정리는 기본 켬(2026-10-23)
    expect(featuresOf({ features: { autoRevive: true } }).autoRevive).toBe(true);
    // 화면 조종(computer-use)은 사용자 화면을 움직여서 기본 꺼짐 — 마법사·설정에서 켠다
    expect(featuresOf(null).computerUse).toBe(false);
    // 익명 사용 통계는 기본 켬 — 설정 > 기능에서 끈다(2026-10-24 사용자)
    expect(featuresOf(null).usagePing).toBe(true);
    expect(featuresOf({ features: { tama: false } })).toEqual({ ...ALL_ON, tama: false });
  });

  it('꺼 둔 기능의 단축키는 막는다', () => {
    const off = { office: false, tama: false, gacha: false, review: false, voice: false, autoRevive: false, autoTidy: false, agentView: false, computerUse: false, usagePing: false, animation: 'auto' as const };
    expect(allowed({ type: 'goto', to: 'office' }, off)).toBe(false);
    expect(allowed({ type: 'goto', to: 'tama' }, off)).toBe(false);
    expect(allowed({ type: 'goto', to: 'review' }, off)).toBe(false);
    expect(allowed({ type: 'widget' }, off)).toBe(false);
    expect(allowed({ type: 'goto', to: 'all' }, off)).toBe(true);
    expect(allowed({ type: 'goto', to: 'review' }, ALL_ON)).toBe(true);
  });
});

// 2026-10-12 사용자 "부하 심하면 애니메이션 때문에 끊긴다 — 자동으로 줄이고, 설정에서 없애기" — 세 갈래: 자동(기본)·줄이기·끄기
describe('애니메이션 설정', () => {
  it('기본은 자동, 옛 설정(칸 없음)도 자동', () => {
    expect(ALL_ON.animation).toBe('auto');
    expect(featuresOf({ features: { tama: false } }).animation).toBe('auto');
  });
  it('고른 값은 그대로, 모르는 값은 자동으로', () => {
    expect(featuresOf({ features: { animation: 'reduce' } }).animation).toBe('reduce');
    expect(featuresOf({ features: { animation: 'off' } }).animation).toBe('off');
    expect(featuresOf({ features: { animation: 'zoom' as never } }).animation).toBe('auto');
  });
});
