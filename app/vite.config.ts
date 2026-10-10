import { defineConfig } from 'vitest/config'; // vite 의 defineConfig 는 `test` 필드 타입을 모른다
import react from '@vitejs/plugin-react';

// Tauri 개발 서버 규약: 고정 포트, 못 잡으면 실패(다른 포트로 조용히 옮기면 앱이 빈 화면을 띄운다)
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // 창 셋: 메인(index.html) + 항상 위에 떠 있는 다마고치 위젯(widget.html) + 문서 리더(reader.html)
  // + 참모 모드 따로 창(mode.html) + 폰 화면(mobile.html) — 창이 아니라 모바일 서버(src-tauri/src/mobile.rs)가 테일스케일로 내보낸다
  build: { outDir: 'dist', target: 'safari17', rollupOptions: { input: { main: 'index.html', widget: 'widget.html', reader: 'reader.html', mobile: 'mobile.html', mode: 'mode.html' } } },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // CSS 는 기본으로 빈 글이 된다 — 폰 화면 배치(foldLayout)·프사 멈춤(avatarCss)·채팅 탭 줄(chatTabsCss) 규칙을 ?raw 로 읽는 테스트가 있어서 이 파일들만 그대로
    css: { include: [/mobile\.css/, /avatar\.css/, /chat\.css/, /space\.css/] },
  },
});
