// 새 세션 기본 모델 칸 받침 — 진짜 Setup(참모 탭)·폰 MoreSheet + 가짜 앱 명령·가짜 폰 서버(web.ts 를 stub 으로 바꿔 끼운다)
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

const here = __dirname;
export default defineConfig({
  root: here,
  cacheDir: process.env.E2E_CACHE,
  plugins: [react(), {
    name: 'web-stub',
    enforce: 'pre',
    async resolveId(src, importer) {
      if (!importer?.endsWith('/MoreSheet.tsx') || !/data\/web$/.test(src)) return null;
      const r = await this.resolve(src, importer, { skipSelf: true });
      return r && r.id.endsWith('/src/data/web.ts') ? path.join(here, 'webStub.ts') : null;
    },
  }],
  resolve: { alias: { '@pro': path.resolve(here, '../../../pro/web') } },
  server: { port: Number(process.env.E2E_PORT), strictPort: true, host: '127.0.0.1', fs: { allow: [path.resolve(here, '../../..')] } },
});
