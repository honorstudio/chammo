import { describe, expect, it } from 'vitest';
import { isCodePath, isGeneratedPath } from './codeLines';
import { fmtNum, setLang } from '../i18n';

describe('isGeneratedPath — 커밋 크기 규칙이 예외로 치는 자동 생성물 (리뷰 화면 생성물 칸)', () => {
  it('lock·빌드 결과·스키마 타입·마이그레이션·스냅샷', () => {
    for (const p of ['pnpm-lock.yaml', 'app/package-lock.json', 'yarn.lock', 'src-tauri/Cargo.lock', 'ios/Podfile.lock', 'dist/index.js', 'web/build/app.js', 'a.min.js',
      'src/types/database.types.ts', 'src/api.generated.ts', 'supabase/migrations/20260901_init.sql', 'src/__snapshots__/a.snap'])
      expect(isGeneratedPath(p), p).toBe(true);
    for (const p of ['src/ui/A.tsx', 'docs/build-notes.md', 'src/lock.ts', 'sql/query.sql'])
      expect(isGeneratedPath(p), p).toBe(false);
  });

  it('lock 변형도 — 복사본·공백 붙은 이름 (work-stats 이상치 27만 줄의 원인)', () => {
    for (const p of ['package-lock-original.json', 'package-lock 2.json', 'yarn 2.lock', 'composer.lock', 'Gemfile.lock'])
      expect(isGeneratedPath(p), p).toBe(true);
  });
});

describe('isCodePath — 줄 수(위 막대 오늘 커밋·다마고치·리플레이)에 넣는 파일', () => {
  it('코드·문서는 센다', () => {
    for (const p of ['src/ui/A.tsx', 'src-tauri/src/claude.rs', 'docs/starter.md', 'scripts/task', 'styles/app.css', 'sql/query.sql', 'src/build.ts'])
      expect(isCodePath(p), p).toBe(true);
  });

  it('디자인 파일은 안 센다 — .ai 는 글자 PostScript 라 git 이 수백만 줄로 센다 (11-02 하루 300만 줄)', () => {
    for (const p of ['assets/orders/2026-11/sign.ai', 'a.eps', 'doc.PDF', 'b.psd', 'icon.svg', 'x.vectorcraft', 'y.sketch', 'z.fig', 'book.indd'])
      expect(isCodePath(p), p).toBe(false);
  });

  it('git 이 따옴표로 감싼 한글 경로·이름 바꾸기(=>)도 확장자로 가린다 (11-02 그래서 안 걸렸다)', () => {
    expect(isCodePath('"assets/orders/2026-11-01-\\354\\233\\215/\\354\\233\\215_20261101.ai"')).toBe(false);
    expect(isCodePath('"assets/\\354\\233\\215.vectorcraft"')).toBe(false);
    expect(isCodePath('"src/\\354\\233\\215.ts"')).toBe(true);
    expect(isCodePath('assets/{old => new}/a.ai')).toBe(false);
    expect(isCodePath('a.txt => b.ai')).toBe(false);
    expect(isCodePath('{lib => src}/a.ts')).toBe(true);
    expect(isGeneratedPath('"앱/pnpm-lock.yaml"')).toBe(true);
  });

  it('생성물·압축·남의 코드 폴더도 안 센다', () => {
    for (const p of ['pnpm-lock.yaml', 'a.min.js', 'b.min.css', 'app.js.map', 'out.zip', 'x.tar.gz', 'node_modules/a/index.js', 'ios/Pods/x.m', 'vendor/lib.js', '.next/a.js', 'coverage/lcov.info', 'reference/old.ts', 'server.log'])
      expect(isCodePath(p), p).toBe(false);
  });
});

describe('fmtNum — 천 단위 콤마', () => {
  it('한국어·영어 둘 다', () => {
    setLang('en');
    expect(fmtNum(3056669)).toBe('3,056,669');
    setLang('ko');
    expect(fmtNum(3056669)).toBe('3,056,669');
    expect(fmtNum(382)).toBe('382');
  });
});
