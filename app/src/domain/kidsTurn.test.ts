import { describe, expect, it } from 'vitest';
import { downsample, endWaitMs, isSpeech, quietLoop, TURN, turnRules, turnStep, wavBytes, type Turn } from './kidsTurn';

const t = (o: Partial<Turn>): Turn => ({ sinceStart: 0, spoke: false, silence: 0, peek: 'none', nudged: false, ...o });

describe('말 끝 판정 — 계획서 D 말 시작·끝', () => {
  it('말을 시작하기 전: 4초에 한 번 부르고, 8초면 그만', () => {
    expect(turnStep(t({ sinceStart: 3000 }))).toBe('wait');
    expect(turnStep(t({ sinceStart: 4100 }))).toBe('nudge');
    expect(turnStep(t({ sinceStart: 5000, nudged: true }))).toBe('wait');
    expect(turnStep(t({ sinceStart: 8100, nudged: true }))).toBe('giveup');
  });
  it('말하는 중 0.45초 쉬면 미리 받아쓰기 — 끝난 말이면 바로 대답', () => {
    expect(turnStep(t({ spoke: true, silence: 300 }))).toBe('wait');
    expect(turnStep(t({ spoke: true, silence: 480 }))).toBe('peek');
    expect(turnStep(t({ spoke: true, silence: 700, peek: 'pending' }))).toBe('wait');
    expect(turnStep(t({ spoke: true, silence: 760, peek: 'end' }))).toBe('end');
  });
  it('모름이면 0.9초쯤 기다렸다 대답', () => {
    expect(turnStep(t({ spoke: true, silence: 760, peek: 'unsure' }))).toBe('wait');
    expect(turnStep(t({ spoke: true, silence: 950, peek: 'unsure' }))).toBe('end');
  });
  it("이어 갈 것 같으면('-고/-는데/그리고/음') 추임새 한 번, 그리고 3초까지 더 듣기", () => {
    expect(turnStep(t({ spoke: true, silence: 760, peek: 'more' }))).toBe('filler');
    expect(turnStep(t({ spoke: true, silence: 900, peek: 'more', fillered: true }))).toBe('wait');
    expect(turnStep(t({ spoke: true, silence: 2700, peek: 'more', fillered: true }))).toBe('wait');
    expect(turnStep(t({ spoke: true, silence: 3050, peek: 'more', fillered: true }))).toBe('end');
  });
  it('받아쓰기가 늦어도 3초 쉼이면 끝, 30초면 끝', () => {
    expect(turnStep(t({ spoke: true, silence: 3100, peek: 'pending' }))).toBe('end');
    expect(turnStep(t({ spoke: true, silence: 0, sinceStart: 30_100 }))).toBe('end');
  });
  it('문턱은 맥(kids.json turn)에서 고친 값으로', () => {
    const r = { ...TURN, unsure: 700, more: 5000 };
    expect(turnStep(t({ spoke: true, silence: 720, peek: 'unsure' }), r)).toBe('end');
    expect(turnStep(t({ spoke: true, silence: 4000, peek: 'more', fillered: true }), r)).toBe('wait'); // 이어감은 endMax 3초에 안 잘린다
  });
  it('끝까지 기다린 시간 — 고치기 전(0.7초 미리 받아쓰기·1.1초·2.6초) vs 지금(받아쓰기 0.3초 가정)', () => {
    const before = { done: 1100, more: 2600, unsure: 1100 };
    const now = { end: endWaitMs('end', 300), unsure: endWaitMs('unsure', 300), more: endWaitMs('more', 300) };
    expect(now.end).toBeLessThan(before.done);
    expect(now.end).toBeLessThanOrEqual(850);
    expect(now.unsure).toBeLessThan(before.unsure);
    expect(now.more).toBeGreaterThanOrEqual(3000);
    expect(endWaitMs('more', 300, TURN, true)).toBeLessThanOrEqual(850 + 85);
  });
});

describe('어린아이 기준(답 뒤 1분 동안 말이 한 번도 안 넘어가던 것)', () => {
  it('소리를 내는 중(시작 소리·답·미리 만든 말)과 끝난 직후엔 말로 안 친다 — 시작 소리를 말로 잡아 빈 받아쓰기가 됐을 수 있다', () => {
    expect(isSpeech(0.3, 0.001, TURN, true)).toBe(false);
    expect(isSpeech(0.3, 0.001, TURN, false)).toBe(true);
  });
  it('문턱은 맥 kids.json turn.speechLevel 로 — 기본 0.02 그대로', () => {
    expect(isSpeech(0.015, 0.001, TURN, false)).toBe(false);
    expect(isSpeech(0.015, 0.001, turnRules({ speechLevel: 0.008 }), false)).toBe(true);
    expect(isSpeech(0.03, 0.02, TURN, false), '시끄러운 방은 바닥의 3배').toBe(false);
  });
  it('답 뒤엔 화면이 떠 있는 동안 계속 듣는다 — 조용한 바퀴(8초)마다 다시, 세 바퀴째(약 24초)에 한 번 먼저 불러 본다', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => quietLoop(n))).toEqual(['listen', 'listen', 'call', 'listen', 'listen', 'listen']);
  });
});

describe('녹음 → 16kHz wav', () => {
  it('48kHz → 16kHz 는 3분의 1 길이, 평균으로', () => {
    const x = new Float32Array([0.3, 0.3, 0.3, -0.6, -0.6, -0.6]);
    const y = downsample(x, 48000, 16000);
    expect(Array.from(y).map((v) => Number(v.toFixed(2)))).toEqual([0.3, -0.6]);
  });
  it('wav 머리 — RIFF/WAVE·16kHz·모노·16비트', () => {
    const b = new DataView(wavBytes(new Float32Array([0, 1, -1]), 16000).buffer);
    const s = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => b.getUint8(o + i)));
    expect([s(0), s(8), s(36)]).toEqual(['RIFF', 'WAVE', 'data']);
    expect(b.getUint32(24, true)).toBe(16000);
    expect(b.getUint16(22, true)).toBe(1);
    expect(b.getUint32(40, true)).toBe(6);
    expect([b.getInt16(44, true), b.getInt16(46, true), b.getInt16(48, true)]).toEqual([0, 32767, -32767]);
  });
});
