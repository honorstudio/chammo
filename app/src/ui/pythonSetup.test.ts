import { describe, expect, it } from 'vitest';
import drawer from './craft/CraftDrawer.tsx?raw';
import app from '../App.tsx?raw';
import setup from './Setup.tsx?raw';

// 서랍 '설치하기' → open-setup 신호 → App 이 설정을 'python' 작업과 함께 연다 → 점검 줄의 설치 터미널(2026-10-21 윈도우 새 PC)
describe('파이썬 설치 흐름 연결', () => {
  it('서랍은 파이썬 없음이면 원문 대신 안내 + 설치하기(설정 신호), 누른 뒤엔 다시 시도 아이콘', () => {
    expect(drawer).toMatch(/openSetup\('python'\)/);
    expect(drawer).toMatch(/aria-label=\{tr\('다시 시도'/);
    expect(drawer).toMatch(/craftErr\(e\)/);
  });
  it('App 은 신호를 받아 설정을 그 작업과 함께 열고, 작업이 바뀌면 설정을 새로 띄운다(열린 채로는 시작 작업이 안 먹는다)', () => {
    expect(app).toMatch(/addEventListener\(OPEN_SETUP/);
    expect(app).toMatch(/<Setup key=\{settingsStart \?\? ''\}/);
    // 어느 길로 닫혀도 시작 작업을 비운다 — 남으면 다음에 열 때 winget 설치를 또 돌린다
    expect(app).toMatch(/setSettingsOpen\(false\); setSettingsStart\(undefined\)/);
  });
  it('설정은 시작 작업을 설치 터미널로 바로 돌린다', () => {
    expect(setup).toMatch(/useState<SetupTask \| null>\(start \?\? null\)/);
    // 윈도우 git·파이썬 줄은 한 함수(winToolRow)가 그린다 — 설치 단추는 run(t)
    expect(setup).toMatch(/winToolRow\('python'/);
    expect(setup).toMatch(/onClick=\{\(\) => run\(t\)\}/);
    // 설치 터미널이 실패 꼬리로 끝나면 그 줄을 '설치가 끝나지 않았어요'로(win-env H3) — 전엔 실패도 '깔렸는데 못 찾아요'
    expect(setup).toMatch(/onExit=\{\(screen\) => \{ if \(setupFailed\(screen\)\) setFailed/);
  });
});
