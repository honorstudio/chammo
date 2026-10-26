// 폰 입구 빌드(ADR 0013) — 앱(dist)과 따로 dist-phone 에. Cloudflare 정적 파일로 내보낸다(배포는 사람이 정한 뒤).
// 입구 자기 파일은 /l/ 에(컴퓨터 화면 /assets/* 와 안 섞이게), 아이콘·시작 그림만 /assets 에 복사(OS 가 서비스 워커 없이 가져간다).
// 중계 주소는 코드에 없다 — CHAMMO_RELAY 를 주면 config.json 으로 같이 낸다(구글 로그인 시작용)
import { defineConfig } from 'vite';
import { cpSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inlineTouchIcon } from './src/ui/mobile/touchIcon';

const out = resolve(__dirname, 'dist-phone');

export default defineConfig({
  publicDir: 'public-phone',
  build: {
    outDir: out,
    emptyOutDir: true,
    target: 'safari17',
    assetsDir: 'l',
    rollupOptions: { input: { phone: resolve(__dirname, 'phone.html') } },
  },
  plugins: [
    // 홈 화면 앱 아이콘을 html 안에(data:) — 아이폰 '홈 화면에 추가'가 망에서 그림을 못 쓰고 '참' 글자를 만들었다(touchIcon.ts, 10-26 입구에서도)
    {
      name: 'inline-touch-icon',
      transformIndexHtml: {
        order: 'post',
        handler: (html) => inlineTouchIcon(html, readFileSync(resolve(__dirname, 'public/assets/apple-touch-icon.png'))),
      },
    },
    {
      name: 'phone-web-finish',
      closeBundle() {
        // 입구는 / 와 /pair 둘 다 — QR 은 /pair#… (서비스 워커가 / 는 받아 둔 컴퓨터 화면으로 주니까)
        copyFileSync(resolve(out, 'phone.html'), resolve(out, 'index.html'));
        copyFileSync(resolve(out, 'phone.html'), resolve(out, 'pair.html'));
        mkdirSync(resolve(out, 'assets'), { recursive: true });
        cpSync(resolve(__dirname, 'public/assets'), resolve(out, 'assets'), { recursive: true });
        const relay = process.env.CHAMMO_RELAY?.trim();
        if (relay) writeFileSync(resolve(out, 'config.json'), JSON.stringify({ relay: relay.replace(/\/+$/, '') }) + '\n');
      },
    },
  ],
});
