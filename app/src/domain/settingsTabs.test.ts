import { describe, expect, it } from 'vitest';
import { ALL_ON, type FeatureSwitch } from './config';
import { FEATURE_TAB, firstTab, settingsEscCloses, settingsTabs } from './settingsTabs';

describe('설정 탭 묶음', () => {
  it('맥은 여덟 탭, 이 순서', () => {
    expect(settingsTabs(false)).toEqual(['general', 'agent', 'features', 'voice', 'phone', 'accounts', 'browser', 'tools']);
  });
  it('윈도우는 계정 탭이 없다(계정 바꿔 끼우기는 맥 키체인)', () => {
    expect(settingsTabs(true)).not.toContain('accounts');
    expect(settingsTabs(true)).toHaveLength(7);
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
