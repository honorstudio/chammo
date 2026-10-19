import { defineConfig } from 'vitest/config'; // vite 의 defineConfig 는 `test` 필드 타입을 모른다
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { inlineTouchIcon } from './src/ui/mobile/touchIcon';

// Tauri 개발 서버 규약: 고정 포트, 못 잡으면 실패(다른 포트로 조용히 옮기면 앱이 빈 화면을 띄운다)
export default defineConfig({
  plugins: [
    react(),
    // 폰 화면 html 의 홈 화면 앱 아이콘을 data: 로 — 아이폰 '홈 화면에 추가'가 망에서 그림을 못 쓰고 '참' 글자를 만들었다(touchIcon.ts)
    {
      name: 'inline-touch-icon',
      transformIndexHtml: {
        order: 'post',
        handler: (html, ctx) => (ctx.path.endsWith('/mobile.html') ? inlineTouchIcon(html, readFileSync('public/assets/apple-touch-icon.png')) : html),
      },
    },
  ],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // 창 셋: 메인(index.html) + 항상 위에 떠 있는 다마고치 위젯(widget.html) + 문서 리더(reader.html)
  // + 참모 모드 따로 창(mode.html) + Craft 맥 앱 따로 창(craft.html) + 폰 화면(mobile.html) — 창이 아니라 모바일 서버(src-tauri/src/mobile.rs)가 테일스케일로 내보낸다
  build: { outDir: 'dist', target: 'safari17', rollupOptions: { input: { main: 'index.html', widget: 'widget.html', reader: 'reader.html', mobile: 'mobile.html', mode: 'mode.html', craft: 'craft.html' } } },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // CSS 는 기본으로 빈 글이 된다 — 폰 화면 배치(foldLayout)·프사 멈춤(avatarCss)·리뷰 칸(review.test) 규칙을 ?raw 로 읽는 테스트가 있고,
    // 안 볼 때 멈춤(paused.test)이 src 의 CSS 를 전부 읽어서 src/ui 아래는 다 그대로
    css: { include: [/\/src\/ui\/.*\.css/] },
  },
});
