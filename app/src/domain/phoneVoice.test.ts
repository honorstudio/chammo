import { describe, expect, it } from 'vitest';
import { BEAT_MS, HOLD_MS, TOUCH_WINDOW_MS, beatBody, cancelStep, isReady, pickItem, sayLevel, silentWav, speakerShown, speakerTap } from './phoneVoice';

const NOW = 1_000_000;

describe('폰 음성 — 소리 받을 준비', () => {
  const base = { unlocked: true, visible: true, lastTouch: NOW - 10_000, now: NOW };
  it('깨어 있고 앞에 떠 있고 최근에 만졌으면 준비됨', () => {
    expect(isReady(base)).toBe(true);
  });
  it('한 번도 안 눌러 오디오가 안 깨어 있으면(iOS 자동 재생 막힘) 아님', () => {
    expect(isReady({ ...base, unlocked: false })).toBe(false);
  });
  it('화면을 떠났으면 아님', () => {
    expect(isReady({ ...base, visible: false })).toBe(false);
  });
  it('오래 안 만졌으면 아님 — 폰이 책상 위에서 켜져만 있을 때 소리가 폰으로 가지 않게', () => {
    expect(isReady({ ...base, lastTouch: NOW - TOUCH_WINDOW_MS + 1 })).toBe(true);
    expect(isReady({ ...base, lastTouch: NOW - TOUCH_WINDOW_MS - 1 })).toBe(false);
    expect(isReady({ ...base, lastTouch: 0 })).toBe(false);
  });
});

describe('폰 음성 — 하트비트 몸통', () => {
  it('ready 만, 소식이 있으면 ack(id·s) 로, 안 떠난 화면엔 hidden 을 안 싣는다', () => {
    expect(beatBody(true, false)).toEqual({ ready: true });
    expect(beatBody(true, false, { id: 7, s: 'start' })).toEqual({ ready: true, ack: { id: 7, s: 'start' } });
    expect(beatBody(false, true)).toEqual({ ready: false, hidden: true });
  });
  it('간격은 1.5초', () => {
    expect(BEAT_MS).toBe(1500);
  });
});

describe('폰 음성 — 맥이 준 답 읽기', () => {
  it('아직 안 튼 소리만 고른다(같은 소리를 두 번 틀지 않게)', () => {
    const handled = new Set<number>([6]);
    expect(pickItem({ item: { id: 7, ms: 2500 }, cancel: 0 }, handled)).toMatchObject({ id: 7, ms: 2500 });
    expect(pickItem({ item: { id: 6, ms: 100 }, cancel: 0 }, handled)).toBeNull();
    expect(pickItem({ item: null, cancel: 0 }, handled)).toBeNull();
  });
  it('모양이 틀린 답은 무시', () => {
    expect(pickItem({ item: { id: 'x', ms: 1 } } as never, new Set())).toBeNull();
    expect(pickItem(null as never, new Set())).toBeNull();
    expect(pickItem({ item: { id: 7 } } as never, new Set())).toBeNull();
  });
  it('멈춤 번호는 처음엔 기억만, 그 뒤 바뀌면 멈춘다', () => {
    expect(cancelStep(null, 3)).toEqual({ stop: false, seen: 3 });
    expect(cancelStep(3, 3)).toEqual({ stop: false, seen: 3 });
    expect(cancelStep(3, 4)).toEqual({ stop: true, seen: 4 });
  });
});

describe('폰 음성 — 깨우기용 무음 wav', () => {
  it('RIFF/WAVE 머리가 맞고 데이터가 전부 0 이다', () => {
    const w = silentWav(100, 8000);
    const dv = new DataView(w.buffer);
    const tag = (o: number) => String.fromCharCode(w[o]!, w[o + 1]!, w[o + 2]!, w[o + 3]!);
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(dv.getUint32(24, true)).toBe(8000);
    const n = (8000 * 100) / 1000;
    expect(dv.getUint32(40, true)).toBe(n * 2);
    expect(w.length).toBe(44 + n * 2);
    expect(dv.getUint32(4, true)).toBe(w.length - 8);
    expect(w.slice(44).every((b) => b === 0)).toBe(true);
  });
});

describe('폰 말하는 참모 — 입력칸 참모 단추(2026-10-12 사용자 "어떤 참모가 말하는지 구분이 안 가")', () => {
  it('하트비트 답의 who·곡선을 그대로 넘긴다', () => {
    expect(pickItem({ item: { id: 7, ms: 75, who: 'aaaa0001', hop: 25, env: [0, 128, 255] }, cancel: 0 }, new Set())).toEqual({ id: 7, ms: 75, who: 'aaaa0001', hop: 25, env: [0, 128, 255] });
  });
  it('옛 맥(who 없음)이면 who·곡선 없음', () => {
    expect(pickItem({ item: { id: 7, ms: 75 }, cancel: 0 }, new Set())).toEqual({ id: 7, ms: 75, who: null, hop: 25, env: null });
  });
  it('곡선이 숫자 배열이 아니면 버린다', () => {
    expect(pickItem({ item: { id: 7, ms: 75, who: 'aaaa0001', env: 'x' as unknown as number[] }, cancel: 0 }, new Set())?.env).toBeNull();
  });
  const say = { id: 7, who: 'aaaa0001', startedMs: NOW, endedMs: null as number | null, hop: 25, env: null };
  it('틀고 있는 동안 말하는 참모', () => expect(speakerShown(say, NOW + 1000)).toBe('aaaa0001'));
  it('끝나고 HOLD_MS 안엔 그대로, 지나면 원래 참모로', () => {
    const ended = { ...say, endedMs: NOW + 3000 };
    expect(HOLD_MS).toBeGreaterThanOrEqual(2000);
    expect(HOLD_MS).toBeLessThanOrEqual(3000);
    expect(speakerShown(ended, NOW + 3000 + HOLD_MS - 1)).toBe('aaaa0001');
    expect(speakerShown(ended, NOW + 3000 + HOLD_MS)).toBeNull();
  });
  it('누가 말하는지 모르면 없음', () => expect(speakerShown({ ...say, who: null }, NOW)).toBeNull());
  it('빛 세기 — 틀고 있으면 데스크톱 levelAt 그대로(곡선), 끝났으면 0', () => {
    expect(sayLevel({ ...say, env: [0, 255] }, NOW + 30, false)).toBeCloseTo(1);
    expect(sayLevel({ ...say, endedMs: NOW + 10 }, NOW + 20, false)).toBe(0);
    expect(sayLevel(say, NOW + 10, true)).toBe(0.7);
  });
  it('단추 — 말하는 참모가 지금 참모와 다르면 그 참모로 옮기기, 같거나 없으면 평소(참모 바꾸기)', () => {
    expect(speakerTap('bbbb0002', 'aaaa0001')).toBe('go');
    expect(speakerTap('aaaa0001', 'aaaa0001')).toBe('chip');
    expect(speakerTap('aaaa0001', null)).toBe('chip');
  });
});
