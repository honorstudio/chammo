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

// 2026-10-28 사용자 "이거 굳이 계속 로딩해야 할 이유가 있나 인디케이터?" — 칸을 떠나면 서랍이 지워져 열 때마다 처음부터 읽었다
describe('서랍은 마지막 목록을 기억한다', () => {
  it('기억(메모리+저장소)으로 시작 — 자리표시는 기억이 없을 때만', () => {
    expect(drawer).toMatch(/const memo = drawerMemo\(/);
    expect(drawer).toMatch(/useState<DrawerRow\[\] \| null>\(\(\) => memo\.load\(\)\)/);
    expect(drawer).toMatch(/const view = drawerView\(rows, err\)/);
    expect(drawer).toMatch(/view === 'skeleton'/);
  });
  it('새로 읽으면 바뀐 칸만 바꾸고 기억에 남긴다', () => {
    expect(drawer).toMatch(/mergeRows\(old, r\)/);
    expect(drawer).toMatch(/memo\.save\(/);
  });
  it('기억이 있으면 네트워크 없는 먼저 읽기를 건너뛴다(스크립트를 두 번 안 띄움)', () => {
    expect(drawer).toMatch(/if \(!refresh && !memo\.load\(\)\)/);
  });
  it('읽기가 실패하고 목록이 없으면 오류 한 줄 + 다시 시도(자리표시를 계속 두지 않는다)', () => {
    expect(drawer).toMatch(/className="cd-err"[^]*?onClick=\{\(\) => load\(\)\}/);
    expect(drawer).not.toMatch(/view === 'skeleton' && !err/); // 오류면 자리표시 대신 오류 줄
    expect(drawer).toMatch(/fail\(e\)/);
    // 먼저 읽기(15초 한도)가 실패해도 목록이 없으면 바로 오류 — 전엔 삼켜서 전체 읽기 한도(60초)까지 자리표시였다
    expect(drawer).toMatch(/fast: true \}\)\.then\(\(r\) => setRows\(\(old\) => old \?\? r\), \(e\) => \{ if \(!memo\.load\(\)\) fail\(e\); \}\)/);
  });
});
