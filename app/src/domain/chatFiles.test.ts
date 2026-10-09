import { describe, expect, it } from 'vitest';
import { atLine, cardMoves, chatFiles, MERGE_MS } from './chatFiles';
import { interleave } from './chatExtras';

const row = (o: Record<string, unknown>) => JSON.stringify(o);
const ME = 'aaaa0001';
const OTHER = 'bbbb0002';

describe('chatFiles — show.jsonl 에서 이 참모가 보여 준 파일 카드', () => {
  it('이 참모 줄만, 오래된 순으로 — 다른 참모·하위 세션·주인 없는 줄은 뺀다', () => {
    const log = [
      row({ ts: '2026-10-08T01:00:00+00:00', path: '/u/a.html', from: ME }),
      row({ ts: '2026-10-08T01:01:00+00:00', path: '/u/b.png', from: OTHER }),
      row({ ts: '2026-10-08T01:02:00+00:00', path: '/u/c.pdf' }),
      row({ ts: '2026-10-08T01:03:00+00:00', path: '/u/d.md', from: ME, at: { line: 12 } }),
    ].join('\n');
    expect(chatFiles(log, ME).map((f) => [f.path, f.ts, f.at])).toEqual([
      ['/u/a.html', '2026-10-08T01:00:00+00:00', undefined],
      ['/u/d.md', '2026-10-08T01:03:00+00:00', { line: 12 }],
    ]);
    expect(chatFiles(log, OTHER).map((f) => f.path)).toEqual(['/u/b.png']);
  });

  it('깨진 줄·못 찾은 파일(gone)·시각 없는 줄은 건너뛴다', () => {
    const log = ['{깨짐', row({ ts: 'x', path: '/u/a.md', from: ME }), row({ ts: '2026-10-08T01:00:00Z', path: '/u/gone.md', from: ME, gone: true }), row({ ts: '2026-10-08T01:00:00Z', path: '/u/ok.md', from: ME }), ''].join('\n');
    expect(chatFiles(log, ME).map((f) => f.path)).toEqual(['/u/ok.md']);
  });

  it('같은 파일·같은 곳을 짧게 여러 번 보여 주면 한 장 — 마지막 보여 준 자리로 옮긴다', () => {
    const log = [
      row({ ts: '2026-10-08T01:00:00Z', path: '/u/a.html', from: ME }),
      row({ ts: '2026-10-08T01:02:00Z', path: '/u/b.png', from: ME }),
      row({ ts: '2026-10-08T01:05:00Z', path: '/u/a.html', from: ME }), // 고치고 다시 띄움
      row({ ts: '2026-10-08T01:09:00Z', path: '/u/a.html', from: ME }),
    ].join('\n');
    const out = chatFiles(log, ME);
    expect(out.map((f) => [f.path, f.ts])).toEqual([
      ['/u/b.png', '2026-10-08T01:02:00Z'],
      ['/u/a.html', '2026-10-08T01:09:00Z'],
    ]);
    // 카드 key 는 처음 보여 준 시각 — 옮겨도 같은 카드(다시 그리며 썸네일을 또 받지 않게)
    expect(out[1]!.key).toBe('show:/u/a.html:2026-10-08T01:00:00Z');
  });

  it('묶기는 앞 것에서 MERGE_MS 안까지 — 넘으면 새 카드', () => {
    const t0 = Date.parse('2026-10-08T01:00:00Z');
    const iso = (ms: number) => new Date(ms).toISOString();
    const log = [
      row({ ts: iso(t0), path: '/u/a.md', from: ME }),
      row({ ts: iso(t0 + MERGE_MS + 1000), path: '/u/a.md', from: ME }),
    ].join('\n');
    expect(chatFiles(log, ME)).toHaveLength(2);
  });

  it('같은 파일이라도 짚은 곳이 다르면 따로 — 다른 곳을 가리킨 것', () => {
    const log = [
      row({ ts: '2026-10-08T01:00:00Z', path: '/u/a.md', from: ME, at: { find: '결제' } }),
      row({ ts: '2026-10-08T01:01:00Z', path: '/u/a.md', from: ME, at: { find: '환불' } }),
      row({ ts: '2026-10-08T01:02:00Z', path: '/u/a.md', from: ME, at: { find: '환불' } }),
    ].join('\n');
    expect(chatFiles(log, ME).map((f) => f.at?.find)).toEqual(['결제', '환불']);
  });

  it('웹 주소도 카드', () => {
    const log = row({ ts: '2026-10-08T01:00:00Z', path: 'http://localhost:3000/shop', from: ME });
    expect(chatFiles(log, ME).map((f) => f.path)).toEqual(['http://localhost:3000/shop']);
  });
});

describe('atLine — 짚은 곳 한 줄', () => {
  it('줄·범위·찾을 글·페이지·영역', () => {
    expect(atLine(undefined)).toBe('');
    expect(atLine({ line: 264 })).toBe(':264');
    expect(atLine({ line: 264, lineEnd: 270 })).toBe(':264-270');
    expect(atLine({ find: '결제 버튼' })).toBe('"결제 버튼"');
    expect(atLine({ page: 3 })).toBe('3쪽');
    expect(atLine({ box: [0.1, 0.2, 0.3, 0.4] })).toBe('그림 한 곳');
  });
  it('찾을 글이 길면 줄인다', () => {
    expect(atLine({ find: '가'.repeat(80) })).toBe(`"${'가'.repeat(40)}…"`);
  });
});

describe('interleave clip — 파일 카드는 그려진 첫 말보다 앞이면 안 그린다', () => {
  const items = [{ ts: '2026-10-08T01:00:00Z', id: 'u1' }, { ts: '2026-10-08T01:10:00Z', id: 'a1' }];
  const keys = (out: ReturnType<typeof interleave<{ ts: string; id: string }, { ts: string; key: string; clip?: boolean }>>) => out.map((x) => ('item' in x ? x.item.id : x.extra.key));
  it('앞 대화를 아직 안 읽었거나 /clear 앞 카드가 맨 위에 몰리지 않게 — clip 카드만 뺀다', () => {
    const out = interleave(items, [
      { ts: '2026-10-08T00:30:00Z', key: 'old-file', clip: true },
      { ts: '2026-10-08T00:30:00Z', key: 'old-direct' },
      { ts: '2026-10-08T01:05:00Z', key: 'mid-file', clip: true },
      { ts: '2026-10-08T01:20:00Z', key: 'new-file', clip: true },
    ]);
    expect(keys(out)).toEqual(['old-direct', 'u1', 'mid-file', 'a1', 'new-file']);
  });
  it('말이 하나도 없으면 clip 카드는 없다', () => {
    expect(keys(interleave([], [{ ts: '2026-10-08T01:05:00Z', key: 'f', clip: true }]))).toEqual([]);
  });
  it('첫 말과 같은 시각은 그린다(첫 말 앞에)', () => {
    expect(keys(interleave(items, [{ ts: '2026-10-08T01:00:00Z', key: 'f', clip: true }]))).toEqual(['f', 'u1', 'a1']);
  });
});

describe('cardMoves — 카드를 누르면 스페이스·채팅 탭을 그 참모로 옮길지', () => {
  it('다른 참모 카드(쌓아 보기) — 스페이스도 채팅 탭도 그 참모로', () => {
    expect(cardMoves(OTHER, { view: ME, chat: ME })).toEqual({ space: OTHER, tab: OTHER });
  });
  it('스페이스만 다른 참모를 보고 있으면 탭은 그대로 두고 스페이스만', () => {
    expect(cardMoves(ME, { view: OTHER, chat: ME })).toEqual({ space: ME, tab: null });
  });
  it('이미 그 참모면 아무것도 안 옮긴다, 주인 모르면(by 없음) 그대로', () => {
    expect(cardMoves(ME, { view: ME, chat: ME })).toEqual({ space: null, tab: null });
    expect(cardMoves('', { view: ME, chat: OTHER })).toEqual({ space: null, tab: null });
  });
});
