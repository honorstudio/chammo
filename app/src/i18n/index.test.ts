import { afterEach, describe, expect, it } from 'vitest';
import { assistant, getLang, josa, machine, oneLang, pickLang, setAssistant, setLang, setWinKeys, tr } from './index';

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

describe('machine — 이 컴퓨터를 부르는 말(윈도우에 맥 문구가 나왔다, 2026-10-05)', () => {
  it('윈도우는 PC, 맥은 맥/Mac', () => {
    setLang('ko');
    expect(machine(true)).toBe('PC');
    expect(machine(false)).toBe('맥');
    setLang('en');
    expect(machine(true)).toBe('PC');
    expect(machine(false)).toBe('Mac');
    setLang('ko');
  });
  it('조사가 붙는다 — 맥이 / PC가', () => {
    setLang('ko');
    expect(josa(machine(false), '이', '가')).toBe('맥이');
    expect(josa(machine(true), '이', '가')).toBe('PC가');
  });
});

describe('oneLang — 스크립트가 내는 \'English / 한국어\' 이중 문구를 사람 화면엔 설정 언어 하나로(공개 이슈 #16)', () => {
  const rel = 'crafts-2026.10.19: could not get the Chammo apps release / 참모 앱 공개 릴리스를 못 받음 — HTTP Error 404: Not Found';
  it('재현: 앱 서랍 까닭 줄', () => {
    expect(oneLang(rel, 'en')).toBe('crafts-2026.10.19: could not get the Chammo apps release — HTTP Error 404: Not Found');
    expect(oneLang(rel, 'ko')).toBe('crafts-2026.10.19: 참모 앱 공개 릴리스를 못 받음 — HTTP Error 404: Not Found');
  });
  it('scripts/craft 오류 모양들', () => {
    const cases: [string, string, string][] = [
      ['unknown app / 모르는 앱: foo — photocraft, gridcraft', 'unknown app: foo — photocraft, gridcraft', '모르는 앱: foo — photocraft, gridcraft'],
      ['PhotoCraft: up to 3 per app / 한 앱에 3개까지', 'PhotoCraft: up to 3 per app', 'PhotoCraft: 한 앱에 3개까지'],
      ['PhotoCraft: no public release yet / 아직 공개 릴리스 없음 — CHAMMO_CRAFT_LOCAL=<DMG folder / DMG 폴더>',
        'PhotoCraft: no public release yet — CHAMMO_CRAFT_LOCAL=<DMG folder>', 'PhotoCraft: 아직 공개 릴리스 없음 — CHAMMO_CRAFT_LOCAL=<DMG 폴더>'],
      ['SHA-256 mismatch / 체크섬이 안 맞음 (a.zip: 1… ≠ 2…) — thrown away', 'SHA-256 mismatch (a.zip: 1… ≠ 2…) — thrown away', '체크섬이 안 맞음 (a.zip: 1… ≠ 2…) — thrown away'],
      ['GridCraft is not open / 안 띄움 — scripts/craft open gridcraft --native', 'GridCraft is not open — scripts/craft open gridcraft --native', '안 띄움 — scripts/craft open gridcraft --native'],
      ['pdfcraft: PDF / PDF 읽기·편집', 'pdfcraft: PDF', 'pdfcraft: PDF 읽기·편집'],
    ];
    for (const [t, en, ko] of cases) {
      expect(oneLang(t, 'en'), t).toBe(en);
      expect(oneLang(t, 'ko'), t).toBe(ko);
    }
  });
  it('한 언어 글·빗금이 그냥 쓰인 글은 그대로', () => {
    for (const t of ['HTTP Error 404', '파일을 못 읽었어요', 'a / b', 'and/or 한글', '경로: /Users/me/a / b', '']) {
      expect(oneLang(t, 'en')).toBe(t);
      expect(oneLang(t, 'ko')).toBe(t);
    }
  });
  it('언어를 안 주면 지금 언어', () => {
    setLang('en');
    expect(oneLang(rel)).toContain('could not get');
    setLang('ko');
    expect(oneLang(rel)).toContain('못 받음');
  });
});
