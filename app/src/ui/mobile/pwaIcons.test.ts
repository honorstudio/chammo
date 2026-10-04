// 폰 홈 화면 앱 아이콘 — manifest·mobile.html·sw.js 가 가리키는 그림이 public/ 에 있고, 폰 서버가 내주는 모양인지.
// 폰 서버(mobile_http asset_path)는 /sw.js·/manifest.webmanifest 말고는 /assets/<이름> 한 단계만 내준다 — 다른 길이면 실제 서버에서만 404
import { describe, expect, it } from 'vitest';
import manifestRaw from '../../../public/manifest.webmanifest?raw';
import swRaw from '../../../public/sw.js?raw';
import mobileHtml from '../../../mobile.html?raw';

// public/assets 의 그림 — data: 주소로 받아 PNG 머리에서 크기를 읽는다(@types/node 없이)
const files = import.meta.glob('../../../public/assets/*', { eager: true, query: '?inline', import: 'default' }) as Record<string, string>;
const byPath = new Map(Object.entries(files).map(([k, v]) => [k.replace('../../../public', ''), v]));
const served = (src: string) => /^\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(src) && byPath.has(src);
const pngSize = (src: string) => {
  const bin = atob(byPath.get(src)!.split(',')[1]!);
  const u32 = (o: number) => ((bin.charCodeAt(o) << 24) | (bin.charCodeAt(o + 1) << 16) | (bin.charCodeAt(o + 2) << 8) | bin.charCodeAt(o + 3)) >>> 0;
  return [u32(16), u32(20)];
};

describe('폰 홈 화면 앱 아이콘(대표 캐릭터 파란 모찌)', () => {
  const manifest = JSON.parse(manifestRaw) as { icons?: { src: string; sizes: string; purpose?: string }[] };

  it('manifest 에 192·512·maskable 512, 전부 폰 서버가 내주는 길이고 적힌 크기 그대로', () => {
    const icons = manifest.icons ?? [];
    expect(icons.map((i) => `${i.sizes} ${i.purpose ?? 'any'}`).sort()).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
    for (const i of icons) {
      expect(served(i.src), i.src).toBe(true);
      expect(pngSize(i.src).join('x')).toBe(i.sizes);
    }
  });

  it('mobile.html — apple-touch-icon 180·파비콘이 폰 서버가 내주는 길', () => {
    const html = mobileHtml;
    const hrefs = [...html.matchAll(/<link rel="(apple-touch-icon|icon)"[^>]*href="([^"]+)"/g)].map((m) => [m[1], m[2]!] as const);
    expect(hrefs.map(([r]) => r).sort()).toEqual(['apple-touch-icon', 'icon', 'icon']);
    for (const [, h] of hrefs) expect(served(h), h).toBe(true);
    const touch = hrefs.find(([r]) => r === 'apple-touch-icon')![1];
    expect(pngSize(touch)).toEqual([180, 180]);
  });

  it('푸시 알림 그림도 같은 아이콘', () => {
    const icon = swRaw.match(/icon: '([^']+)'/)?.[1] ?? '';
    expect(served(icon), icon).toBe(true);
  });
});
