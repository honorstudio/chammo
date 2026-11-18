import { describe, expect, it } from 'vitest';
import { withoutKids } from './kids';

describe('withoutKids — 아이 세션은 앱 자동 손길 대상에서 빠진다', () => {
  const s = (id: string, cwd: string) => ({ id, cwd });
  const all = [s('hq', '/u/hq'), s('kid', '/u/.chammo/kids/참모-2'), s('make', '/u/.chammo/kids/참모-2/works/점프 게임'), s('p', '/u/dev/shop'), s('look', '/u/.chammo/kidsfoo')];
  it('<데이터>/kids 아래만 뺀다', () => {
    expect(withoutKids(all, '/u/.chammo').map((x) => x.id)).toEqual(['hq', 'p', 'look']);
  });
  it('데이터 폴더를 모르면 그대로', () => {
    expect(withoutKids(all, '')).toEqual(all);
  });
  it('끝 / 가 붙은 데이터 폴더도', () => {
    expect(withoutKids(all, '/u/.chammo/').map((x) => x.id)).toEqual(['hq', 'p', 'look']);
  });
});

import { kidsLines } from './kids';

describe('kidsLines — 아이 대화 기록을 보호자 채팅 줄로', () => {
  it('아이 말·아이 화면 답·앱 줄만, 시각은 ISO, 열쇠는 겹치지 않게', () => {
    const t = Date.UTC(2026, 10, 17, 12);
    const out = kidsLines([
      { ts: t, who: 'kid', text: '공룡 그려 줘', cid: 'c1' },
      { ts: t, who: 'assistant', text: '좋아!' },
      { ts: t + 1, who: 'guardian', text: '튜닝: 공룡 좋아해' },
      { ts: t + 2, who: 'app', text: '아이 세션 켬' },
    ]);
    expect(out.map((l) => l.kind)).toEqual(['kid', 'reply', 'app']);
    expect(out[0]!.ts).toBe('2026-11-17T12:00:00.000Z');
    expect(new Set(out.map((l) => l.key)).size).toBe(3);
  });
});
