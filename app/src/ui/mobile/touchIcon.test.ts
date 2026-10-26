import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import mobileHtml from '../../../mobile.html?raw';
import viteConfig from '../../../vite.config.ts?raw';
import phoneHtml from '../../../phone.html?raw';
import vitePhoneConfig from '../../../vite.phone.config.ts?raw';
import { inlineTouchIcon } from './touchIcon';

const png = new Uint8Array(readFileSync(new URL('../../../public/assets/apple-touch-icon.png', import.meta.url)));

describe('홈 화면 앱 아이콘을 html 안에(data:) — 망에서 못 받아도 프사', () => {
  it('진짜 mobile.html 의 apple-touch-icon 이 같은 그림의 data: 로 바뀐다(줄 모양이 바뀌어 조용히 안 바뀌는 일 없게)', () => {
    const out = inlineTouchIcon(mobileHtml, png);
    const hrefs = [...out.matchAll(/<link rel="apple-touch-icon" href="([^"]+)"/g)].map((m) => m[1]!);
    expect(hrefs).toHaveLength(1);
    expect(hrefs[0]!.startsWith('data:image/png;base64,')).toBe(true);
    expect(Buffer.from(hrefs[0]!.slice('data:image/png;base64,'.length), 'base64').equals(Buffer.from(png))).toBe(true);
  });

  it('다른 줄(시작 그림·파비콘·manifest)은 그대로', () => {
    const out = inlineTouchIcon(mobileHtml, png);
    expect(out.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/, '/assets/apple-touch-icon.png')).toBe(mobileHtml);
  });

  it('빌드가 폰 화면 html 에 이걸 건다', () => {
    expect(viteConfig).toMatch(/inlineTouchIcon\(/);
    expect(viteConfig).toMatch(/mobile\.html/);
  });

  it('폰 입구(phone.chammo.app — phone.html·index·pair)도 data: 로 건다(10-26 사용자 실기: 입구에서 추가한 홈 화면 앱이 \'참\' 글자)', () => {
    const out = inlineTouchIcon(phoneHtml, png);
    expect(out).toMatch(/rel="apple-touch-icon" href="data:image\/png;base64,/);
    expect(vitePhoneConfig).toMatch(/inlineTouchIcon\(/);
  });
});
