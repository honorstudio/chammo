import { afterEach, describe, expect, it } from 'vitest';
import { assistant, getLang, pickLang, setAssistant, setLang, tr } from './index';

afterEach(() => { setLang('ko'); setAssistant(null); });

describe('tr — 한국어·영어를 곁에 적고 지금 언어로 고른다', () => {
  it('기본은 한국어, en 이면 영어', () => {
    expect(tr('저장', 'Save')).toBe('저장');
    setLang('en');
    expect(getLang()).toBe('en');
    expect(tr('저장', 'Save')).toBe('Save');
  });
});

describe('pickLang — 처음 켤 때 언어', () => {
  it('저장된 게 있으면 그것, 없으면 시스템 언어가 한국어일 때만 ko', () => {
    expect(pickLang('en', 'ko-KR')).toBe('en');
    expect(pickLang(null, 'ko-KR')).toBe('ko');
    expect(pickLang(null, 'en-US')).toBe('en');
    expect(pickLang('xx', 'ja-JP')).toBe('en');
  });
});

describe('assistant — 비서 이름(설정). 없으면 언어별 기본', () => {
  it('설정한 이름이 우선, 없으면 참모/Chammo', () => {
    expect(assistant()).toBe('참모');
    setLang('en');
    expect(assistant()).toBe('Chammo');
    setAssistant('두목');
    expect(assistant()).toBe('두목');
  });
});
