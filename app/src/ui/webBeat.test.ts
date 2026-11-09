// 웹 화면 숨소리 — 맥 앱 모든 창이 Rust 감시(web_watch.rs)에 숨을 보낸다(11-06 메인 창 하얗게, 앱은 살아 있었다)
import { describe, expect, it } from 'vitest';
import { BEAT_MS, startBeat } from './webBeat';
import main from '../main.tsx?raw';
import messenger from '../messenger.tsx?raw';
import notes from '../notes.tsx?raw';
import reader from '../reader.tsx?raw';
import mode from '../mode.tsx?raw';
import craft from '../craft.tsx?raw';
import bubble from '../bubble.tsx?raw';

function fake(hidden = false) {
  const s = { hidden, tick: null as null | (() => void), change: null as null | (() => void), ms: 0, sent: [] as boolean[] };
  const beat = startBeat((v) => s.sent.push(v), {
    hidden: () => s.hidden,
    onChange: (f) => { s.change = f; },
    every: (f, ms) => { s.tick = f; s.ms = ms; },
  });
  return { s, beat };
}

describe('웹 숨소리', () => {
  it('켜자마자 한 번, 보이는 동안 5초마다', () => {
    const { s } = fake();
    expect(s.sent).toEqual([true]);
    expect(s.ms).toBe(BEAT_MS);
    expect(BEAT_MS).toBe(5000);
    s.tick!();
    s.tick!();
    expect(s.sent).toEqual([true, true, true]);
  });

  it('가려지면 바뀔 때 한 번 알리고 그 뒤론 안 보낸다(가만히 CPU)', () => {
    const { s } = fake();
    s.hidden = true;
    s.change!();
    expect(s.sent).toEqual([true, false]);
    s.tick!();
    s.tick!();
    expect(s.sent).toEqual([true, false]);
  });

  it('다시 보이면 바로 알리고 5초 숨도 다시 돈다', () => {
    const { s } = fake(true);
    expect(s.sent).toEqual([false]);
    s.hidden = false;
    s.change!();
    s.tick!();
    expect(s.sent).toEqual([false, true, true]);
  });

  it('창이 앞으로 올 때 Rust 가 부르는 beat 는 가려져 있어도 답한다 — 안 답하면 굳은 창으로 본다', () => {
    const { s, beat } = fake(true);
    beat();
    expect(s.sent).toEqual([false, false]);
  });

  it('맥 앱 창 8가지가 모두 숨을 쉰다(폰 웹은 아니다)', () => {
    for (const src of [main, messenger, notes, reader, mode, craft, bubble]) {
      expect(src).toContain("./ui/webBeat");
    }
  });
});
