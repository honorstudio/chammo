import { describe, expect, it } from 'vitest';
import { ALL_ON, type FeatureSwitch } from './config';
import { FEATURE_TAB, firstTab, settingsEscCloses, settingsTabs, tabOf } from './settingsTabs';

describe('설정 탭 묶음', () => {
  it('아홉 탭, 이 순서 — 폰과 메신저는 기기 관리·메신저 둘로(10-24)', () => {
    expect(settingsTabs(false)).toEqual(['general', 'agent', 'features', 'voice', 'devices', 'messenger', 'accounts', 'browser', 'tools']);
  });
  it('윈도우도 계정 탭이 있다 — Chammo 계정이 거기 산다(Claude 계정 바꿔 끼우기만 맥 전용)', () => {
    expect(settingsTabs(true)).toEqual(settingsTabs(false));
  });
  it('옛 탭 이름 phone 으로 열면 기기 관리로, 모르는 이름은 일반으로', () => {
    expect(tabOf('phone')).toBe('devices');
    expect(tabOf('messenger')).toBe('messenger');
    expect(tabOf('accounts')).toBe('accounts');
    expect(tabOf('nope')).toBeUndefined();
    expect(tabOf(undefined)).toBeUndefined();
  });
  it('켬·끔 기능은 빠짐없이 어느 탭엔가 있다', () => {
    const keys = Object.keys(ALL_ON).filter((k) => k !== 'animation') as FeatureSwitch[];
    for (const k of keys) expect(settingsTabs(false)).toContain(FEATURE_TAB[k]);
  });
  it('업데이트 띠에서 열면 도구 점검 탭부터, 아니면 일반', () => {
    expect(firstTab('update')).toBe('tools');
    expect(firstTab('python')).toBe('tools'); // 서랍 '파이썬 설치하기'로 열면 점검 줄의 설치 터미널부터
    expect(firstTab(undefined)).toBe('general');
  });
});

describe('설정 모달 Esc', () => {
  it('Esc 는 닫는다 — 입력칸 안에서도', () => {
    expect(settingsEscCloses({ key: 'Escape', composing: false, inTerminal: false })).toBe(true);
  });
  it('한글 조합 중 Esc·터미널(설치·로그인 창) 안 Esc 는 그쪽 몫', () => {
    expect(settingsEscCloses({ key: 'Escape', composing: true, inTerminal: false })).toBe(false);
    expect(settingsEscCloses({ key: 'Escape', composing: false, inTerminal: true })).toBe(false);
  });
  it('다른 키는 안 닫는다', () => {
    expect(settingsEscCloses({ key: 'Enter', composing: false, inTerminal: false })).toBe(false);
  });
});
