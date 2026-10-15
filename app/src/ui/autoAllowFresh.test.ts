// 자동 허용이 키를 누른 뒤 '풀렸나'를 볼 때는 같이 쓰는 세션 목록(2.5초)이 아니라 새로 묻는다 — 공유 목록을 타면 누른 지 1.5초 만에 받은 옛 목록으로
// '풀리지 않음'이라 보고 "자동 허용 실패 — 열어서 봐줘" 헛알림이 갈 수 있었다(2026-10-11 bug-hunt, perf/loops 회귀 리뷰)
import { describe, expect, it } from 'vitest';
import hook from './useAutoAllow.ts?raw';
import data from '../data/tauri.ts?raw';
import rust from '../../src-tauri/src/claude.rs?raw';

describe('자동 허용 확인은 새 목록으로', () => {
  it('키를 누른 뒤의 확인은 listSessionsRaw(true)', () => {
    const after = hook.slice(hook.indexOf('await sendKeys('));
    expect(after).toMatch(/listSessionsRaw\(true\)/);
  });
  it('fresh 를 Rust list_sessions 로 넘기고, Rust 는 fresh 면 같이 쓰던 목록을 버린다', () => {
    expect(data).toMatch(/listSessionsRaw = \(fresh\??: boolean\) => invoke<string>\('list_sessions', \{ fresh/);
    const body = rust.slice(rust.indexOf('pub async fn list_sessions('), rust.indexOf('pub async fn list_sessions(') + 400);
    expect(body).toMatch(/fresh[\s\S]*forget_agents\(\)/);
  });
});
