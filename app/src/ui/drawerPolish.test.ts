import { describe, expect, it } from 'vitest';
import drawer from './craft/CraftDrawer.tsx?raw';
import main from '../../src-tauri/src/main.rs?raw';
import paused from './paused.css?raw';
import app from '../App.tsx?raw';

// 2026-10-19 사용자 확정 v8 A2 + B1 — 불러올 땐 아는 앱 먼저(자리표시), 서랍 아래 라이선스 줄은 앱 메뉴 '오픈소스 라이선스…' 창으로
describe('앱 서랍 다듬기', () => {
  it('서랍 아래 라이선스 줄이 없다 · 글 한 줄 대신 자리표시', () => {
    expect(drawer).not.toMatch(/cd-lic/);
    expect(drawer).not.toMatch(/앱 목록을 받는 중/);
    expect(drawer).toMatch(/cd-sk/);
    expect(paused).toMatch(/\.cd-sk/);
  });
  it('Chammo 메뉴 Chammo 정보 아래 오픈소스 라이선스 → 창', () => {
    expect(main).toMatch(/"licenses"/);
    expect(app).toMatch(/LicensesDialog/);
  });
});

// 2026-10-19 사용자 "이 텍스트는 없어질 애들이지?" — 칸 머리는 이름만, 체크섬·공증 설명은 라이선스 창 아래 한 줄로
import licenses from './LicensesDialog.tsx?raw';
describe('서랍 글은 읽을 것만', () => {
  it('칸 머리는 이름만 — 체크섬·공증 설명 줄 없음', () => {
    expect(drawer).not.toMatch(/체크섬/);
    expect(drawer).toMatch(/tr\('깔 수 있는 것', 'Available'\)/);
  });
  it('체크섬·공증 설명은 라이선스 창 아래', () => {
    expect(licenses).toMatch(/체크섬/);
  });
});
