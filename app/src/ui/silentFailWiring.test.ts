import { describe, expect, it } from 'vitest';
import app from '../App.tsx?raw';
import inbox from './Inbox.tsx?raw';

// 2026-11-01 ux-daily M8·M15 — 눌러도 아무 일 없어 보이던 곳: 작업 기록 쓰기 실패를 삼킴, 꺼진 세션 줄 누름, 대기함 답장 실패에 글만 지워짐
describe('실패를 삼키지 않는다', () => {
  it('끝난 걸로·모두 끝난 걸로·처리함은 기록 실패를 띠로', () => {
    expect(app).toMatch(/void answerTask\(item, tr\('처리함', 'Handled'\)\)\.catch\(recordFail\)/);
    expect(app).toMatch(/Promise\.resolve\(\)\)\.catch\(recordFail\)\.then\(\(\) => refresh\(\)\)/);
    expect(app).toMatch(/note: tr\('세션 없음 — 끝난 걸로 정리', 'No session — marked as finished'\) \}\)\.then\(\(\) => refresh\(\), recordFail\)/);
  });
  it('꺼진 세션 줄을 누르면 할 수 있는 것을 띠로 — 조용히 return 하지 않는다', () => {
    expect(app).toMatch(/const s = findTarget\(sessions, target\);\n\s*\/\/[^\n]*\n\s*if \(!s\) \{ setError\(/);
  });
  it('대기함 답장은 replyInbox 로(실패는 던짐), 줄은 실패면 글을 남기고 까닭을 띄운다', () => {
    expect(app).toMatch(/const replyItem = \(item: InboxItem, text: string\) => replyInbox\(\{/);
    expect(app).toMatch(/waiting: \(task\) => invoke<boolean>\('task_waiting', \{ task \}\)/);
    expect(inbox).toMatch(/await onReply\(item, t\);\n\s*setText\(''\);\n\s*\} catch/);
    expect(inbox).toMatch(/\{fail && !why && <div className="inbox-why" role="alert">\{fail\}<\/div>\}/);
  });
});
