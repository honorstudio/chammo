import { describe, expect, it } from 'vitest';
import pane from './TerminalPane.tsx?raw';
import grid from './SessionGrid.tsx?raw';
import app from '../App.tsx?raw';
import load from './useLoad.ts?raw';
import revive from './useOrchRevive.ts?raw';

// 2026-10-26 23:50 강제 재부팅 뒤(부하 35→70): 참모 칸이 'Attaching… ^[[I' → 'Session not responding — restarting it…' 를 되풀이했고
// 채팅으로 보낸 말은 '전달 안 됨', 위엔 '세션 목록 실패: command timed out'. 판단은 domain/attachExit·busyGate·paneLinks 시험에 있고,
// 여기선 화면이 그 판단에 이어져 있는지만 본다
describe('부팅 폭주 — 화면이 판단에 이어져 있다', () => {
  it('TerminalPane: 세션 화면이 와야 live(안내 줄은 attaching), 바쁘면 차례를 받고 붙는다, 화면 전엔 포커스 보고를 안 보낸다', () => {
    expect(pane).toMatch(/attachPhaseWatcher\(\)/);
    expect(pane).toMatch(/if \(ph === 'ready'\) \{[^\n]*linkRef\.current\?\.\('live'\)/);
    expect(pane).not.toMatch(/if \(!shown && !disposed\) \{ shown = true; linkRef\.current\?\.\('live'\); \}/); // 첫 글자 = 붙음 이던 옛 줄
    expect(pane.indexOf('turns.take(')).toBeGreaterThan(0);
    expect(pane.indexOf('turns.take(')).toBeLessThan(pane.indexOf('openPty(command'));
    expect(pane).toMatch(/!screenUp && \(d === '\\x1b\[I' \|\| d === '\\x1b\[O'\)/);
    expect(pane).toMatch(/stopTurn\(\);/); // 칸이 닫히면 차례를 놓는다
  });
  it('TerminalPane: 끊긴 칸은 바쁘면 느리게·같이 쓰는 목록으로 다시 본다', () => {
    expect(pane).toMatch(/reattachEvery\(busy\)/);
    expect(pane).toMatch(/listSessionsRaw\(busy === 'ok'\)/);
    expect(pane).toMatch(/step === 'attach' && busy !== 'ok'[\s\S]{0,200}listSessionsRaw\(true\)/); // 붙기 직전엔 새로
  });
  it('SessionGrid: 붙는 중엔 터미널로 돌려 봤어도 채팅+안내, 굳은 끊김은 기다리던 말을 놓는다', () => {
    expect(grid).toMatch(/linkOf\[id\] !== 'live' && !termNow\.has\(id\)/); // 붙는 중 사람이 고른 터미널은 덮지 않는다
    expect(grid).toMatch(/if \(linkNow\.get\(id\) === 'gone'\) throw/); // 굳은 끊김 뒤 줄 선 말도 바로 실패
    expect(grid).toMatch(/linkNow\.delete\(id\)/);
    expect(grid).toMatch(/linkOf\[id\] === 'attaching' && !slowLink\[id\]\) return null/); // 한가할 땐 깜빡이지 않게
    expect(grid).toMatch(/if \(st === 'gone'\) links\.drop\(id\)/);
    expect(grid).toMatch(/linkNotice\(\{/);
    expect(grid).toMatch(/HOLD_MAX/);
  });
  it('App: 목록 실패는 listErrorText 로(시간 초과 한 번은 조용히), 바쁘면 목록을 10초에 한 번', () => {
    expect(app).toMatch(/listErrorText\(String\(e\), listFails\.current, busyNow\(\)\)/);
    expect(app).toMatch(/busyNow\(\) !== 'ok' && Date\.now\(\) - polledAt < BUSY_POLL/);
  });
  it('부하 주기가 바쁨을 넣고, 참모 다시 켜기는 바쁘면 늦춘다', () => {
    expect(load).toMatch(/feedBusy\(s\)/);
    expect(revive).toMatch(/busy: busyNow\(\) !== 'ok'/);
  });
});
