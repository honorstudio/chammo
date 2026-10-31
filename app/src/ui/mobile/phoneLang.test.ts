import { describe, expect, it } from 'vitest';
import { ENV_KEY, hostLang, langChanged } from './phoneLang';
import { ENV_KEY as BOOT_ENV_KEY } from '../../domain/boot';
import mobileEntry from '../../mobile.tsx?raw';

describe('폰 화면 언어 = 붙은 컴퓨터 설정 언어(공개 이슈 #16)', () => {
  it('재현: 컴퓨터가 영어면 한국어 폰이어도 영어', () => {
    expect(hostLang('{"language":"en","assistantName":"Chammo"}', 'ko-KR')).toBe('en');
    expect(hostLang('{"language":"ko"}', 'en-US')).toBe('ko');
  });
  it('지난 맥 정보가 없거나 깨졌으면 폰 시스템 언어로 짐작', () => {
    expect(hostLang(null, 'en-US')).toBe('en');
    expect(hostLang(null, 'ko-KR')).toBe('ko');
    expect(hostLang('{깨짐', 'ko-KR')).toBe('ko');
    expect(hostLang('{"language":"fr"}', 'en-GB')).toBe('en');
  });
  it('새로 받은 맥 정보의 언어가 지금 화면과 다를 때만 다시 그린다', () => {
    expect(langChanged('en', 'ko')).toBe(true);
    expect(langChanged('ko', 'ko')).toBe(false);
    expect(langChanged(undefined, 'ko')).toBe(false); // 옛 서버
    expect(langChanged('fr', 'en')).toBe(false);
  });
  it('지난 맥 정보 자리는 boot 와 같고, 진입점은 화면 모듈보다 먼저 언어를 정한다', () => {
    expect(ENV_KEY).toBe(BOOT_ENV_KEY);
    const imports = [...mobileEntry.matchAll(/^import .*?'(\.[^']+)';$/gm)].map((m) => m[1]);
    expect(imports.findIndex((p) => p === './ui/mobile/phoneLang')).toBe(0);
  });
});
