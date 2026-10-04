import { afterEach, describe, expect, it } from 'vitest';
import { assistant, getLang, josa, pickLang, setAssistant, setLang, setWinKeys, tr } from './index';

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

describe('tr — 윈도우면 단축키 표기(⌘M)를 윈도우 키로(Ctrl+Shift+M)', () => {
  afterEach(() => setWinKeys(false));
  it('윈도우는 바꾸고 맥은 그대로', () => {
    setWinKeys(true);
    expect(tr('메모 열기 (⌘M)', 'Open notes (⌘M)')).toBe('메모 열기 (Ctrl+Shift+M)');
    setWinKeys(false);
    expect(tr('메모 열기 (⌘M)', 'Open notes (⌘M)')).toBe('메모 열기 (⌘M)');
  });
});

describe('josa — 이름 뒤 조사(비서 이름을 사용자가 정하니까 — 화면 문구에 참모가 박혀 있던 것, 2026-10-03 QA 13번)', () => {
  it('받침 없으면 뒤의 것', () => expect(josa('참모', '이', '가')).toBe('참모가'));
  it('받침 있으면 앞의 것', () => expect(josa('두목', '이', '가')).toBe('두목이'));
  it('한글이 아니면 받침 없는 쪽', () => expect(josa('Chammo', '을', '를')).toBe('Chammo를'));
});
