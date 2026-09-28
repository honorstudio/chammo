import { defineConfig } from 'vitest/config'; // vite 의 defineConfig 는 `test` 필드 타입을 모른다
import react from '@vitejs/plugin-react';

// Tauri 개발 서버 규약: 고정 포트, 못 잡으면 실패(다른 포트로 조용히 옮기면 앱이 빈 화면을 띄운다)
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // 창 셋: 메인(index.html) + 항상 위에 떠 있는 다마고치 위젯(widget.html) + 문서 리더(reader.html) + 다마고치 더보기(tama-more.html)
  build: { outDir: 'dist', target: 'safari17', rollupOptions: { input: { main: 'index.html', widget: 'widget.html', reader: 'reader.html', tamaMore: 'tama-more.html' } } },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
