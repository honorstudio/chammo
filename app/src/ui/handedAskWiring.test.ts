import { describe, expect, it } from 'vitest';
import app from '../App.tsx?raw';

// 2026-10-28 사용자 제보: 넘겨받은 참모(영업 담당)가 비서 말로 깬 턴을 질문으로 끝내 사람이 같은 걸 두 번 답했다
describe('넘겨받은 참모의 끝 질문은 사람에게 안 띄운다 — App 이 참모 활동을 만들 때 거른다', () => {
  it('orchActs 는 quietHanded 를 거친 활동 — 상태·결정 대기함(buildInbox)·알림(freshReplies)이 다 이걸 본다', () => {
    expect(app).toMatch(/const orchActs: SessionActivity\[\] = groups\.orchestrators\.map\(\(s\) => \{\n[^\n]*\n[^\n]*\n\s*const a = raw && quietHanded\(raw, s\.name, taskEvents, now\);/);
    expect(app).toMatch(/const allActs = \[\.\.\.orchActs, \.\.\.activities\];/);
    expect(app).toMatch(/freshReplies\(seenReplies\.current, orchActs\.map/);
  });
  it('음성도 같은 기록으로 — 넘긴 쪽 턴(giverTurn)은 voiceTurn 이 버리지 않는다(더 읽은 뒤에도)', () => {
    expect(app).toMatch(/const giver = \(r: Line\) => giverTurn\(r\.woke, s\.name, taskEvents, now\);/);
    expect(app).toMatch(/let how = voiceTurn\(reply, speakers\.has\(s\.id\), false, giver\);/);
    expect(app).toMatch(/how = voiceTurn\(reply, speakers\.has\(s\.id\), true, giver\);/);
  });
});
