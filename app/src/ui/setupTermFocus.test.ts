import { describe, expect, it } from 'vitest';
import pane from './TerminalPane.tsx?raw';
import setup from './Setup.tsx?raw';

// 2026-10-21 첫 사용자 QA(윈도우 시험 PC·맥 코드): 첫 설정의 '믿기' 터미널이 열려도 키보드가 터미널로 안 가서
// 안내대로 ↓·Enter 를 쳐도 아무 일이 없었다(activeElement=BODY — 누른 '믿기' 버튼은 꺼지며 포커스를 잃는다).
// 터미널이 접힌 아래 화면 밖에 열려 질문도 안 보였다. 화면은 DOM 이 없어 시험 못 하니 이어져 있는지만 본다
describe('첫 설정 터미널은 열리면 바로 칠 수 있다', () => {
  it('TerminalPane 은 autoFocus 면 열자마자 터미널에 포커스를 주고 화면 안으로 스크롤한다', () => {
    expect(pane).toMatch(/autoFocus\?: boolean/);
    expect(pane).toMatch(/if \(autoFocus && !readOnly && !typingElsewhere\(\)\) \{[^}]*term\.focus\(\)/);
    // 가지 검토: 설정 입력칸에 치는 중에 다음 설치 터미널이 열리면 타자가 터미널(설치 명령)로 샜다 — 다른 입력칸에 포커스가 있으면 안 뺏는다
    expect(pane).toMatch(/const typingElsewhere = \(\) =>/);
    expect(pane).toMatch(/scrollIntoView\(\{ block: 'nearest' \}\)/);
  });

  it('설정 화면의 두 터미널(설치·로그인 / 폴더 믿기)이 autoFocus 를 준다', () => {
    expect(setup.match(/<TerminalPane[\s\S]*?autoFocus[\s\S]*?\/>/g)?.length).toBe(2);
  });
});

// 같은 QA(맥·윈도우): 믿기 질문에서 Enter 만 치면(기본값 No, exit) claude 가 끝나는데 터미널은 죽은 질문 화면 그대로,
// 믿기 두 개·다음이 다 꺼진 채 안내가 없었다 — ✕ 를 찾아야만 다시 할 수 있었다
describe('믿기 터미널이 믿지 않고 끝나면 닫고 다시 하라고 알린다', () => {
  it('TerminalPane 은 세션에 붙은 게 아닌 명령이 끝나면(빈 조각) onExit 을 부른다', () => {
    expect(pane).toMatch(/onExit\?: \(\) => void/);
    expect(pane).toMatch(/if \(!bytes\.length\) \{ if \(!disposed\) \{ onEnded\(\); if \(!sid\) exitRef\.current\?\.\(\); \} return; \}/);
  });
  it('Setup 의 믿기 터미널은 끝나면 믿음을 다시 보고, 아니면 닫고 이유를 띄운다', () => {
    expect(setup).toMatch(/const trustExit = \(\) => void refreshTrust\(\)\.then\(\(r\) => setTrusting\(\(w\) => \{ if \(w && !r\[w\]\) \{ setError\(/);
    expect(setup).toMatch(/key=\{`trust-\$\{trusting\}`\}[\s\S]{0,80}onExit=\{trustExit\}/);
  });
});
