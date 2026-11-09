// 보관함 프로젝트 쉬운 화면 배선 — 내가 볼 차례 카드는 결정 대기함과 같은 줄(InboxRow plain), 목록은 도메인 가르기, 처음엔 큰 입력칸
import { describe, expect, it } from 'vitest';
import view from './ProjectView.tsx?raw';
import app from '../../App.tsx?raw';
import inbox from '../Inbox.tsx?raw';
import space from './SpaceView.tsx?raw';

describe('보관함 프로젝트 쉬운 화면 배선', () => {
  it('목록은 projectBuckets 로 가르고, 프로젝트가 없으면 FirstRun', () => {
    expect(view).toMatch(/const b = projectBuckets\(/);
    expect(view).toMatch(/if \(isFirstRun\(all\)\) return <FirstRun /);
  });
  it('내가 볼 차례 = 결정 대기함 InboxRow(plain)·직접 카드를 프로젝트별로', () => {
    expect(app).toMatch(/<InboxRow plain item=\{i\}/);
    expect(app).toMatch(/direct\.cardNode\(c, 'locker'\)/);
    expect(space).toMatch(/asksOf: \(p\) => \(projectsUi\?\.asks \?\? \[\]\)\.filter\(\(a\) => askMatches\(a, p\)\)/);
  });
  it('plain 이면 머리줄(종류·폴더 이름) 대신 카드 제목, 자리글은 사람 말', () => {
    expect(inbox).toMatch(/\{!plain && \(\s*<div className="card-top">/);
    expect(inbox).toMatch(/hint=\{plain \? PLAIN_HINT\(\) : replyHint\(item\)\}/);
  });
  it('다음에 시킬 일 = 살아 있는 프로젝트 세션에, 없으면 참모에게(같은 sendTextToSession 길)', () => {
    expect(space).toMatch(/if \(s\) \{ await sendTextToSession\(s\.id, text\); return; \}/);
  });
});
