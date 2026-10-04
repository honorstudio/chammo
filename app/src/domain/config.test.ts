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
    expect(featuresOf({ features: { autoRevive: true } }).autoRevive).toBe(true);
    // 화면 조종(computer-use)은 사용자 화면을 움직여서 기본 꺼짐 — 마법사·설정에서 켠다
    expect(featuresOf(null).computerUse).toBe(false);
    expect(featuresOf({ features: { tama: false } })).toEqual({ ...ALL_ON, tama: false });
  });

  it('꺼 둔 기능의 단축키는 막는다', () => {
    const off = { office: false, tama: false, gacha: false, review: false, voice: false, autoRevive: false, agentView: false, computerUse: false };
    expect(allowed({ type: 'goto', to: 'office' }, off)).toBe(false);
    expect(allowed({ type: 'goto', to: 'tama' }, off)).toBe(false);
    expect(allowed({ type: 'goto', to: 'review' }, off)).toBe(false);
    expect(allowed({ type: 'widget' }, off)).toBe(false);
    expect(allowed({ type: 'goto', to: 'all' }, off)).toBe(true);
    expect(allowed({ type: 'goto', to: 'review' }, ALL_ON)).toBe(true);
  });
});
