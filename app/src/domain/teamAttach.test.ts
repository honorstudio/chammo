// 11-05 '사진 여러 장을 한 번에 올리면 안 간다'(팀원 DM 에 같은 사진 세 번) — 대화 첨부 나누기·칩 글
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MAX_SAY_FILES, attNote, attachQueue, sendBatches, upPct } from './teamAttach';

const f = (i: number) => ({ id: `f${i}`, team: 't', room: 'r', name: `IMG_${i}.jpg`, size: 100 });

describe('10장 넘는 첨부는 나눠 보낸다', () => {
  it('상한은 Rust e2e_envelope MAX_FILES 와 같다 — 받는 쪽(0.4.8 포함)이 넘는 말의 파일을 통째 버린다', () => {
    const rs = readFileSync(new URL('../../src-tauri/src/e2e_envelope.rs', import.meta.url), 'utf8');
    expect(rs).toContain(`pub const MAX_FILES: usize = ${MAX_SAY_FILES};`);
  });
  it('10장까지는 한 번, 글과 같이', () => {
    expect(sendBatches('봐 줘', [f(1), f(2)])).toEqual([{ text: '봐 줘', files: [f(1), f(2)], from: 0 }]);
    const ten = Array.from({ length: 10 }, (_, i) => f(i));
    expect(sendBatches('', ten)).toHaveLength(1);
    expect(sendBatches('글만', [])).toEqual([{ text: '글만', files: [], from: 0 }]);
  });
  it('11·20·21장 — 10장씩, 글은 첫 묶음에만, 순서·빠짐 없이', () => {
    for (const n of [11, 20, 21, 50]) {
      const all = Array.from({ length: n }, (_, i) => f(i));
      const b = sendBatches('사진', all);
      expect(b).toHaveLength(Math.ceil(n / 10));
      expect(b.every((x) => x.files.length <= MAX_SAY_FILES && x.files.length > 0)).toBe(true);
      expect(b.flatMap((x) => x.files)).toEqual(all);
      expect(b.map((x) => x.text)).toEqual(['사진', ...Array(b.length - 1).fill('')]);
      expect(b.map((x) => x.from)).toEqual(b.map((_, i) => i * 10));
    }
  });
});

describe('칩 글 — 올리는 동안 가고 있다는 것', () => {
  it('대기 · 올리는 중(몇 %) · 못 올림 · 다 올리면 크기', () => {
    expect(attNote({ wait: true }, null)).toBe('대기');
    expect(attNote({ busy: true }, null)).toBe('올리는 중');
    expect(attNote({ busy: true }, 42)).toBe('올리는 중 42%');
    expect(attNote({ err: 'x', busy: false }, 42)).toBe('못 올림');
    expect(attNote({ size: 3_100_000 }, null)).toBe('3.1 MB');
    expect(attNote({}, null)).toBe('');
  });
  it('몇 % — 그 방·그 이름의 올리는 중 줄(실패 줄·다른 방·보관함 줄은 안 본다)', () => {
    const ups = [
      { room: 'r1', name: 'a.jpg', done: 30, total: 100, error: '' },
      { room: '', name: 'a.jpg', done: 90, total: 100, error: '' },
      { room: 'r1', name: 'b.jpg', done: 5, total: 10, error: '실패' },
      { room: 'r1', name: 'c.jpg', done: 0, total: 0, error: '' },
    ];
    expect(upPct(ups, 'r1', 'a.jpg')).toBe(30);
    expect(upPct(ups, 'r2', 'a.jpg')).toBeNull();
    expect(upPct(ups, 'r1', 'b.jpg')).toBeNull();
    expect(upPct(ups, 'r1', 'c.jpg')).toBeNull();
    expect(upPct([{ room: 'r1', name: 'd.jpg', done: 100, total: 100, error: '' }], 'r1', 'd.jpg')).toBe(99);
  });
});

describe('차례 줄 — 한 장씩, 넣자마자 돈다', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  it('넣은 순서대로 하나씩(겹치지 않게) 다 돈다 — 11-05 첫 고침은 화면이 다시 그려지기 전이라 다 건너뛰었다', async () => {
    const log: string[] = [];
    let live = 0, most = 0;
    const q = attachQueue(async (k) => { live++; most = Math.max(most, live); log.push(k); await tick(); live--; });
    await q.add(['a', 'b', 'c']);
    await q.add(['d']);
    expect(log).toEqual(['a', 'b', 'c', 'd']);
    expect(most).toBe(1);
  });
  it('기다리는 동안 뺀 것은 건너뛰고, 한 장이 실패해도 다음 장은 간다', async () => {
    const log: string[] = [];
    const q = attachQueue(async (k) => { log.push(k); if (k === 'a') throw new Error('망'); });
    const done = q.add(['a', 'b', 'c']);
    q.drop('b');
    await done;
    expect(log).toEqual(['a', 'c']);
  });
});
