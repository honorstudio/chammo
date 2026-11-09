import { afterEach, describe, expect, it } from 'vitest';
import { onNoteStamp, resetNoteStamp, seeNoteStamp } from './noteStamp';
import { parseTagChunk } from './tagTail';

afterEach(resetNoteStamp);

describe('폰 메모 도장', () => {
  it('바뀔 때만 한 번씩 — 처음 본 것도(목록을 받은 뒤 첫 도장 전에 맥이 고쳤을 수 있다)', () => {
    const got: string[] = [];
    onNoteStamp((s) => got.push(s));
    seeNoteStamp('1');
    seeNoteStamp('1');
    seeNoteStamp('2');
    seeNoteStamp('2');
    seeNoteStamp('3');
    expect(got).toEqual(['1', '2', '3']);
  });
  it('칸이 없는 답(옛 맥·메모 폴더 없음)은 아무것도 안 바꾼다', () => {
    const got: string[] = [];
    onNoteStamp((s) => got.push(s));
    seeNoteStamp('1');
    seeNoteStamp(undefined);
    seeNoteStamp('1');
    expect(got).toEqual(['1']);
  });
  it('끄면 더 안 온다', () => {
    const got: string[] = [];
    const off = onNoteStamp((s) => got.push(s));
    seeNoteStamp('1');
    off();
    seeNoteStamp('2');
    expect(got).toEqual(['1']);
  });
  it('세션 목록 머리줄의 notes 칸을 읽는다 — same 답에도 실린다', () => {
    expect(parseTagChunk('{"tag":"a","same":true,"notes":"17"}\n').notes).toBe('17');
    expect(parseTagChunk('{"tag":"a","same":false}\n[]').notes).toBeUndefined();
    expect(parseTagChunk('{"tag":"a","same":false,"notes":5}\n[]').notes).toBeUndefined();
  });
});
