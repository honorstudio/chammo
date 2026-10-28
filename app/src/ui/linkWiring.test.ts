import { describe, expect, it } from 'vitest';
import pane from './TerminalPane.tsx?raw';
import grid from './SessionGrid.tsx?raw';
import chat from './chat/ChatView.tsx?raw';

// 2026-10-21 사용자: 다른 참모가 claude respawn 하자 터미널 보기만 'Session … has exited.' 로 죽고 채팅 글이 거기로 가서 '보내는 중'에 걸렸다.
// 판단은 domain/attachExit·paneLinks·chatQueue 시험에 있고, 여기선 화면이 그 판단에 이어져 있는지만 본다
describe('끊긴 터미널 보기 — 다시 붙기·기다렸다 치기·말풍선 상태가 이어져 있다', () => {
  it('TerminalPane 은 attach 끝 줄을 보고 목록에서 살아 있을 때만 다시 붙는다(epoch)', () => {
    expect(pane).toMatch(/exitWatcher\(sid\)/);
    expect(pane).toMatch(/listedAlive\(j, sid!\)/);
    expect(pane).toMatch(/stopped\.includes\(sid!\)/); // 앱이 끈 세션엔 안 붙는다(attach 가 다시 켠다)
    expect(pane).toMatch(/step === 'attach'[^\n]*setEpoch/);
    expect(pane).toMatch(/clearInterval\(relink\)/);
    expect(pane).toMatch(/if \(!bytes\.length\) \{ if \(!disposed\) \{ onEnded\(\);/); // 끝 글을 못 알아봐도 attach 가 끝나면(빈 조각) 안다
  });

  it('SessionGrid 는 누른 순간의 손잡이가 아니라 붙어 있는 보기를 기다렸다 친다', () => {
    expect(grid).toMatch(/await links\.wait\(id, LINK_WAIT[,)]/); // 붙는 중이면 더 기다리는 hold 가 붙을 수 있다(2026-10-27 boot-storm)
    expect(grid).not.toMatch(/typeAndSend\(id, panes\.current\.get\(id\)/);
    expect(grid).toMatch(/links\.set\(id, st === 'live'/);
  });

  it('ChatView 는 붙음 상태를 말풍선 판단에 넘기고, 끊긴 동안엔 Enter 다시 넣기를 안 한다', () => {
    expect(chat).toMatch(/pendingState\(p, \{ queue, termText, now: Date\.now\(\), enterWait, link \}\)/);
    expect(chat).toMatch(/\(link && link !== 'live'\) \? null/);
    expect(chat).toMatch(/wait: tr\(/);
  });
});

import app from '../App.tsx?raw';
import revive from './useOrchRevive.ts?raw';
describe('꺼진 참모 다시 켜기 — App 이 판단(domain/orchRevive)을 같은 대화 respawn 에 잇는다', () => {
  it('살아 있는 참모 목록을 넘기고, 다시 켜기는 resumeSession(짧은 번호 = claude respawn)', () => {
    expect(app).toMatch(/useOrchRevive\(\{\s*orchs: navOrchs/);
    expect(app).toMatch(/await resumeSession\(s\.cwd, s\.sessionId, s\.id\)/);
  });
  it('앱이 끈 목록을 못 읽으면 판단하지 않는다 — 사람이 끈 참모를 켜지 않게', () => {
    expect(revive).toMatch(/if \(!stopped\) return;/);
    expect(revive).toMatch(/stoppedByApp: \(id\) => stopped\.includes\(id\)/);
  });
  it('앱 밖에서 claude stop 으로 끈 참모(daemon.log)도 넘긴다 — 못 읽으면 빈 목록(예전처럼 켠다)(#6)', () => {
    expect(revive).toMatch(/daemonStoppedRecently\(\)\.catch\(\(\) => \[\] as string\[\]\)/);
    expect(revive).toMatch(/stoppedOutside: \(id\) => outside\.includes\(id\)/);
  });
});
