// 폰 모델 칩은 데스크톱 칩과 같은 함수를 탄다 — /model·/effort 가 ~/.claude/settings.json 새 세션 기본값까지 바꾼 일(lesson-claude-config)을
// runModelPick 이 기본값을 떠 두고 되돌려 막는다(modelPickRun.test '모델만 — 바꾸고 기본값 파일은 그대로'). 폰 길이 따로 /model 을 치면 그 막이를 건너뛴다
import { describe, expect, it } from 'vitest';
import grid from './SessionGrid.tsx?raw';
import app from '../App.tsx?raw';

describe('폰 모델 칩 길', () => {
  it('앱은 폰 요청을 세션 창(SessionGrid)으로 넘기고 직접 치지 않는다', () => {
    const at = app.indexOf("it.kind === 'modelPick'");
    expect(at).toBeGreaterThan(0);
    const branch = app.slice(at, at + 400);
    expect(branch).toMatch(/phone-model-pick/);
    expect(branch).not.toMatch(/\/model|sendText|raw\(/);
  });
  it('SessionGrid 는 칩과 폰이 같은 pickFor(runModelPick + claudeDefaults)를 쓴다', () => {
    expect(grid).toMatch(/runModelPick\(api, want, \{[^}]*defaults: claudeDefaults/);
    expect(grid).toMatch(/const pickFor = async/);
    expect((grid.match(/pickFor\(/g) ?? []).length).toBeGreaterThanOrEqual(2); // 칩 + 폰
    expect(grid).toMatch(/phone-model-pick/);
  });
});
