import { describe, expect, it } from 'vitest';
import pane from './BrowserPane.tsx?raw';
import rust from '../../../src-tauri/src/agent_browser.rs?raw';
import main from '../../../src-tauri/src/main.rs?raw';

// 2026-10-28 사용자 — 칸 머리줄 X 를 브라우저의 X(탭 닫기)로 읽었다. 탭 칩마다 X = 그 탭 닫기, 칸 숨기기는 스페이스 탭 줄 X 하나로만
describe('브라우저 칸 탭 X', () => {
  const bar = pane.slice(pane.indexOf('<div className="bp-bar">'), pane.indexOf('<div className="bp-screen"'));
  it('머리줄에 칸 숨기기 X 가 없다', () => {
    expect(bar).not.toMatch(/onClick=\{onHide\}/);
    expect(bar).not.toMatch(/숨기기 — 브라우저는 그대로/);
  });
  it('탭 칩마다 X — 그 탭 닫기(개입부터, agent_close_tab)', () => {
    const tabs = bar.slice(bar.indexOf('tabs.map'));
    expect(tabs).toMatch(/className="bp-tab-x"/);
    expect(tabs).toMatch(/label=\{tr\(`\$\{x\.label\} 탭 닫기`/);
    expect(pane).toMatch(/mine\(\)\.then\(\(\) => invoke\('agent_close_tab', \{ profile, pid: live\.pid, target: id \}\)\)/);
  });
  it('Rust 명령 — 마지막 탭이면 빈 탭을 먼저 열고 닫는다·사람 조작만', () => {
    const f = rust.slice(rust.indexOf('pub fn agent_close_tab'));
    expect(f.slice(0, 1200)).toMatch(/human_ok\(&profile, pid\)/);
    expect(f.slice(0, 1600)).toMatch(/Target\.closeTarget/);
    expect(main).toMatch(/agent_browser::agent_close_tab/);
  });
  it('더보기 맨 안쪽 브라우저 끄기는 그대로 — 끄면 칸이 닫힌다(onClosed)', () => {
    expect(pane).toMatch(/close: \{ label: live\.sessionPid > 0 \? tr\('브라우저 끄기/);
    expect(pane).toMatch(/close: \{[^\n]*run: closeNow \}/);
    expect(pane).toMatch(/invoke\('agent_close_browser', \{ profile \}\)\.then\(\(\) => onClosed\?\.\(profile, live\.pid\)/);
  });
  it('마지막 탭 X = 브라우저 끄기(10-28 사용자) — 세션 브라우저면 한 줄 확인(끄기·취소)', () => {
    const f = pane.slice(pane.indexOf('const closeTab = '));
    expect(f.slice(0, 400)).toMatch(/closeWay\(live, t\.pages\.length\)/);
    expect(pane).toMatch(/세션이 쓰는 중이야 — 끌까\?/);
    expect(pane).toMatch(/className="cv-btn danger" onClick=\{closeNow\}/);
  });
});
