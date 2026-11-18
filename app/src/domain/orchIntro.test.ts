import { describe, expect, it } from 'vitest';
import { parseChat } from './chat';
import { orchIntro, orchIntroKids, orchIntroKidsHead } from './orchIntro';
import { setLang } from '../i18n';
import mobileRs from '../../src-tauri/src/mobile.rs?raw';
import kidsLifeRs from '../../src-tauri/src/kids_life.rs?raw';

const asUser = (text: string) => JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-10-22T01:00:00Z', message: { role: 'user', content: text } });

describe('새 참모 자기소개 요청', () => {
  it('재현: 사람 말풍선이 아니라 앱이 넘긴 줄로 보인다(QA 25)', () => {
    for (const l of ['ko', 'en'] as const) {
      setLang(l);
      expect(parseChat(asUser(orchIntro()))[0]?.kind).toBe('relay');
    }
    setLang('ko');
  });
  it('폰에서 깨울 때도 같은 글', () => {
    setLang('ko');
    expect(mobileRs).toContain(JSON.stringify(orchIntro()));
    setLang('en');
    expect(mobileRs).toContain(JSON.stringify(orchIntro()));
    setLang('ko');
  });
  it('키즈 참모 첫 인사 — 폰(kids_life.rs)과 같은 글, 아이 이름은 끝에', () => {
    for (const l of ['ko', 'en'] as const) {
      setLang(l);
      expect(kidsLifeRs).toContain(JSON.stringify(orchIntroKidsHead()));
      expect(parseChat(asUser(orchIntroKids('서아')))[0]?.kind).toBe('relay');
    }
    setLang('ko');
    expect(orchIntroKids(' 서아 ').endsWith('아이 이름: 서아')).toBe(true);
    expect(orchIntroKids(' ')).toBe(orchIntroKidsHead());
  });
});
